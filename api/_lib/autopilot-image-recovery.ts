import { neon } from "@neondatabase/serverless";
import { ActivityBudgetEngine } from "./activity-budget.js";
import { preflightDeterministicTypography } from "./deterministic-text-compositor.js";
import { ImageGenerationMetering, technicalEventsFromImageResult } from "./image-generation-metering.js";
import { imageStorageUrl } from "./image-storage.js";
import { imageSizeForFormat } from "./openai-image.js";
import { generateRoutedImage } from "./routed-image.js";
import { assetContentHashFromBase64, visualFingerprint } from "./asset-intelligence.js";
import { runContentQa } from "./content-qa.js";

/**
 * One-image-only recovery for the previously failed, zero-provider-cost WASM canary.
 * It never generates new copy, bypasses QA, or recovers unrelated profiles/jobs.
 * An idempotent released reservation prevents repeats after any failure.
 */
export async function recoverWasmCanaryImage(env: {
  DATABASE_URL?: string; OPENAI_API_KEY?: string; BLOB_READ_WRITE_TOKEN?: string;
  AUTOPILOT_RETEST_PROFILE_ID?: string; AUTOPILOT_RETEST_CUTOFF_UTC?: string;
}, now = new Date()) {
  const id = env.AUTOPILOT_RETEST_PROFILE_ID ?? "";
  const cutoff = Date.parse(env.AUTOPILOT_RETEST_CUTOFF_UTC ?? "");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuid.test(id) || !Number.isFinite(cutoff) || cutoff > now.getTime() || now.getTime() - cutoff >= 86400000)
    return { state: "DISABLED_SCOPE" };
  if (!env.DATABASE_URL || !env.OPENAI_API_KEY || !env.BLOB_READ_WRITE_TOKEN)
    return { state: "PROVIDER_OR_STORAGE_NOT_CONFIGURED" };

  const sql = neon(env.DATABASE_URL);
  const rows = await sql`
    select v.id::text as variant_id, v.content_id::text as content_id,
      v.provider, v.visual_brief, v.caption, v.hook,
      p.name, p.industry, p.profile_type
    from public.content_variants v
    join public.profiles p on p.id=v.profile_id and p.archived_at is null
    join public.publication_jobs j on j.variant_id=v.id and j.profile_id=v.profile_id and j.state='BLOCKED_APPROVAL'
    join public.social_connections sc on sc.profile_id=v.profile_id and sc.provider=v.provider
      and sc.status='ACTIVE' and sc.token_reference is not null
      and sc.provider_account_id is not null and sc.last_validated_at > now()-interval '48 hours'
    where v.profile_id=${id}::uuid and v.created_at>=${new Date(cutoff).toISOString()}::timestamptz
      and v.eligible=true and v.approval_mode='AUTO' and v.approval_status='PENDING'
      and v.format='POST' and v.image_asset_id is null and v.visual_provider='OPENAI'
      and v.visual_brief is not null and v.hook is not null
      and exists (
        select 1 from public.capability_usage_events e
        left join public.provider_cost_attempts cost on cost.logical_usage_event_id=e.id
        where e.profile_id=v.profile_id and e.reference_id=v.id and e.capability_key='ai.image.generate'
          and e.source='AI_IMAGE_AUTOPILOT' and e.state='RELEASED'
          and e.metadata->>'release_reason' like 'Cannot find package ''wbg''%'
          and (cost.id is null or (cost.provider_started_at is null and cost.actual_usd is null))
      )
    order by v.created_at desc limit 1
  ` as unknown as Array<{
    variant_id:string;content_id:string;provider:"INSTAGRAM"|"FACEBOOK"|"LINKEDIN"|"GBP";
    visual_brief:string;caption:string;hook:string;name:string;industry:string|null;
    profile_type:"BUSINESS"|"PERSONAL_BRAND";
  }>;
  const variant = rows[0];
  if (!variant) return { state: "NO_ELIGIBLE_BLOCKED_CANARY" };
  const meter = new ImageGenerationMetering(env.DATABASE_URL);
  const reservation = await meter.reserve({
    profileId:id,source:"AUTOPILOT",
    operationIdentity:"wasm-canary-image-repair-v1:"+variant.variant_id,
    referenceId:variant.variant_id,
    requestFingerprint:{variantId:variant.variant_id,brief:variant.visual_brief,provider:variant.provider},
  });
  if (reservation.status !== "RESERVED") return { state:"RECOVERY_"+reservation.status };
  const eventId = reservation.eventId;
  let committed = false;
  try {
    const budget = await new ActivityBudgetEngine(env.DATABASE_URL).preflight({
      profileId:id,task:"IMAGE_STANDARD",importance:"STANDARD",
      projectedOperationCostUsd:0.25,costBucket:"OTHER_AI",
    });
    if (!budget.allowed) throw new Error("RECOVERY_BUDGET_BLOCKED");
    const [width,height] = imageSizeForFormat("POST",variant.provider).split("x").map(Number);
    const typography = { brand:variant.name, headline:variant.hook };
    await preflightDeterministicTypography({width,height,...typography});
    await meter.markProviderStarted(eventId);
    const image = await generateRoutedImage({
      env:{OPENAI_API_KEY:env.OPENAI_API_KEY},budget,importance:"STANDARD",
      profileName:variant.name,profileType:variant.profile_type,industry:variant.industry,
      provider:variant.provider,format:"POST",visualBrief:variant.visual_brief,
      caption:variant.caption,typography,
      additionalDirection:"Do not invent people, properties, identities, reviews or numerical claims.",
    });
    await meter.persistTechnicalEvents(id,eventId,technicalEventsFromImageResult(image,{
      source:"AUTOPILOT",provider:variant.provider,format:"POST",recovery:"WASM_CANARY_V1",
    }));
    const assetId = crypto.randomUUID();
    const bytes = new Uint8Array(Buffer.from(image.base64,"base64"));
    const stored = await imageStorageUrl({
      profileId:id,name:assetId,bytes,mimeType:image.mimeType,
      env:{BLOB_READ_WRITE_TOKEN:env.BLOB_READ_WRITE_TOKEN},
    });
    if (stored.mode !== "VERCEL_BLOB_PUBLIC_V1") throw new Error("RECOVERY_BLOB_REQUIRED");
    const hash = await assetContentHashFromBase64(image.base64);
    const fingerprint = await visualFingerprint({visualBrief:variant.visual_brief,aspectRatio:image.aspectRatio});
    const size = /^(\d+)x(\d+)$/.exec(image.size);
    const cost = image.usage.estimatedCostUsd ?? 0.25;
    await sql`insert into public.assets
      (id,profile_id,content_id,source,kind,name,storage_url,mime_type,tags,metadata,
        provider,model,cost_eur,width,height,format,quality_status,identity_status,content_hash,updated_at)
      values (
        ${assetId}::uuid,${id}::uuid,${variant.content_id}::uuid,'AI_IMAGE','IMAGE',
        ${"canary-recovered-"+assetId+".png"},${stored.storageUrl},${image.mimeType},
        '["AI_GENERATED","AUTOPILOT","WASM_CANARY_RECOVERY"]'::jsonb,
        ${JSON.stringify({provider:"OPENAI",model:image.model,quality:image.quality,size:image.size,
          format:image.outputFormat,prompt_version:image.promptVersion,cost_usd:cost,
          aspect_ratio:image.aspectRatio,visual_brief:variant.visual_brief,
          visual_fingerprint:fingerprint,provider_request_id:image.requestId,
          storage_mode:"VERCEL_BLOB_PUBLIC_V1",recovery:"WASM_CANARY_V1"})}::jsonb,
        'OPENAI',${image.model},${Number(cost)},${size?Number(size[1]):null},${size?Number(size[2]):null},
        ${image.aspectRatio},'PENDING','NOT_REQUIRED',${hash},now()
      )`;
    const linked = await sql`update public.content_variants
      set image_asset_id=${assetId}::uuid,visual_model=${image.model},
        visual_actual_cost_eur=${Number(cost)},visual_generation_status='PASS',updated_at=now()
      where id=${variant.variant_id}::uuid and profile_id=${id}::uuid and image_asset_id is null
      returning id` as unknown as Array<{id:string}>;
    if (!linked.length) throw new Error("RECOVERY_VARIANT_CONFLICT");
    await meter.storeResult(eventId,{response:{assetId},assetId,variantId:variant.variant_id});
    await meter.commit(eventId);
    committed = true;
    const qa = await runContentQa({
      databaseUrl:env.DATABASE_URL,apiKey:env.OPENAI_API_KEY,
      profileId:id,contentId:variant.content_id,variantId:variant.variant_id,actorType:"AUTOPILOT",
    }).catch(() => null);
    if (!qa || qa.overallStatus !== "PASS") return {state:"IMAGE_SAVED_QA_NOT_PASS"};
    const approved = await sql`select public.auto_approve_content_variant(
      ${id}::uuid,${variant.variant_id}::uuid,'SYSTEM_AUTOPILOT') as approved` as unknown as Array<{approved:boolean}>;
    if (!approved[0]?.approved) return {state:"QA_PASS_APPROVAL_BLOCKED"};
    const scheduled = await sql`update public.publication_jobs
      set state='SCHEDULED',updated_at=now()
      where variant_id=${variant.variant_id}::uuid and profile_id=${id}::uuid
        and state='BLOCKED_APPROVAL' and scheduled_at>now()+interval '10 minutes'
      returning id` as unknown as Array<{id:string}>;
    return {state:scheduled.length ? "IMAGE_QA_PASS_SCHEDULED" : "IMAGE_QA_PASS_NOT_SCHEDULED"};
  } catch (error) {
    if (!committed) await meter.release(eventId,error instanceof Error?error.message:"RECOVERY_FAILED").catch(() => undefined);
    return {state:"RECOVERY_FAILED",code:error instanceof Error?error.message.split(":")[0].slice(0,70):"UNKNOWN"};
  }
}
