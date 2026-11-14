import type { VercelRequest, VercelResponse } from "@vercel/node";
import { timingSafeEqual } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { waitUntil } from "@vercel/functions";
import { advanceRenderJob, ReelPipelineError } from "./_lib/reel/reel-pipeline.js";
import { claimDueRenderJobs, claimRenderJob, classifyRenderError, enqueueReelJob, failRenderJob, listRenderJobs, yieldRenderJob } from "./_lib/reel/render-jobs.js";
import { createReelRuntime } from "./_lib/reel/reel-runtime.js";
import { reelStorageConfigured } from "./_lib/reel/reel-storage.js";
import { renderSelfTest } from "./_lib/reel/reel-selftest.js";
import { createDryRunReelRuntime, dryRunAllowed } from "./_lib/reel/reel-dry-run.js";
import { checkOpenAiModelAccess } from "./_lib/reel/openai-access.js";
import type { RenderJob } from "./_lib/reel/reel-pipeline.js";
import { neonDataApiUrl } from "./_lib/neon-endpoints.js";

export const config = { maxDuration: 300 };

const DATA_API = neonDataApiUrl();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORK_BUDGET_MS = 270_000;

/** Fail-closed switch: the paid Reel pipeline runs only with REEL_ENGINE_ENABLED=true. */
export function reelEngineReadiness(env: Record<string, string | undefined> = process.env) {
  const missing: string[] = [];
  if (env.REEL_ENGINE_ENABLED?.trim().toLowerCase() !== "true") missing.push("REEL_ENGINE_ENABLED");
  if (!env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (!reelStorageConfigured(env)) missing.push("BLOB_READ_WRITE_TOKEN");
  return { ready: missing.length === 0, missing };
}

function bearer(req: VercelRequest) {
  const value = req.headers.authorization;
  return value?.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
}

function routePath(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value.join("/") : value || "").split("/").filter(Boolean).join("/");
}

function cronAuthorized(req: VercelRequest) {
  const secret = process.env.CRON_SECRET;
  const received = bearer(req);
  if (!secret || !received) return false;
  const a = Buffer.from(secret, "utf8");
  const b = Buffer.from(received, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function authorizedUser(token: string, profileId: string) {
  const response = await fetch(`${DATA_API}/profiles?id=eq.${encodeURIComponent(profileId)}&select=id,owner_auth_user_id&limit=1`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 401 || response.status === 403) throw new Error("SESSION_INVALID");
  if (!response.ok) throw new Error("PROFILE_DATA_API_UNAVAILABLE");
  const rows = await response.json() as Array<{ id?: string; owner_auth_user_id?: string }>;
  const row = Array.isArray(rows) ? rows.find((item) => item?.id === profileId) : null;
  return row ? { ownerId: row.owner_auth_user_id ?? null } : null;
}

async function runJob(job: RenderJob, deadlineAt: number) {
  const sql = neon(process.env.DATABASE_URL!);
  try {
    const deps = job.dry_run
      ? createDryRunReelRuntime({ DATABASE_URL: process.env.DATABASE_URL, BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN })
      : createReelRuntime({ DATABASE_URL: process.env.DATABASE_URL, OPENAI_API_KEY: process.env.OPENAI_API_KEY, BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN });
    const configuredCap = Number(process.env.REEL_JOB_MAX_COST_USD);
    const maxCostUsd = Number.isFinite(configuredCap) && configuredCap > 0 ? Math.min(configuredCap, 10) : 2;
    const result = await advanceRenderJob(job, deps, { deadlineAt, maxCostUsd });
    if (result.state === "RUNNING") await yieldRenderJob(sql, job);
    console.log("reel-render", { jobId: job.id, profileId: job.profile_id, state: result.state, step: job.step, costUsd: job.cost_usd });
    return result.state;
  } catch (reason) {
    const code = reason instanceof ReelPipelineError ? reason.code : reason instanceof Error ? reason.message.split(":")[0] : "UNKNOWN";
    const detail = reason instanceof Error ? reason.message : "Errore sconosciuto";
    const classified = classifyRenderError(code);
    const retryable = reason instanceof ReelPipelineError ? reason.retryable && classified.retryable : classified.retryable;
    const state = await failRenderJob(sql, job, code, detail, retryable, classified.state === "BLOCKED").catch(() => "UNKNOWN");
    console.error("reel-render-failed", { jobId: job.id, profileId: job.profile_id, step: job.step, code, state });
    return state;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  const path = routePath(req.query.path);
  const readiness = reelEngineReadiness();

  if (path === "tick") {
    if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    if (!process.env.CRON_SECRET) return res.status(503).json({ error: "CRON_NOT_CONFIGURED" });
    if (!cronAuthorized(req)) return res.status(401).json({ error: "UNAUTHORIZED_CRON" });
    if (!readiness.ready) return res.status(200).json({ ok: true, processed: 0, engine: "DISABLED_CONFIG", missing: readiness.missing });
    const deadlineAt = Date.now() + WORK_BUDGET_MS;
    const jobs = await claimDueRenderJobs(neon(process.env.DATABASE_URL!), 1);
    const states = [];
    for (const job of jobs) states.push(await runJob(job, deadlineAt));
    return res.status(200).json({ ok: true, processed: jobs.length, states });
  }

  if (path === "selftest") {
    // Zero-cost cloud proof: synthetic stills + tone, real FFmpeg render inside this function.
    // No database, no provider call, no user data. Preview is behind Vercel SSO; production needs CRON_SECRET.
    if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
    if (process.env.VERCEL_ENV !== "preview" && !cronAuthorized(req)) return res.status(401).json({ error: "UNAUTHORIZED" });
    try {
      if (req.query.check === "openai") {
        // Model metadata only: no generation, no cost. Never returns the key.
        if (!process.env.OPENAI_API_KEY) return res.status(200).json({ ready: false, error: "OPENAI_API_KEY_MISSING" });
        return res.status(200).json(await checkOpenAiModelAccess(process.env.OPENAI_API_KEY));
      }
      return res.status(200).json(await renderSelfTest());
    } catch (reason) {
      return res.status(500).json({ ok: false, error: reason instanceof Error ? reason.message.slice(0, 300) : "UNKNOWN" });
    }
  }

  const token = bearer(req);
  if (!token) return res.status(401).json({ error: "AUTH_REQUIRED" });
  const profileId = String((req.method === "GET" ? req.query.profileId : req.body?.profileId) ?? "");
  if (!UUID.test(profileId)) return res.status(400).json({ error: "PROFILE_ID_REQUIRED" });

  try {
    const access = await authorizedUser(token, profileId);
    if (!access) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });

    if (path === "status") {
      if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      if (!process.env.DATABASE_URL) return res.status(200).json({ engine: { ready: false, missing: readiness.missing }, jobs: [] });
      const jobs = await listRenderJobs(neon(process.env.DATABASE_URL), profileId);
      return res.status(200).json({ engine: { ...readiness, dryRunAvailable: dryRunAllowed() }, jobs });
    }

    if (path === "enqueue") {
      if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      const dryRun = req.body?.dryRun === true;
      if (dryRun && !dryRunAllowed()) return res.status(403).json({ error: "REEL_DRY_RUN_NOT_ALLOWED" });
      const missing = dryRun ? readiness.missing.filter((key) => key !== "OPENAI_API_KEY") : readiness.missing;
      if (missing.length) return res.status(409).json({ error: "REEL_ENGINE_NOT_CONFIGURED", missing });
      const sourceVariantId = String(req.body?.sourceVariantId ?? "");
      const requestId = String(req.body?.requestId ?? "");
      if (!UUID.test(sourceVariantId) || !UUID.test(requestId)) return res.status(400).json({ error: "REEL_ENQUEUE_INPUT_INVALID" });
      const sql = neon(process.env.DATABASE_URL!);
      const queued = await enqueueReelJob(sql, { profileId, sourceVariantId, requestId, requestedBy: access.ownerId, dryRun });
      if (queued.created) {
        const deadlineAt = Date.now() + WORK_BUDGET_MS;
        waitUntil(claimRenderJob(sql, queued.id).then((job) => (job ? runJob(job, deadlineAt) : null)).catch((reason) => {
          console.error("reel-render-start-failed", { jobId: queued.id, detail: reason instanceof Error ? reason.message.split(":")[0] : "UNKNOWN" });
        }));
      }
      return res.status(202).json({ jobId: queued.id, state: queued.state, created: queued.created });
    }

    return res.status(404).json({ error: "RENDER_ROUTE_NOT_FOUND" });
  } catch (reason) {
    const code = reason instanceof Error ? reason.message.split(":")[0] : "UNKNOWN";
    if (code === "SESSION_INVALID") return res.status(401).json({ error: code });
    if (/^REEL_(SOURCE_NOT_ELIGIBLE|QUEUE_FULL|ENQUEUE_INPUT_INVALID)$/.test(code)) return res.status(409).json({ error: code });
    console.error("reel-render-route-failed", { path, code });
    return res.status(500).json({ error: "RENDER_ROUTE_FAILED" });
  }
}
