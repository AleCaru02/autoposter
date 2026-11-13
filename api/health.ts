import { neon } from "@neondatabase/serverless";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { isIsolatedPreview } from "./_lib/neon-endpoints.js";

/** Non-secret runtime facts, never exposed on production: proves which DB/Data API a preview uses. */
function previewDiagnostics() {
  if (process.env.VERCEL_ENV === "production") return {};
  let databaseEndpoint: string | null = null;
  try { databaseEndpoint = new URL(process.env.DATABASE_URL ?? "").hostname.split(".")[0].replace(/-pooler$/, "") || null; } catch { databaseEndpoint = null; }
  return { runtime: { vercelEnv: process.env.VERCEL_ENV ?? null, targetEnv: process.env.VERCEL_TARGET_ENV ?? null, isolatedNeon: isIsolatedPreview(), databaseEndpoint } };
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const startedAt = Date.now();
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    return res.status(503).json({
      service: "post-automatici-api",
      ready: false,
      database: "not_configured",
      latencyMs: Date.now() - startedAt,
    });
  }

  try {
    const sql = neon(databaseUrl);
    const rows = await sql`SELECT 1 AS ok`;
    const databaseReady = rows[0]?.ok === 1;

    return res.status(databaseReady ? 200 : 503).json({
      service: "post-automatici-api",
      ready: databaseReady,
      database: databaseReady ? "postgres_ready" : "postgres_unhealthy",
      latencyMs: Date.now() - startedAt,
      ...previewDiagnostics(),
    });
  } catch (error) {
    console.error("health.database", error);
    return res.status(503).json({
      service: "post-automatici-api",
      ready: false,
      database: "postgres_error",
      latencyMs: Date.now() - startedAt,
    });
  }
}
