import { neon } from "@neondatabase/serverless";
import type { VercelRequest, VercelResponse } from "@vercel/node";

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
