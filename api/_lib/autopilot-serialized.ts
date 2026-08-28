import { Client } from "@neondatabase/serverless";
import { runContentAutopilot, type AutopilotEnv } from "./autopilot.js";

type RunOptions = { profileId?: string; maxGenerations?: number };

const LOCK_NAME = "post-automatici:content-autopilot:v1";

export async function runContentAutopilotSerialized(env: AutopilotEnv, options: RunOptions = {}) {
  if (!env.DATABASE_URL) throw new Error("DATABASE_NOT_CONFIGURED");
  const client = new Client(env.DATABASE_URL);
  await client.connect();
  let locked = false;
  try {
    await client.query("select pg_advisory_lock(hashtextextended($1::text, 0))", [LOCK_NAME]);
    locked = true;
    return await runContentAutopilot(env, options);
  } finally {
    if (locked) {
      await client.query("select pg_advisory_unlock(hashtextextended($1::text, 0))", [LOCK_NAME]).catch(() => undefined);
    }
    await client.end().catch(() => undefined);
  }
}
