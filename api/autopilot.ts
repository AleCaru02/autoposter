import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runContentAutopilotSerialized } from "./_lib/autopilot-serialized.js";
import type { AutopilotEnv } from "./_lib/autopilot.js";
import { neonDataApiUrl } from "./_lib/neon-endpoints.js";

export const config = { maxDuration: 300 };

const DATA_API = neonDataApiUrl();

const CANONICAL_AUTOPILOT_RUN = "https://post-automatici-canonical.vercel.app/api/autopilot/run";

/**
 * The owner's temporary QA preview is intentionally not provisioned with
 * DATABASE_URL or OPENAI_API_KEY. Delegate the authenticated command to the
 * canonical production runtime instead of copying secrets into preview.
 *
 * This is explicitly ONE branch/host; never proxy production, arbitrary
 * deployments, or user-selected destinations. Canonical still performs its
 * own mandatory Neon JWT/profile authorization, rate and budget checks.
 */
export function canDelegatePreviewAutopilot(input: {
  vercelEnv?: string;
  gitRef?: string;
  configuredPreviewOrigin?: string;
  requestHost?: string;
}): boolean {
  if (input.vercelEnv !== "preview" || input.gitRef !== "feature/instagram-creator-toolkit-20261107") return false;
  const expectedOrigin = "https://post-automatici-canonical-git-fea-5b851e-ales-projects-b8ec22ac.vercel.app";
  return input.configuredPreviewOrigin === expectedOrigin
    && input.requestHost === new URL(expectedOrigin).host;
}

async function delegatePreviewAutopilot(token: string, profileId: string, res: VercelResponse) {
  try {
    const response = await fetch(CANONICAL_AUTOPILOT_RUN, {
      method: "POST",
      headers: { "authorization": `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ profileId }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(270000),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(502).json({ error: "AUTOPILOT_CANONICAL_INVALID_RESPONSE" });
    }
    res.setHeader("cache-control", "no-store");
    return res.status(response.status).json(body);
  } catch (reason) {
    // Never log or forward credentials. The error type is enough for support.
    console.error("vercel.autopilot.preview_delegate_failed", {
      detail: reason instanceof Error ? reason.name : "UNKNOWN",
    });
    return res.status(502).json({ error: "AUTOPILOT_CANONICAL_UNAVAILABLE" });
  }
}


function bearer(req: VercelRequest) {
  const value = req.headers.authorization;
  return value?.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
}

function autopilotPath(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value.join("/") : value || "";
  return raw.split("/").filter(Boolean).join("/");
}

async function canAccessProfile(token: string, profileId: string) {
  const response = await fetch(`${DATA_API}/profiles?id=eq.${encodeURIComponent(profileId)}&select=id&limit=1`, {
    method: "GET",
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (response.status === 401 || response.status === 403) throw new Error("SESSION_INVALID");
  if (!response.ok) throw new Error("PROFILE_DATA_API_UNAVAILABLE");
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new Error("PROFILE_DATA_API_UNAVAILABLE");
  return rows.some((row) => row && typeof row === "object" && row.id === profileId);
}

function env(): AutopilotEnv {
  return {
    DATABASE_URL: process.env.DATABASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_TEXT_MONTHLY_BUDGET_USD: process.env.OPENAI_TEXT_MONTHLY_BUDGET_USD,
    OPENAI_IMAGE_MONTHLY_LIMIT: process.env.OPENAI_IMAGE_MONTHLY_LIMIT,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (autopilotPath(req.query.path) !== "run") return res.status(404).json({ error: "AUTOPILOT_ROUTE_NOT_FOUND" });
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  const token = bearer(req);
  if (!token) return res.status(401).json({ error: "AUTH_REQUIRED" });
  const profileId = typeof req.body?.profileId === "string" ? req.body.profileId : "";
  if (!profileId) return res.status(400).json({ error: "PROFILE_REQUIRED" });
  let authorized = false;
  try {
    authorized = await canAccessProfile(token, profileId);
  } catch (reason) {
    return res.status(reason instanceof Error && reason.message === "SESSION_INVALID" ? 401 : 502)
      .json({ error: reason instanceof Error && reason.message === "SESSION_INVALID" ? "SESSION_INVALID" : "PROFILE_DATA_API_UNAVAILABLE" });
  }
  if (!authorized) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });

  const runtime = env();
  if (!runtime.DATABASE_URL || !runtime.OPENAI_API_KEY) {
    if (canDelegatePreviewAutopilot({
      vercelEnv: process.env.VERCEL_ENV,
      gitRef: process.env.VERCEL_GIT_COMMIT_REF,
      configuredPreviewOrigin: process.env.AUTH_PREVIEW_ORIGIN,
      requestHost: req.headers.host,
    })) return delegatePreviewAutopilot(token, profileId, res);
    return res.status(503).json({
      error: !runtime.DATABASE_URL ? "DATABASE_NOT_CONFIGURED" : "OPENAI_NOT_CONFIGURED",
    });
  }

  try {
    const result = await runContentAutopilotSerialized(runtime, { profileId, maxGenerations: 6 });
    return res.status(200).json(result);
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "AUTOPILOT_RUN_FAILED";
    console.error("vercel.autopilot", { profileId, detail });
    return res.status(500).json({ error: "AUTOPILOT_RUN_FAILED" });
  }
}
