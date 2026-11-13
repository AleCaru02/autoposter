import { neon } from "@neondatabase/serverless";
import { ActivityBudgetEngine } from "../activity-budget.js";
import { ImageGenerationMetering, technicalEventsFromImageResult } from "../image-generation-metering.js";
import { generateRoutedImage } from "../routed-image.js";
import { normalizeBrandVisualIdentity } from "../brand-visual-identity.js";
import { loadEditorialProfile, loadProfileBrandContext } from "../personal-brand-sources.js";
import { CapabilityMeter } from "./capability-meter.js";
import { generateReelScript } from "./reel-script.js";
import { synthesizeNarration } from "./openai-tts.js";
import { fetchArtifact, storeReelArtifact } from "./reel-storage.js";
import { finalizeRenderJob, saveRenderStep } from "./render-jobs.js";
import { ReelPipelineError, type Metered, type ReelContext, type ReelDeps, type RenderJob } from "./reel-pipeline.js";

export type ReelRuntimeEnv = { DATABASE_URL?: string; OPENAI_API_KEY?: string; BLOB_READ_WRITE_TOKEN?: string };

function base64ToBytes(value: string) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

/** Production dependencies: Neon persistence, entitlement + budget metering, OpenAI, Vercel Blob. */
export function createReelRuntime(env: ReelRuntimeEnv): ReelDeps {
  if (!env.DATABASE_URL) throw new ReelPipelineError("DATABASE_URL_REQUIRED", false);
  if (!env.OPENAI_API_KEY) throw new ReelPipelineError("OPENAI_NOT_CONFIGURED", false);
  if (!env.BLOB_READ_WRITE_TOKEN) throw new ReelPipelineError("REEL_STORAGE_NOT_CONFIGURED", false);
  const sql = neon(env.DATABASE_URL);
  const budget = new ActivityBudgetEngine(env.DATABASE_URL);
  const apiKey = env.OPENAI_API_KEY;
  let profileCache: { id: string; profile: Awaited<ReturnType<typeof loadEditorialProfile>>; brand: Awaited<ReturnType<typeof loadProfileBrandContext>> } | null = null;

  async function profileContext(profileId: string) {
    if (profileCache?.id === profileId) return profileCache;
    const profile = await loadEditorialProfile(sql, profileId, null);
    const brand = await loadProfileBrandContext(sql, profile);
    profileCache = { id: profileId, profile, brand };
    return profileCache;
  }

  const metered: Metered = async (input) => {
    const job = currentJob;
    if (!job) throw new ReelPipelineError("REEL_JOB_CONTEXT_MISSING", false);
    const meter = new CapabilityMeter(env.DATABASE_URL!, input.capability);
    const reservation = await meter.reserve({ profileId: job.profile_id, idempotencyKey: input.idempotencyKey, source: "REEL_ENGINE", referenceId: job.id });
    if (reservation.status === "DENIED") throw new ReelPipelineError(`CAPABILITY_${reservation.code}`, false);
    if (reservation.status === "COMPLETED") return { value: input.decode(reservation.cached), costUsd: 0 };
    if (reservation.status === "IN_PROGRESS") throw new ReelPipelineError("REEL_STEP_IN_PROGRESS", true);
    if (reservation.status === "RELEASED") throw new ReelPipelineError("REEL_STEP_PREVIOUSLY_RELEASED", false);
    const eventId = reservation.eventId;
    const preflight = await budget.preflight({ profileId: job.profile_id, task: "COPY_FINAL", importance: "STANDARD", projectedOperationCostUsd: input.estimatedUsd, costBucket: "OTHER_AI" });
    if (!preflight.allowed) {
      await meter.release(eventId, preflight.reason ?? "AI_BUDGET_HARD_STOP");
      throw new ReelPipelineError(preflight.reason ?? "AI_BUDGET_HARD_STOP", false);
    }
    try {
      await meter.markProviderStarted(eventId);
    } catch (error) {
      await meter.release(eventId, error instanceof Error ? error.message : "PROVIDER_COST_BUDGET_REACHED");
      throw new ReelPipelineError("PROVIDER_COST_BUDGET_REACHED", false);
    }
    // From here the provider may bill: failures commit nothing but keep the reservation auditable.
    let result: Awaited<ReturnType<typeof input.run>>;
    try {
      result = await input.run();
    } catch (error) {
      await meter.release(eventId, error instanceof Error ? error.message : "PROVIDER_FAILED");
      throw error;
    }
    await meter.persistUsage(job.profile_id, eventId, result.usage);
    await meter.commit(eventId, input.encode(result.value));
    const costUsd = result.usage.reduce((sum, event) => sum + (event.costUsd ?? 0), 0);
    return { value: result.value, costUsd };
  };

  let currentJob: RenderJob | null = null;

  return {
    now: () => Date.now(),
    async loadContext(job) {
      currentJob = job;
      if (!job.source_variant_id) throw new ReelPipelineError("REEL_SOURCE_NOT_ELIGIBLE", false);
      const rows = await sql`
        select variant.content_id::text as content_id, variant.provider, variant.hook, variant.caption, variant.cta, variant.visual_brief,
               item.topic, item.objective
        from public.content_variants variant
        join public.content_items item on item.id=variant.content_id and item.profile_id=variant.profile_id
        where variant.id=${job.source_variant_id}::uuid and variant.profile_id=${job.profile_id}::uuid
        limit 1` as unknown as Array<{ content_id: string; provider: string; hook: string | null; caption: string | null; cta: string | null; visual_brief: string | null; topic: string; objective: string | null }>;
      const row = rows[0];
      if (!row) throw new ReelPipelineError("REEL_SOURCE_NOT_ELIGIBLE", false);
      const { profile, brand } = await profileContext(job.profile_id);
      const visual = normalizeBrandVisualIdentity(brand.visualIdentity);
      const context: ReelContext = {
        contentId: row.content_id,
        provider: row.provider === "FACEBOOK" ? "FACEBOOK" : "INSTAGRAM",
        brandAccent: visual.activeSocialPalette?.primary ?? null,
        source: {
          profileName: profile.name,
          industry: profile.industry ?? null,
          tone: brand.brand.tone ?? null,
          topic: row.topic,
          hook: row.hook,
          caption: row.caption,
          cta: row.cta,
          visualBrief: row.visual_brief,
          confirmedFacts: [brand.brand.description, brand.brand.userContext, brand.brand.location, brand.brand.serviceArea].filter((value): value is string => Boolean(value)),
        },
      };
      return context;
    },
    metered,
    async generateScript(source) {
      const result = await generateReelScript({ apiKey, source });
      return { value: result.script, usage: [{ operation: "REEL_SCRIPT", model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd, metadata: { response_id: result.responseId } }] };
    },
    async generateSceneImage({ job, context, index, visualBrief, voiceover }) {
      const imageMeter = new ImageGenerationMetering(env.DATABASE_URL!);
      const reservation = await imageMeter.reserve({ profileId: job.profile_id, source: "MANUAL", operationIdentity: `reel:${job.id}:scene:${index}`, referenceId: job.id, requestFingerprint: { visualBrief, index } });
      if (reservation.status === "DENIED") throw new ReelPipelineError(`CAPABILITY_${reservation.code}`, false);
      if (reservation.status === "IN_PROGRESS") throw new ReelPipelineError("REEL_STEP_IN_PROGRESS", true);
      if (reservation.status === "COMPLETED") {
        const cached = reservation.cached.response as { url?: string; sizeBytes?: number; contentType?: string } | undefined;
        if (cached?.url) return { stored: { url: cached.url, sizeBytes: Number(cached.sizeBytes ?? 0), contentType: cached.contentType ?? "image/png" }, costUsd: 0 };
      }
      if (reservation.status !== "RESERVED") throw new ReelPipelineError("REEL_SCENE_IMAGE_RELEASED", false);
      const eventId = reservation.eventId;
      const preflight = await budget.preflight({ profileId: job.profile_id, task: "IMAGE_STANDARD", importance: "STANDARD", projectedOperationCostUsd: 0.25, costBucket: "OTHER_AI" });
      if (!preflight.allowed) {
        await imageMeter.release(eventId, preflight.reason ?? "AI_BUDGET_HARD_STOP");
        throw new ReelPipelineError(preflight.reason ?? "AI_BUDGET_HARD_STOP", false);
      }
      const { profile, brand } = await profileContext(job.profile_id);
      const visual = normalizeBrandVisualIdentity(brand.visualIdentity);
      try {
        await imageMeter.markProviderStarted(eventId);
      } catch (error) {
        await imageMeter.release(eventId, error instanceof Error ? error.message : "PROVIDER_COST_BUDGET_REACHED");
        throw new ReelPipelineError("PROVIDER_COST_BUDGET_REACHED", false);
      }
      let image: Awaited<ReturnType<typeof generateRoutedImage>>;
      try {
        image = await generateRoutedImage({
          env: { OPENAI_API_KEY: apiKey }, budget: preflight, importance: "STANDARD",
          profileName: profile.name, profileType: profile.profile_type === "PERSONAL_BRAND" ? "PERSONAL_BRAND" : "BUSINESS",
          industry: profile.industry, tone: brand.brand.tone,
          brandColors: [visual.activeSocialPalette.primary, visual.activeSocialPalette.secondary, visual.activeSocialPalette.accent, visual.activeSocialPalette.neutral],
          brandFonts: visual.fonts, brandVisualStyle: visual.visualStyle,
          provider: context.provider, format: "STORY", visualBrief, caption: voiceover,
          additionalDirection: "Fotogramma di un Reel verticale 9:16: nessun testo nell'immagine, soggetto al centro, lascia libera la fascia centrale-bassa per i sottotitoli.",
          typography: null,
        });
      } catch (error) {
        await imageMeter.release(eventId, error instanceof Error ? error.message : "IMAGE_PROVIDER_FAILED");
        throw error;
      }
      await imageMeter.persistTechnicalEvents(job.profile_id, eventId, technicalEventsFromImageResult(image, { source: "REEL_ENGINE", render_job_id: job.id, scene_index: index }));
      const png = base64ToBytes(image.base64);
      const stored = await storeReelArtifact({ profileId: job.profile_id, jobId: job.id, name: `scene-${index}.png`, body: png, contentType: image.mimeType, token: env.BLOB_READ_WRITE_TOKEN });
      await imageMeter.storeResult(eventId, { response: { url: stored.url, sizeBytes: stored.sizeBytes, contentType: stored.contentType }, assetId: null, variantId: null });
      await imageMeter.commit(eventId);
      const costUsd = image.technicalEvents.reduce((sum, event) => sum + (event.costUsd ?? 0), 0) || 0.25;
      return { stored, costUsd };
    },
    async synthesize(text, tone) {
      const spoken = await synthesizeNarration({ apiKey, text, tone });
      return { value: { audio: spoken.audio, model: spoken.model, voice: spoken.voice }, usage: [{ operation: "REEL_TTS", model: spoken.model, inputTokens: null, outputTokens: null, costUsd: null, metadata: { voice: spoken.voice, characters: text.length, request_id: spoken.requestId } }] };
    },
    store: (job, name, body, contentType) => storeReelArtifact({ profileId: job.profile_id, jobId: job.id, name, body, contentType, token: env.BLOB_READ_WRITE_TOKEN }),
    fetchArtifact: (url) => fetchArtifact(url),
    saveStep: (job, patch) => saveRenderStep(sql, job, patch),
    finalize: (job, context, artifacts) => finalizeRenderJob(sql, job, context, artifacts),
  };
}
