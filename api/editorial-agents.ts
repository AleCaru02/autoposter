import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runOpenAIStrategyPlanner } from "./_lib/openai-strategy-planner.js";
import { neonDataApiUrl } from "./_lib/neon-endpoints.js";

export const config = { maxDuration: 300 };
const DATA_API = neonDataApiUrl();

function bearer(req: VercelRequest) {
  const value = req.headers.authorization;
  return value?.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: "AUTH_REQUIRED" });
  const profileId = typeof req.body?.profileId === "string" ? req.body.profileId : "";
  if (!profileId) return res.status(400).json({ error: "PROFILE_REQUIRED" });
  let authorized = false;
  try {
    authorized = await canAccessProfile(token, profileId);
  } catch (reason) {
    const invalid = reason instanceof Error && reason.message === "SESSION_INVALID";
    return res.status(invalid ? 401 : 502).json({ error: invalid ? "SESSION_INVALID" : "PROFILE_DATA_API_UNAVAILABLE" });
  }
  if (!authorized) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "DATABASE_NOT_CONFIGURED" });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "OPENAI_NOT_CONFIGURED" });
  try {
    const result = await runOpenAIStrategyPlanner({ DATABASE_URL: process.env.DATABASE_URL, OPENAI_API_KEY: process.env.OPENAI_API_KEY }, profileId);
    return res.status(200).json(result);
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "EDITORIAL_AGENTS_FAILED";
    console.error("vercel.editorial-agents", { profileId, detail });
    if (detail === "CAPABILITY_DISABLED" || detail === "CAPABILITY_LIMIT_REACHED" || detail === "PROVIDER_COST_BUDGET_REACHED") return res.status(429).json({ error: detail });
    if (detail === "STRATEGY_GENERATION_IN_PROGRESS") return res.status(409).json({ error: detail });
    if (detail.startsWith("METERING_FAILED")) return res.status(503).json({ error: "METERING_FAILED" });
    return res.status(detail.startsWith("OPENAI_") ? 502 : 500).json({ error: "EDITORIAL_AGENTS_FAILED" });
  }
}
