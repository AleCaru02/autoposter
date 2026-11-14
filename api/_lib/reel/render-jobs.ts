import { neon } from "@neondatabase/serverless";
import type { RenderJob, ReelArtifacts, ReelStep, ReelContext } from "./reel-pipeline.js";

/**
 * Persistence for render_jobs. Every write after a claim is guarded by claim_token, so a
 * worker whose lease expired can never overwrite the progress of the worker that resumed it.
 */
type Sql = ReturnType<typeof neon>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const RENDER_LEASE_SECONDS = 290;

type JobRow = {
  id: string; profile_id: string; source_variant_id: string | null; step: ReelStep; steps_completed: number; steps_total: number;
  attempt_count: number; max_attempts: number; claim_token: string | null; artifacts: unknown; cost_usd: number | string; input?: unknown;
};

function toJob(row: JobRow): RenderJob {
  if (!row.claim_token) throw new Error("RENDER_JOB_NOT_CLAIMED");
  return {
    id: row.id, profile_id: row.profile_id, source_variant_id: row.source_variant_id, step: row.step,
    steps_completed: Number(row.steps_completed), steps_total: Number(row.steps_total), attempt_count: Number(row.attempt_count),
    max_attempts: Number(row.max_attempts), claim_token: row.claim_token,
    artifacts: (row.artifacts && typeof row.artifacts === "object" ? row.artifacts : {}) as ReelArtifacts,
    cost_usd: Number(row.cost_usd) || 0,
    dry_run: Boolean(row.input && typeof row.input === "object" && (row.input as Record<string, unknown>).dryRun === true),
  };
}

export async function enqueueReelJob(sql: Sql, input: { profileId: string; sourceVariantId: string; requestId: string; requestedBy: string | null; dryRun?: boolean }) {
  if (![input.profileId, input.sourceVariantId, input.requestId].every((value) => UUID.test(value))) throw new Error("REEL_ENQUEUE_INPUT_INVALID");
  const sources = await sql`
    select variant.id::text from public.content_variants variant
    join public.profiles profile on profile.id=variant.profile_id and profile.archived_at is null
    where variant.id=${input.sourceVariantId}::uuid and variant.profile_id=${input.profileId}::uuid
      and coalesce(variant.format,'') <> 'REEL' and length(coalesce(variant.caption,'')) >= 40
    limit 1` as unknown as Array<{ id: string }>;
  if (!sources[0]) throw new Error("REEL_SOURCE_NOT_ELIGIBLE");
  const active = await sql`
    select count(*)::int as count from public.render_jobs
    where profile_id=${input.profileId}::uuid and state in ('QUEUED','RUNNING')` as unknown as Array<{ count: number }>;
  if ((active[0]?.count ?? 0) >= 3) throw new Error("REEL_QUEUE_FULL");
  const rows = await sql`
    insert into public.render_jobs (profile_id,source_variant_id,kind,idempotency_key,input,requested_by)
    values (${input.profileId}::uuid,${input.sourceVariantId}::uuid,'REEL_FACELESS',${`${input.dryRun ? "reel-dry" : "reel"}:v1:${input.sourceVariantId}:${input.requestId}`},
            ${JSON.stringify({ sourceVariantId: input.sourceVariantId, dryRun: input.dryRun === true })}::jsonb,${input.requestedBy})
    on conflict (idempotency_key) do update set updated_at=public.render_jobs.updated_at
    returning id::text, state, (xmax = 0) as created` as unknown as Array<{ id: string; state: string; created: boolean }>;
  return rows[0];
}

export async function claimRenderJob(sql: Sql, jobId: string) {
  const rows = await sql`select * from public.claim_render_job(${jobId}::uuid, ${RENDER_LEASE_SECONDS})` as unknown as JobRow[];
  return rows[0] ? toJob(rows[0]) : null;
}

export async function claimDueRenderJobs(sql: Sql, limit = 1) {
  const rows = await sql`select * from public.claim_due_render_jobs(${limit}, ${RENDER_LEASE_SECONDS})` as unknown as JobRow[];
  return rows.map(toJob);
}

export async function saveRenderStep(sql: Sql, job: RenderJob, patch: { step: ReelStep; stepsCompleted: number; artifacts: ReelArtifacts; costDeltaUsd: number }) {
  const rows = await sql`
    update public.render_jobs
    set step=${patch.step}, steps_completed=${patch.stepsCompleted}, artifacts=${JSON.stringify(patch.artifacts)}::jsonb,
        cost_usd=cost_usd+${Math.max(patch.costDeltaUsd, 0)}, last_error_code=null, last_error_message=null,
        lease_expires_at=clock_timestamp()+make_interval(secs => ${RENDER_LEASE_SECONDS}), updated_at=clock_timestamp()
    where id=${job.id}::uuid and claim_token=${job.claim_token}::uuid and state='RUNNING'
    returning id` as unknown as Array<{ id: string }>;
  if (!rows[0]) throw new Error("RENDER_LEASE_LOST");
}

/** Yields after a deadline: the work done is saved, the attempt is not consumed. */
export async function yieldRenderJob(sql: Sql, job: RenderJob) {
  await sql`
    update public.render_jobs
    set state='QUEUED', claim_token=null, lease_expires_at=null, next_attempt_at=clock_timestamp(),
        attempt_count=greatest(attempt_count-1,0), updated_at=clock_timestamp()
    where id=${job.id}::uuid and claim_token=${job.claim_token}::uuid and state='RUNNING'`;
}

export function classifyRenderError(code: string) {
  if (/^(AI_BUDGET_|PROVIDER_COST_BUDGET|CAPABILITY_|AUTOPILOT_IMAGE_BUDGET|MODEL_ROUTER_BLOCKED_BUDGET)/.test(code)) return { state: "BLOCKED" as const, retryable: false };
  if (/^OPENAI_[A-Z_]+_HTTP_(400|401|403|404)$/.test(code)) return { state: "FAILED" as const, retryable: false };
  if (/^(REEL_SCRIPT_REJECTED|REEL_TECHNICAL_QA_FAILED|REEL_SOURCE_NOT_ELIGIBLE|REEL_STORAGE_NOT_CONFIGURED|OPENAI_NOT_CONFIGURED|REEL_RENDER_INPUTS_MISSING|REEL_SCRIPT_MISSING|REEL_VIDEO_MISSING)/.test(code)) return { state: "FAILED" as const, retryable: false };
  return { state: "FAILED" as const, retryable: true };
}

export async function failRenderJob(sql: Sql, job: RenderJob, code: string, message: string, retryable: boolean, blocked = false) {
  const canRetry = retryable && job.attempt_count < job.max_attempts;
  const backoffSeconds = Math.min(60 * 2 ** Math.max(job.attempt_count - 1, 0), 900);
  const state = blocked ? "BLOCKED" : canRetry ? "QUEUED" : "FAILED";
  await sql`
    update public.render_jobs
    set state=${state}, last_error_code=${code.slice(0, 120)}, last_error_message=${message.slice(0, 500)},
        claim_token=null, lease_expires_at=null,
        next_attempt_at=clock_timestamp()+make_interval(secs => ${canRetry && !blocked ? backoffSeconds : 0}),
        completed_at=case when ${state} in ('FAILED','BLOCKED') then clock_timestamp() else null end,
        updated_at=clock_timestamp()
    where id=${job.id}::uuid and claim_token=${job.claim_token}::uuid`;
  return state;
}

/** Creates the MP4 + cover assets and the REEL variant atomically, then closes the job. */
export async function finalizeRenderJob(sql: Sql, job: RenderJob, context: ReelContext, artifacts: ReelArtifacts) {
  const { script, video, cover, qa } = artifacts;
  if (!script || !video || !cover || qa?.technical !== "PASS") throw new Error("REEL_FINALIZE_INCOMPLETE");
  const videoAssetId = crypto.randomUUID();
  const coverAssetId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const costEur = Number(job.cost_usd.toFixed(4));
  const tags = JSON.stringify(job.dry_run ? ["REEL", "DRY_RUN", context.provider] : ["REEL", "AI_GENERATED", context.provider]);
  await sql.transaction([
    sql`insert into public.assets (id,profile_id,content_id,source,kind,name,storage_url,mime_type,tags,metadata,model,cost_eur,width,height,format,quality_status,identity_status,updated_at)
        values (${videoAssetId}::uuid,${job.profile_id}::uuid,${context.contentId}::uuid,'REEL_RENDER','VIDEO',${`reel-${job.id}.mp4`},${video.url},'video/mp4',${tags}::jsonb,
                ${JSON.stringify({ render_job_id: job.id, probe: video.probe, render_ms: video.renderMs, storage_mode: "VERCEL_BLOB_PUBLIC_V1", narration: artifacts.voice ? { model: artifacts.voice.model, voice: artifacts.voice.voice, seconds: artifacts.voice.seconds } : null })}::jsonb,
                'ffmpeg-4.1-libx264',${costEur},${video.probe.width},${video.probe.height},'9:16','PASS','NOT_REQUIRED',now())`,
    sql`insert into public.assets (id,profile_id,content_id,source,kind,name,storage_url,mime_type,tags,metadata,model,cost_eur,width,height,format,quality_status,identity_status,updated_at)
        values (${coverAssetId}::uuid,${job.profile_id}::uuid,${context.contentId}::uuid,'REEL_COVER','IMAGE',${`reel-${job.id}-cover.png`},${cover.url},'image/png',${tags}::jsonb,
                ${JSON.stringify({ render_job_id: job.id, aspect_ratio: "9:16", storage_mode: "VERCEL_BLOB_PUBLIC_V1" })}::jsonb,
                'ffmpeg-4.1-frame',0,${video.probe.width},${video.probe.height},'9:16','PENDING','NOT_REQUIRED',now())`,
    sql`insert into public.content_variants (id,content_id,profile_id,provider,format,eligible,hook,caption,cta,hashtags,visual_brief,image_asset_id,video_asset_id,alt_text,approval_status,workflow_status,qa_status,approval_mode)
        values (${variantId}::uuid,${context.contentId}::uuid,${job.profile_id}::uuid,${context.provider},'REEL',${!job.dry_run},${script.hook},${script.caption},${script.cta},
                ${JSON.stringify(script.hashtags)}::jsonb,${script.scenes.map((scene) => scene.visualBrief).join(" | ").slice(0, 2000)},${coverAssetId}::uuid,${videoAssetId}::uuid,
                ${`Reel: ${script.coverText}`.slice(0, 300)},'PENDING','REVIEW_REQUIRED','PENDING','MANUAL')`,
    sql`update public.render_jobs
        set state='READY_FOR_REVIEW', step='DONE', steps_completed=steps_total, output_variant_id=${variantId}::uuid, video_asset_id=${videoAssetId}::uuid,
            qa=${JSON.stringify(qa)}::jsonb, claim_token=null, lease_expires_at=null, completed_at=clock_timestamp(), updated_at=clock_timestamp()
        where id=${job.id}::uuid and claim_token=${job.claim_token}::uuid and state='RUNNING'`,
  ]);
  return { outputVariantId: variantId, videoAssetId };
}

export async function listRenderJobs(sql: Sql, profileId: string) {
  return await sql`
    select job.id::text, job.state, job.step, job.steps_completed, job.steps_total, job.attempt_count, job.max_attempts,
           job.last_error_code, job.last_error_message, job.cost_usd::float8 as cost_usd, job.created_at, job.updated_at, job.completed_at,
           job.source_variant_id::text, job.output_variant_id::text, coalesce((job.input->>'dryRun')::boolean,false) as dry_run,
           asset.storage_url as video_url, cover.storage_url as cover_url,
           job.artifacts->'script'->>'title' as title, job.artifacts->'script'->>'hook' as hook,
           (job.artifacts->'video'->'probe'->>'durationSeconds')::float8 as duration_seconds,
           output.workflow_status as output_workflow_status, output.qa_status as output_qa_status, output.caption as output_caption
    from public.render_jobs job
    left join public.assets asset on asset.id=job.video_asset_id and asset.profile_id=job.profile_id
    left join public.content_variants output on output.id=job.output_variant_id and output.profile_id=job.profile_id
    left join public.assets cover on cover.id=output.image_asset_id and cover.profile_id=job.profile_id
    where job.profile_id=${profileId}::uuid
    order by job.created_at desc
    limit 20`;
}
