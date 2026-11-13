import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runLearningRuntime } from "./_lib/learning-runtime.js";
import { neonDataApiUrl } from "./_lib/neon-endpoints.js";

// Same authenticated RLS preflight used by other Vercel profile-scoped routes.
// Do not compute learning for an arbitrary account or accept a profile id as proof of ownership.
const DATA_API = neonDataApiUrl();
export const config = { maxDuration: 120 };

function bearer(req: VercelRequest): string | null {
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
  const subpath = Array.isArray(req.query.path) ? req.query.path.join("/") : req.query.path || "";
  if (subpath !== "run") return res.status(404).json({ error: "LEARNING_ROUTE_NOT_FOUND" });
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: "AUTH_REQUIRED" });
  const profileId = typeof req.body?.profileId === "string" ? req.body.profileId : "";
  if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(profileId)) {
    return res.status(400).json({ error: "PROFILE_REQUIRED" });
  }
  let allowed: boolean;
  try {
    allowed = await canAccessProfile(token, profileId);
  } catch (reason) {
    const invalid = reason instanceof Error && reason.message === "SESSION_INVALID";
    return res.status(invalid ? 401 : 502).json({ error: invalid ? "SESSION_INVALID" : "PROFILE_DATA_API_UNAVAILABLE" });
  }
  if (!allowed) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "DATABASE_NOT_CONFIGURED" });
  try {
    const result = await runLearningRuntime({ DATABASE_URL: process.env.DATABASE_URL }, profileId);
    return res.status(result.ready ? 200 : 503).json(result);
  } catch (reason) {
    console.error("vercel.learning", { profileId, code: reason instanceof Error ? reason.message.split(":")[0] : "unknown" });
    return res.status(500).json({ error: "LEARNING_RUN_FAILED" });
  }
}
