import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runOpenAIStrategyPlanner } from "./_lib/openai-strategy-planner.js";

export const config = { maxDuration: 300 };
const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";

function bearer(req: VercelRequest) {
  const value = req.headers.authorization;
  return value?.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
}

async function canAccessProfile(token: string, profileId: string) {
  const response = await fetch(`${DATA_API}/profiles?id=eq.${encodeURIComponent(profileId)}&select=id&limit=1`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  if (!response.ok) return false;
  const rows = await response.json() as Array<{ id?: string }>;
  return rows.some((row) => row.id === profileId);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: "AUTH_REQUIRED" });
  const profileId = typeof req.body?.profileId === "string" ? req.body.profileId : "";
  if (!profileId) return res.status(400).json({ error: "PROFILE_REQUIRED" });
  if (!await canAccessProfile(token, profileId)) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "DATABASE_NOT_CONFIGURED" });
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "OPENAI_NOT_CONFIGURED" });
  try {
    const result = await runOpenAIStrategyPlanner({ DATABASE_URL: process.env.DATABASE_URL, OPENAI_API_KEY: process.env.OPENAI_API_KEY }, profileId);
    return res.status(200).json(result);
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "EDITORIAL_AGENTS_FAILED";
    console.error("vercel.editorial-agents", { profileId, detail });
    return res.status(500).json({ error: "EDITORIAL_AGENTS_FAILED", detail });
  }
}
