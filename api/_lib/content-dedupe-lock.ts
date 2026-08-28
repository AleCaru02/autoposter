import { Client } from "@neondatabase/serverless";
import type { ContentDedupeCandidate } from "./content-dedupe.js";

type LockHandle = {
  recent: () => Promise<ContentDedupeCandidate[]>;
  release: () => Promise<void>;
};

type RecentContentRow = {
  id: string;
  topic: string;
  title: string | null;
  hook: string | null;
  caption: string | null;
};

export async function acquireContentDedupeLock(connectionString: string, profileId: string): Promise<LockHandle> {
  const client = new Client(connectionString);
  await client.connect();
  let locked = false;
  try {
    // Session advisory lock: every current autopilot writer for the same profile
    // must pass through this critical section. Different profile UUIDs use different keys.
    await client.query("select pg_advisory_lock(hashtextextended($1::text, 0))", [profileId]);
    locked = true;

    return {
      async recent() {
        const result = await client.query<RecentContentRow>(
          `select ci.id,ci.topic,ci.title,cv.hook,cv.caption
             from public.content_items ci
             left join lateral (
               select hook,caption
                 from public.content_variants
                where profile_id=$1::uuid and content_id=ci.id
                order by updated_at desc
                limit 1
             ) cv on true
            where ci.profile_id=$1::uuid
            order by ci.created_at desc
            limit 40`,
          [profileId],
        );
        return result.rows.map((row) => ({
          id: row.id,
          topic: row.topic ?? "",
          angle: row.title,
          hook: row.hook,
          caption: row.caption,
        }));
      },
      async release() {
        if (!locked) return;
        try {
          await client.query("select pg_advisory_unlock(hashtextextended($1::text, 0))", [profileId]);
        } finally {
          locked = false;
          await client.end();
        }
      },
    };
  } catch (error) {
    if (locked) await client.query("select pg_advisory_unlock(hashtextextended($1::text, 0))", [profileId]).catch(() => undefined);
    await client.end().catch(() => undefined);
    throw error;
  }
}
