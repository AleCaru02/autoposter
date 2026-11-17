import { neon } from "@neondatabase/serverless";
import { ActivityBudgetEngine } from "../activity-budget.js";
import { runContentQa } from "../content-qa.js";
import { enqueueReelJob } from "./render-jobs.js";

type Sql = ReturnType<typeof neon>;
const UUID = /^[0-9a-f]{8}-[0-9a-f-]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type AutoReelEnv = {
  DATABASE_URL?: string; OPENAI_API_KEY?: string;
  SOCIAL_PILOT_PROFILE_ID?: string; AUTO_REEL_PILOT_ENABLED?: string;
};
export function autoReelPilotAllowed(env: AutoReelEnv) {
  return env.AUTO_REEL_PILOT_ENABLED === "true" &&
    Boolean(env.DATABASE_URL && env.OPENAI_API_KEY) &&
    UUID.test(env.SOCIAL_PILOT_PROFILE_ID ?? "");
}

/**
 * At most one (including FAILED) AI Reel within seven days for the owner-reviewed
 * source content. Source must have full QA PASS, an approval fingerprint and an ACTIVE
 * verified Instagram connection. Queuing is idempotent when crons overlap.
 */
export async function enqueueAutoReelPilot(env: AutoReelEnv, sqlOverride?: Sql) {
  if (!autoReelPilotAllowed(env)) return { queued: false, reason: "AUTO_REEL_PILOT_DISABLED" };
  const profileId = env.SOCIAL_PILOT_PROFILE_ID!;
  const sql = sqlOverride ?? neon(env.DATABASE_URL!);
  const [existing, eligible] = await Promise.all([
    sql`select count(*)::int as n from public.render_jobs
      where profile_id=${profileId}::uuid and kind='REEL_FACELESS' and created_at > now()-interval '7 days'` as unknown as Promise<Array<{ n: number }>>,
    sql`select v.id::text as id from public.content_variants v
      join public.social_connections c on c.profile_id=v.profile_id and c.provider=v.provider
      where v.profile_id=${profileId}::uuid and v.provider='INSTAGRAM' and v.format='POST'
        and v.approval_mode='MANUAL' and v.approval_status='APPROVED' and v.workflow_status='APPROVED'
        and v.qa_status='PASS' and v.qa_fingerprint is not null and v.qa_fingerprint=v.approved_fingerprint
        and v.eligible=true and length(coalesce(v.caption,''))>=40
        and v.created_at>now()-interval '14 days'
        and c.status='ACTIVE' and c.token_reference is not null
        and c.provider_account_id is not null and c.last_validated_at>now()-interval '48 hours'
      order by v.created_at desc limit 1` as unknown as Promise<Array<{ id: string }>>,
  ]);
  if (Number(existing[0]?.n) > 0) return { queued: false, reason: "AUTO_REEL_WEEKLY_LIMIT" };
  if (!eligible[0]?.id) return { queued: false, reason: "AUTO_REEL_APPROVED_SOURCE_REQUIRED" };
  const budget = await new ActivityBudgetEngine(env.DATABASE_URL!).snapshot(profileId);
  if (budget.remainingEur < 3 || budget.otherAiRemainingEur < 3 || budget.forecastRisksHardCap) {
    return { queued: false, reason: "AUTO_REEL_BUDGET_NOT_READY" };
  }
  const result = await enqueueReelJob(sql, {
    profileId, sourceVariantId: eligible[0].id, requestId: crypto.randomUUID(),
    requestedBy: null, dryRun: false, kind: "REEL_FACELESS",
  });
  return { queued: true, jobId: result.id, created: result.created };
}

/** QA-check a completed Reel draft without ever approving or scheduling it.
 * The owner must review all generated video, captions and covers first. */
export async function reviewAutoReelPilot(env: AutoReelEnv, sqlOverride?: Sql) {
  if (!autoReelPilotAllowed(env)) return { reviewed: 0, reason: "AUTO_REEL_PILOT_DISABLED" };
  const sql = sqlOverride ?? neon(env.DATABASE_URL!);
  const profileId = env.SOCIAL_PILOT_PROFILE_ID!;
  const ready = await sql`
    select r.id::text as render_id,v.id::text as variant_id,v.content_id::text as content_id
    from public.render_jobs r
    join public.content_variants v on v.id=r.output_variant_id and v.profile_id=r.profile_id
    join public.assets video on video.id=v.video_asset_id and video.profile_id=v.profile_id and video.kind='VIDEO'
    where r.profile_id=${profileId}::uuid and r.kind='REEL_FACELESS' and r.state='READY_FOR_REVIEW'
      and r.completed_at > now()-interval '7 days'
      and v.provider='INSTAGRAM' and v.format='REEL' and v.approval_mode='MANUAL'
      and v.approval_status='PENDING' and v.qa_status='PENDING'
      and video.mime_type='video/mp4' and video.quality_status='PASS'
      and video.identity_status='NOT_REQUIRED' and video.width>0 and video.height>0
      and abs(video.width::float8 / video.height - 9.0/16.0) < 0.03
    order by r.completed_at asc limit 1
  ` as unknown as Array<{ render_id: string; variant_id: string; content_id: string }>;
  if (!ready[0]) return { reviewed: 0, reason: "AUTO_REEL_NO_QUALIFIED_RENDER" };
  const v = ready[0];
  // Uses the same paid, profile-scoped editorial/factual/cover QA as static posts.
  // Its entitlement and euro hard-cap are checked inside runContentQa.
  const qa = await runContentQa({
    databaseUrl: env.DATABASE_URL!, apiKey: env.OPENAI_API_KEY!,
    profileId, contentId: v.content_id, variantId: v.variant_id, actorType: "AUTOPILOT",
  });
  if (qa.overallStatus !== "PASS") return { reviewed: 1, approved: false, reason: "AUTO_REEL_CONTENT_QA_BLOCKED" };
  // The QA may pass automatically. Only the owner may approve the Reel.
  // Do not create SCHEDULED publication jobs in this background pipeline.
  return { reviewed: 1, approved: false, scheduled: false, reason: "REEL_QA_PASS_AWAITING_USER_REVIEW" };
}
