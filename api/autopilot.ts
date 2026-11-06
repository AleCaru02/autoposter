import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runContentAutopilotSerialized } from "./_lib/autopilot-serialized.js";
import type { AutopilotEnv } from "./_lib/autopilot.js";

export const config = { maxDuration: 300 };

const DATA_API = "https://ep-divine-band-arrkz7vq.apirest.c-4.us-west-2.aws.neon.tech/neondb/rest/v1";

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
  if (!runtime.DATABASE_URL) return res.status(503).json({ error: "DATABASE_NOT_CONFIGURED" });
  if (!runtime.OPENAI_API_KEY) return res.status(503).json({ error: "OPENAI_NOT_CONFIGURED" });

  try {
    const result = await runContentAutopilotSerialized(runtime, { profileId, maxGenerations: 6 });
    return res.status(200).json(result);
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "AUTOPILOT_RUN_FAILED";
    console.error("vercel.autopilot", { profileId, detail });
    return res.status(500).json({ error: "AUTOPILOT_RUN_FAILED" });
  }
}
