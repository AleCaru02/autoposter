import { runOpenAIStrategyPlanner, type StrategyPlannerEnv } from "../api/_lib/openai-strategy-planner.js";

const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";

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
  const response = await fetch(`${DATA_API}/profiles?id=eq.${encodeURIComponent(profileId)}&select=id&limit=1`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  if (!response.ok) return false;
  const rows = await response.json() as Array<{ id?: string }>;
  return rows.some((row) => row.id === profileId);
}

export async function handleWorkerStrategyPlanner(request: Request, env: StrategyPlannerEnv) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  let profileId = "";
  try {
    const body = await request.json() as Record<string, unknown>;
    profileId = typeof body.profileId === "string" ? body.profileId : "";
  } catch { /* handled below */ }
  if (!profileId) return json({ error: "PROFILE_REQUIRED" }, 400);
  if (!await canAccessProfile(request, profileId)) return json({ error: "PROFILE_NOT_FOUND" }, 404);
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  if (!env.OPENAI_API_KEY) return json({ error: "OPENAI_NOT_CONFIGURED" }, 503);
  try {
    const result = await runOpenAIStrategyPlanner(env, profileId);
    return json(result, 200);
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "EDITORIAL_AGENTS_FAILED";
    console.error("worker.editorial-agents", { profileId, detail });
    if (detail === "CAPABILITY_DISABLED" || detail === "CAPABILITY_LIMIT_REACHED") return json({ error: detail }, 429);
    if (detail === "STRATEGY_GENERATION_IN_PROGRESS") return json({ error: detail }, 409);
    if (detail.startsWith("METERING_FAILED")) return json({ error: "METERING_FAILED" }, 503);
    return json({ error: "EDITORIAL_AGENTS_FAILED" }, detail.startsWith("OPENAI_") ? 502 : 500);
  }
}
