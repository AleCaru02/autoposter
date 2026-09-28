import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AiBudgetRecommendationEngine } from "./_lib/ai-budget-recommendation.js";

const DATA_API = "https://ep-divine-band-arrkz7vq.apirest.c-4.us-west-2.aws.neon.tech/neondb/rest/v1";

function bearer(req: VercelRequest) {
  const value = req.headers.authorization;
  return value?.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: "AUTH_REQUIRED" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "DATABASE_NOT_CONFIGURED" });
  const profileId = typeof req.query.profileId === "string" ? req.query.profileId : "";
  if (!profileId) return res.status(400).json({ error: "PROFILE_REQUIRED" });

  const profile = await fetch(`${DATA_API}/profiles?id=eq.${encodeURIComponent(profileId)}&select=id&limit=1`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!profile.ok) return res.status(profile.status === 401 ? 401 : 403).json({ error: "PROFILE_ACCESS_DENIED" });
  const rows = await profile.json() as Array<{ id: string }>;
  if (!rows[0]) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });

  try {
    const recommendation = await new AiBudgetRecommendationEngine(process.env.DATABASE_URL).recommend(profileId);
    return res.status(200).json({ recommendation });
  } catch (reason) {
    console.error("ai-budget-recommendation", reason instanceof Error ? reason.message : "UNKNOWN");
    return res.status(500).json({ error: "AI_BUDGET_RECOMMENDATION_FAILED" });
  }
}
