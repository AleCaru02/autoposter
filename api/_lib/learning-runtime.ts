import { neon } from "@neondatabase/serverless";
import { buildFeedbackLoopRecords, type MetricSnapshotRecord } from "./feedback-loop.js";

export type LearningRuntimeEnv = { DATABASE_URL?: string };
export type LearningRuntimeResult = {
  ready: boolean;
  profilesChecked: number;
  profilesReady: number;
  profilesInsufficient: number;
  insightsPersisted: number;
  errors: string[];
};

type ProfileRow = { id: string; timezone: string | null };

export async function runLearningRuntime(env: LearningRuntimeEnv, requestedProfileId?: string): Promise<LearningRuntimeResult> {
  if (!env.DATABASE_URL) return { ready: false, profilesChecked: 0, profilesReady: 0, profilesInsufficient: 0, insightsPersisted: 0, errors: ["DATABASE_NOT_CONFIGURED"] };
  const sql = neon(env.DATABASE_URL);
  const profiles = requestedProfileId
    ? await sql`select distinct profile.id,profile.timezone from public.profiles profile join public.metric_snapshots snapshot on snapshot.profile_id=profile.id where profile.id=${requestedProfileId}::uuid and profile.archived_at is null and snapshot.source='PROVIDER_API' and not public.is_demo_persistent_profile(profile.id) limit 1` as unknown as ProfileRow[]
    : await sql`select distinct profile.id,profile.timezone from public.profiles profile join public.metric_snapshots snapshot on snapshot.profile_id=profile.id where profile.archived_at is null and snapshot.source='PROVIDER_API' and not public.is_demo_persistent_profile(profile.id) order by profile.id limit 100` as unknown as ProfileRow[];
  const result: LearningRuntimeResult = { ready: true, profilesChecked: 0, profilesReady: 0, profilesInsufficient: 0, insightsPersisted: 0, errors: [] };

  for (const profile of profiles) {
    result.profilesChecked += 1;
    try {
      // Repeated hourly captures of one remote post are one performance sample,
      // not independent evidence. Only the latest real provider snapshot counts.
      const snapshots = await sql`
        select latest.profile_id,latest.provider,latest.external_post_id,latest.format,latest.topic,
          latest.published_at,latest.captured_at,latest.metrics
        from (
          select distinct on (snapshot.provider,snapshot.external_post_id)
            snapshot.profile_id,snapshot.provider,snapshot.external_post_id,snapshot.format,snapshot.topic,
            snapshot.published_at,snapshot.captured_at,snapshot.metrics
          from public.metric_snapshots snapshot
          where snapshot.profile_id=${profile.id}::uuid
            and snapshot.source='PROVIDER_API'
            and snapshot.provider in ('FACEBOOK','INSTAGRAM')
            and snapshot.external_post_id is not null
            and snapshot.published_at is not null
            and snapshot.format is not null
            and snapshot.topic is not null
          order by snapshot.provider,snapshot.external_post_id,snapshot.captured_at desc
        ) latest
        order by latest.published_at desc,latest.provider,latest.external_post_id
        limit 500
      ` as unknown as MetricSnapshotRecord[];
      const generatedAt = new Date().toISOString();
      const output = buildFeedbackLoopRecords(profile.id, snapshots, { timezone: profile.timezone || "Europe/Rome", generatedAt });
      const persisted = await sql`select public.refresh_learning_insights(${profile.id}::uuid,${JSON.stringify(output.records)}::jsonb,${generatedAt}::timestamptz)::int as count` as unknown as Array<{ count: number }>;
      result.insightsPersisted += Number(persisted[0]?.count ?? 0);
      if (output.result.status === "READY") result.profilesReady += 1;
      else result.profilesInsufficient += 1;
    } catch (reason) {
      console.error("learning-profile-refresh-failed", profile.id, reason instanceof Error ? reason.message : "unknown");
      result.errors.push("LEARNING_REFRESH_FAILED");
    }
  }
  result.ready = result.errors.length === 0;
  return result;
}
