import worker from "./worker.js";
import { runContentAutopilot, type AutopilotEnv } from "../api/_lib/autopilot.js";

const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";

type Env = AutopilotEnv & {
  ASSETS: { fetch(request: Request): Promise<Response> };
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function bearer(request: Request) {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
}

async function canAccessProfile(request: Request, profileId: string) {
  const token = bearer(request);
  if (!token) return false;
  const response = await fetch(`${DATA_API}/profiles?id=eq.${encodeURIComponent(profileId)}&select=id&limit=1`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!response.ok) return false;
  const rows = await response.json() as Array<{ id?: string }>;
  return rows.some((row) => row.id === profileId);
}

async function handleAutopilotRun(request: Request, env: Env) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  let profileId = "";
  try {
    const body = await request.json() as Record<string, unknown>;
    profileId = typeof body.profileId === "string" ? body.profileId : "";
  } catch { /* handled below */ }
  if (!profileId) return json({ error: "PROFILE_REQUIRED" }, 400);
  if (!await canAccessProfile(request, profileId)) return json({ error: "PROFILE_NOT_FOUND" }, 404);
  try {
    const result = await runContentAutopilot(env, { profileId, maxGenerations: 6 });
    return json({ ok: true, result });
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "AUTOPILOT_RUN_FAILED";
    console.error("autopilot-manual-trigger", { profileId, detail });
    return json({ error: "AUTOPILOT_RUN_FAILED", detail }, detail.includes("NOT_CONFIGURED") ? 503 : 500);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname === "/api/autopilot/run") return handleAutopilotRun(request, env);
    return worker.fetch(request, env);
  },
  async scheduled(_controller: unknown, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    ctx.waitUntil(runContentAutopilot(env).then((result) => {
      console.log("content-autopilot", result);
    }).catch((reason) => {
      console.error("content-autopilot-failed", reason instanceof Error ? reason.message : "unknown");
    }));
  },
};
