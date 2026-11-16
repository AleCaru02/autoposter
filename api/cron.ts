import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runLearningRuntime } from "./_lib/learning-runtime.js";
import { runContentAutopilotSerialized } from "./_lib/autopilot-serialized.js";
import { revalidateSocialConnections } from "./_lib/social.js";

export const config = { maxDuration: 300 };

type CronEnv = {
  DATABASE_URL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_TEXT_MONTHLY_BUDGET_USD?: string;
  OPENAI_IMAGE_MONTHLY_LIMIT?: string;
  CRON_SECRET?: string;
};

function bearer(req: VercelRequest) {
  const value = req.headers.authorization;
  return value?.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
}

function authorized(req: VercelRequest, secret: string | undefined) {
  const token = bearer(req);
  return Boolean(secret && token && token.length === secret.length && token === secret);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const env: CronEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_TEXT_MONTHLY_BUDGET_USD: process.env.OPENAI_TEXT_MONTHLY_BUDGET_USD,
    OPENAI_IMAGE_MONTHLY_LIMIT: process.env.OPENAI_IMAGE_MONTHLY_LIMIT,
    CRON_SECRET: process.env.CRON_SECRET,
  };
  if (!env.CRON_SECRET) return res.status(503).json({ error: "CRON_NOT_CONFIGURED" });
  if (!authorized(req, env.CRON_SECRET)) return res.status(401).json({ error: "UNAUTHORIZED_CRON" });
  if (!env.DATABASE_URL) return res.status(503).json({ error: "DATABASE_NOT_CONFIGURED" });
  if (!env.OPENAI_API_KEY) return res.status(503).json({ error: "OPENAI_NOT_CONFIGURED" });

  try {
    // Never publish here: remote social writes remain a separate, explicitly authorized action.
    // Read-only social re-verification (no publishing, no AI): keeps connection state truthful.
    const socialCheck = await revalidateSocialConnections({
      DATABASE_URL: process.env.DATABASE_URL,
      SOCIAL_TOKEN_KEY: process.env.SOCIAL_TOKEN_KEY,
      META_APP_ID: process.env.META_APP_ID,
      META_APP_SECRET: process.env.META_APP_SECRET,
      META_GRAPH_VERSION: process.env.META_GRAPH_VERSION,
      LINKEDIN_API_VERSION: process.env.LINKEDIN_API_VERSION,
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    }).catch((reason) => ({ checked: 0, verified: 0, failed: 0, error: reason instanceof Error ? reason.message.split(":")[0] : "SOCIAL_REVALIDATION_FAILED" }));
    const learning = await runLearningRuntime(env);
    const autopilot = await runContentAutopilotSerialized(env, { maxGenerations: 1 });
    console.log("vercel.cron", {
      learningReady: learning.ready,
      profilesChecked: autopilot.profilesChecked,
      generated: autopilot.generated,
      scheduled: autopilot.scheduled,
      errors: autopilot.errors.length,
      socialCheck,
    });
    return res.status(200).json({ ok: true, socialCheck, learning, autopilot });
  } catch (reason) {
    const code = reason instanceof Error ? reason.message.split(":")[0] : "CRON_RUN_FAILED";
    console.error("vercel.cron", { code });
    return res.status(500).json({ error: "CRON_RUN_FAILED" });
  }
}
