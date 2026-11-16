import type { VercelRequest, VercelResponse } from "@vercel/node";
import { timingSafeEqual } from "node:crypto";
import { processDuePublications, socialSafeModeState, type SocialEnv } from "./_lib/social.js";
import { processDueAnalytics } from "./_lib/analytics.js";

export const config = { maxDuration: 120 };

function authorized(req: VercelRequest, secret: string | undefined) {
  const header = req.headers.authorization;
  const received = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!secret || !received) return false;
  const expected = Buffer.from(secret, "utf8");
  const actual = Buffer.from(received, "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function enabled(value: string | undefined) { return value?.trim().toLowerCase() === "true"; }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  if (!process.env.CRON_SECRET) return res.status(503).json({ error: "CRON_NOT_CONFIGURED" });
  if (!authorized(req, process.env.CRON_SECRET)) return res.status(401).json({ error: "UNAUTHORIZED_CRON" });

  // Both subsystems are opt-in, fail-closed. A newly deployed cron cannot
  // publish to social networks or consume external metrics by default.
  const publishEnabled = enabled(process.env.AUTO_SOCIAL_PUBLISH_ENABLED);
  const analyticsEnabled = enabled(process.env.AUTO_SOCIAL_ANALYTICS_ENABLED);
  if (!publishEnabled && !analyticsEnabled) {
    return res.status(200).json({ ok: true, publishing: "DISABLED_CONFIG", analytics: "DISABLED_CONFIG" });
  }

  const env: SocialEnv = {
    DATABASE_URL: process.env.DATABASE_URL,
    SAFE_MODE: process.env.SAFE_MODE,
    SOCIAL_TOKEN_KEY: process.env.SOCIAL_TOKEN_KEY,
    META_APP_ID: process.env.META_APP_ID,
    META_APP_SECRET: process.env.META_APP_SECRET,
    META_GRAPH_VERSION: process.env.META_GRAPH_VERSION,
    LINKEDIN_CLIENT_ID: process.env.LINKEDIN_CLIENT_ID,
    LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET,
    LINKEDIN_API_VERSION: process.env.LINKEDIN_API_VERSION,
    LINKEDIN_ORGANIZATION_ACCESS: process.env.LINKEDIN_ORGANIZATION_ACCESS,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    APP_BASE_URL: process.env.APP_BASE_URL,
  };
  if (!env.DATABASE_URL || !env.SOCIAL_TOKEN_KEY || env.SOCIAL_TOKEN_KEY.length < 24) {
    return res.status(503).json({ error: "SOCIAL_SECURITY_NOT_CONFIGURED" });
  }
  const safeMode = socialSafeModeState(env);
  if (publishEnabled && safeMode !== "OFF") {
    return res.status(200).json({
      ok: true,
      publishing: safeMode === "ON" ? "SAFE_MODE_ACTIVE" : "SAFE_MODE_UNDETERMINED",
      analytics: "SKIPPED",
    });
  }

  try {
    const publishing = publishEnabled
      ? await processDuePublications(env, 5)
      : { ready: false, reason: "DISABLED_CONFIG", checked: 0, published: 0, failed: 0 };
    const analytics = analyticsEnabled
      ? await processDueAnalytics(env, 10)
      : { ready: false, reason: "DISABLED_CONFIG", checked: 0, synced: 0, failed: 0 };
    console.log("vercel.social.cron", {
      publishEnabled,
      analyticsEnabled,
      processed: publishing.checked,
      published: publishing.published,
      failed: publishing.failed,
      metricsChecked: analytics.checked,
      metricsSynced: analytics.synced,
      metricsFailed: analytics.failed,
    });
    return res.status(200).json({ ok: true, publishing, analytics });
  } catch {
    // Provider tokens, URLs, access credentials, account IDs and raw response
    // bodies must never appear in the cron response or logs.
    console.error("vercel.social.cron", { error: "SOCIAL_CRON_FAILED" });
    return res.status(500).json({ error: "SOCIAL_CRON_FAILED" });
  }
}
