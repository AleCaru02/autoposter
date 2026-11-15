import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CapabilityKey } from "../capabilities.js";
import type { TechnicalUsage } from "./capability-meter.js";
import { narrationText, REEL_SCRIPT_LENGTH_ERRORS, validateReelScript, type ReelScript, type ReelSource, type ScriptRequestOptions } from "./reel-script.js";
import { renderCaptionPng, splitCaptionCues, timeCaptionCues } from "./reel-captions.js";
import { changeAudioTempo, extractFrame, renderReel } from "./reel-render.js";
import { loudnessQa, loudnormFilter, measureLoudness, probeAudioSeconds, probeReel, reelTechnicalQa, type LoudnessMeasure, type ReelProbe } from "./reel-probe.js";
import { estimateTtsCostUsd, TTS_COST_BASIS, TTS_RATES } from "./openai-tts.js";
import { countWords, DEFAULT_REEL_DURATION, planVoiceFit, REEL_TAIL_SECONDS, scriptTargets, type ReelDurationPolicy } from "./reel-duration.js";

/**
 * Resumable Reel pipeline. Each step is idempotent and persists its artifacts before the next
 * one starts, so an interrupted function resumes from the saved step instead of paying twice.
 * Cheap steps run first: the narration (script + voice) is measured against the duration policy
 * before any image is paid for. Progress shown = steps_completed / steps_total.
 */
export const REEL_STEPS = ["SCRIPT", "VOICE", "VISUALS", "RENDER", "QA"] as const;
export type ReelStep = (typeof REEL_STEPS)[number] | "DONE";

export type StoredArtifact = { url: string; sizeBytes: number; contentType: string };
export type ReelVoiceArtifact = StoredArtifact & {
  seconds: number;
  model: string;
  voice: string;
  /** Narration length as returned by the TTS provider, before any tempo correction. */
  rawSeconds?: number;
  tempo?: number;
  tailSeconds?: number;
  /** Set when the measured voice cannot fit the policy: the job stops before VISUALS. */
  blocked?: { code: string; message: string };
};
export type ReelArtifacts = {
  script?: ReelScript;
  scenes?: Array<StoredArtifact & { index: number }>;
  voice?: ReelVoiceArtifact;
  video?: StoredArtifact & { probe: ReelProbe; renderMs: number; loudness?: Pick<LoudnessMeasure, "integratedLufs" | "truePeakDb" | "lra">; narrationLoudness?: Pick<LoudnessMeasure, "integratedLufs" | "truePeakDb"> };
  cover?: StoredArtifact;
  qa?: { technical: "PASS" | "FAIL"; errors: string[] };
  lengthControl?: { policy: ReelDurationPolicy; scriptWords: number; scriptAttempts: number; scenes: number };
};

export type RenderJob = {
  id: string;
  profile_id: string;
  source_variant_id: string | null;
  step: ReelStep;
  steps_completed: number;
  steps_total: number;
  attempt_count: number;
  max_attempts: number;
  claim_token: string;
  artifacts: ReelArtifacts;
  cost_usd: number;
  /** Preview-only pipeline check with deterministic stand-ins instead of paid AI providers. */
  dry_run: boolean;
  /** Resolved at enqueue (content > profile > default) and stable across resumes. */
  duration?: ReelDurationPolicy;
};

export type ReelContext = { source: ReelSource; contentId: string; provider: "INSTAGRAM" | "FACEBOOK"; brandAccent: string | null };

export type Metered = <T>(input: {
  capability: CapabilityKey;
  idempotencyKey: string;
  estimatedUsd: number;
  run: () => Promise<{ value: T; usage: TechnicalUsage[] }>;
  encode: (value: T) => Record<string, unknown>;
  decode: (cached: Record<string, unknown>) => T;
}) => Promise<{ value: T; costUsd: number }>;

export type ReelDeps = {
  now(): number;
  loadContext(job: RenderJob): Promise<ReelContext>;
  metered: Metered;
  generateScript(source: ReelSource, options: ScriptRequestOptions): Promise<{ value: ReelScript; usage: TechnicalUsage[] }>;
  /** Generates one 9:16 still (metered internally through ImageGenerationMetering). */
  generateSceneImage(input: { job: RenderJob; context: ReelContext; index: number; visualBrief: string; voiceover: string }): Promise<{ stored: StoredArtifact; costUsd: number }>;
  synthesize(text: string, tone: string | null, policy: ReelDurationPolicy): Promise<{ value: { audio: Uint8Array; model: string; voice: string }; usage: TechnicalUsage[] }>;
  store(job: RenderJob, name: string, body: Uint8Array, contentType: string): Promise<StoredArtifact>;
  fetchArtifact(url: string): Promise<Uint8Array>;
  saveStep(job: RenderJob, patch: { step: ReelStep; stepsCompleted: number; artifacts: ReelArtifacts; costDeltaUsd: number }): Promise<void>;
  finalize(job: RenderJob, context: ReelContext, artifacts: ReelArtifacts): Promise<{ outputVariantId: string; videoAssetId: string }>;
};

export class ReelPipelineError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean, message?: string) {
    super(message ?? code);
  }
}

/** Worst-case reserves per paid call (same values the entitlement packages reserve). */
export const REEL_COST_RESERVE_USD = { script: 0.08, image: 0.25, voice: 0.05 } as const;
export const DEFAULT_REEL_JOB_MAX_COST_USD = 2;

/** Hard per-job spending cap: refuse a paid step if the worst case of what is left would exceed it. */
export function assertWithinJobCap(job: RenderJob, projectedRemainingUsd: number, capUsd: number) {
  if (!(capUsd > 0)) throw new ReelPipelineError("REEL_JOB_BUDGET_CAP_INVALID", false);
  if (job.cost_usd + projectedRemainingUsd > capUsd + 1e-9) {
    throw new ReelPipelineError("AI_BUDGET_REEL_JOB_CAP", false, `Spesa prevista ${(job.cost_usd + projectedRemainingUsd).toFixed(2)} $ oltre il tetto di ${capUsd.toFixed(2)} $ per Reel`);
  }
}

export function jobDurationPolicy(job: Pick<RenderJob, "duration">): ReelDurationPolicy {
  return job.duration ?? { ...DEFAULT_REEL_DURATION };
}

function nextStep(step: ReelStep): ReelStep {
  const index = REEL_STEPS.indexOf(step as (typeof REEL_STEPS)[number]);
  return index < 0 || index === REEL_STEPS.length - 1 ? "DONE" : REEL_STEPS[index + 1];
}

/** Scene durations follow the share of narration each scene speaks; the tail holds the CTA. */
export function sceneDurations(script: ReelScript, narrationSeconds: number, tailSeconds = REEL_TAIL_SECONDS) {
  const lengths = script.scenes.map((scene) => Math.max(scene.voiceover.trim().length, 1));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  const durations = lengths.map((length) => Math.max(1, (length / total) * narrationSeconds));
  durations[durations.length - 1] += tailSeconds;
  const scale = (narrationSeconds + tailSeconds) / durations.reduce((sum, value) => sum + value, 0);
  return durations.map((value) => Number((value * scale).toFixed(3)));
}

/** Persists money already spent before a deterministic stop, so job cost always matches usage. */
async function stopAfterSpend(job: RenderJob, deps: ReelDeps, artifacts: ReelArtifacts, spentUsd: number, error: ReelPipelineError): Promise<never> {
  if (spentUsd > 0) {
    await deps.saveStep(job, { step: job.step, stepsCompleted: job.steps_completed, artifacts, costDeltaUsd: spentUsd });
    job.cost_usd += spentUsd;
    job.artifacts = artifacts;
  }
  throw error;
}

async function runScript(job: RenderJob, deps: ReelDeps, context: ReelContext, capUsd: number) {
  if (job.artifacts.script) return { artifacts: job.artifacts, cost: 0 }; // resume: already paid and persisted
  const policy = jobDurationPolicy(job);
  const targets = scriptTargets(policy);
  const worstRest = targets.maxScenes * REEL_COST_RESERVE_USD.image + REEL_COST_RESERVE_USD.voice;
  // Worst case includes one corrective rewrite of the script.
  assertWithinJobCap(job, 2 * REEL_COST_RESERVE_USD.script + worstRest, capUsd);
  const request = (idempotencyKey: string, feedback: string | null) => deps.metered({
    capability: "ai.reel.script",
    idempotencyKey,
    estimatedUsd: REEL_COST_RESERVE_USD.script,
    run: () => deps.generateScript(context.source, { policy, feedback }),
    encode: (script) => ({ script }),
    decode: (cached) => cached.script as ReelScript,
  });
  const first = await request(`reel-script:v1:${job.id}`, null);
  let cost = first.costUsd;
  let script = first.value;
  let attempts = 1;
  let errors = validateReelScript(script, context.source, policy);
  const lengthOnly = errors.length > 0 && errors.every((code) => (REEL_SCRIPT_LENGTH_ERRORS as readonly string[]).includes(code));
  if (lengthOnly) {
    // One corrective rewrite (~0,01 $) is far cheaper than paying images for a Reel that is too long.
    assertWithinJobCap({ ...job, cost_usd: job.cost_usd + cost }, REEL_COST_RESERVE_USD.script + worstRest, capUsd);
    const words = countWords(narrationText(script));
    const feedback = `La versione precedente aveva ${words} parole e ${script.scenes.length} scene. Riscrivila con ${targets.minWords}-${targets.maxWords} parole totali di voiceover e ${targets.minScenes}-${targets.maxScenes} scene, mantenendo hook, messaggio e call to action.`;
    const second = await request(`reel-script:v1:${job.id}:fix1`, feedback);
    cost += second.costUsd;
    script = second.value;
    attempts = 2;
    errors = validateReelScript(script, context.source, policy);
  }
  if (errors.length) return stopAfterSpend(job, deps, job.artifacts, cost, new ReelPipelineError("REEL_SCRIPT_REJECTED", false, errors.join(",")));
  const lengthControl = { policy, scriptWords: countWords(narrationText(script)), scriptAttempts: attempts, scenes: script.scenes.length };
  return { artifacts: { ...job.artifacts, script, lengthControl }, cost };
}

async function runVoice(job: RenderJob, deps: ReelDeps, context: ReelContext, capUsd: number) {
  const script = job.artifacts.script;
  if (!script) throw new ReelPipelineError("REEL_SCRIPT_MISSING", false);
  const policy = jobDurationPolicy(job);
  const existing = job.artifacts.voice;
  if (existing?.blocked) throw new ReelPipelineError(existing.blocked.code, false, existing.blocked.message);
  if (existing) return { artifacts: job.artifacts, cost: 0 }; // resume: already paid and persisted
  assertWithinJobCap(job, REEL_COST_RESERVE_USD.voice + script.scenes.length * REEL_COST_RESERVE_USD.image, capUsd);
  const text = narrationText(script);
  const result = await deps.metered<ReelVoiceArtifact>({
    capability: "ai.voice.tts",
    idempotencyKey: `reel-tts:v1:${job.id}`,
    estimatedUsd: REEL_COST_RESERVE_USD.voice,
    // Audio is measured, fitted to the policy and stored inside the metered call: a resume after
    // commit reuses the stored file and the stored decision.
    run: async () => {
      const spoken = await deps.synthesize(text, context.source.tone, policy);
      const dir = mkdtempSync(join(tmpdir(), "reel-voice-"));
      try {
        const rawPath = join(dir, "voice-raw.mp3");
        writeFileSync(rawPath, spoken.value.audio);
        const rawSeconds = await probeAudioSeconds(rawPath);
        const fit = planVoiceFit(rawSeconds, policy);
        let audio = spoken.value.audio;
        let seconds = rawSeconds;
        if (fit.action === "SPEED_UP") {
          const fittedPath = join(dir, "voice.mp3");
          await changeAudioTempo(rawPath, fittedPath, fit.tempo);
          audio = new Uint8Array(readFileSync(fittedPath));
          seconds = await probeAudioSeconds(fittedPath);
        }
        const stored = await deps.store(job, "voice.mp3", audio, "audio/mpeg");
        const usage = spoken.usage.map((event) => ({ ...event, costUsd: event.costUsd ?? estimateTtsCostUsd(rawSeconds, text.length), metadata: { ...(event.metadata ?? {}), seconds: rawSeconds, ...(event.costUsd == null ? { cost_basis: TTS_COST_BASIS, rates_verified_at: TTS_RATES.verifiedAt } : {}) } }));
        const value: ReelVoiceArtifact = {
          ...stored, seconds, rawSeconds, model: spoken.value.model, voice: spoken.value.voice,
          tempo: fit.action === "SPEED_UP" ? fit.tempo : 1,
          tailSeconds: fit.action === "BLOCK" ? REEL_TAIL_SECONDS : fit.tailSeconds,
          ...(fit.action === "BLOCK" ? { blocked: { code: fit.code, message: fit.message } } : {}),
        };
        return { value, usage };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    encode: (voice) => ({ voice }),
    decode: (cached) => cached.voice as ReelVoiceArtifact,
  });
  const artifacts = { ...job.artifacts, voice: result.value };
  if (result.value.blocked) {
    // The TTS call is paid; images are not. Stop here with the cost recorded.
    return stopAfterSpend(job, deps, artifacts, result.costUsd, new ReelPipelineError(result.value.blocked.code, false, result.value.blocked.message));
  }
  return { artifacts, cost: result.costUsd };
}

async function runVisuals(job: RenderJob, deps: ReelDeps, context: ReelContext, capUsd: number) {
  const script = job.artifacts.script;
  if (!script) throw new ReelPipelineError("REEL_SCRIPT_MISSING", false);
  if (!job.artifacts.voice || job.artifacts.voice.blocked) throw new ReelPipelineError("REEL_VOICE_MISSING", false);
  const scenes = [...(job.artifacts.scenes ?? [])];
  const missingScenes = script.scenes.filter((_, index) => !scenes.some((stored) => stored.index === index)).length;
  assertWithinJobCap(job, missingScenes * REEL_COST_RESERVE_USD.image, capUsd);
  for (const [index, scene] of script.scenes.entries()) {
    if (scenes.some((stored) => stored.index === index)) continue; // resume: never regenerate a stored still
    const image = await deps.generateSceneImage({ job, context, index, visualBrief: scene.visualBrief, voiceover: scene.voiceover });
    scenes.push({ ...image.stored, index });
    // Persist after every still so a timeout mid-step keeps what was already paid for.
    await deps.saveStep(job, { step: "VISUALS", stepsCompleted: job.steps_completed, artifacts: { ...job.artifacts, scenes }, costDeltaUsd: image.costUsd });
    job.artifacts = { ...job.artifacts, scenes };
    job.cost_usd += image.costUsd;
  }
  return { artifacts: { ...job.artifacts, scenes: scenes.sort((a, b) => a.index - b.index) }, cost: 0 };
}

async function runRender(job: RenderJob, deps: ReelDeps, context: ReelContext) {
  const { script, scenes, voice } = job.artifacts;
  if (!script || !scenes || scenes.length !== script.scenes.length || !voice) throw new ReelPipelineError("REEL_RENDER_INPUTS_MISSING", false);
  const dir = mkdtempSync(join(tmpdir(), "reel-render-"));
  try {
    const tail = voice.tailSeconds ?? REEL_TAIL_SECONDS;
    const durations = sceneDurations(script, voice.seconds, tail);
    const renderScenes = [];
    for (const scene of scenes) {
      const path = join(dir, `scene-${scene.index}.png`);
      writeFileSync(path, await deps.fetchArtifact(scene.url));
      renderScenes.push({ imagePath: path, durationSeconds: durations[scene.index] });
    }
    const audioPath = join(dir, "voice.mp3");
    writeFileSync(audioPath, await deps.fetchArtifact(voice.url));
    const narrationLoudness = await measureLoudness(audioPath);
    const cues = timeCaptionCues(splitCaptionCues(narrationText(script)), voice.seconds);
    const captions = [];
    for (const [index, cue] of cues.entries()) {
      const pngPath = join(dir, `caption-${index}.png`);
      writeFileSync(pngPath, await renderCaptionPng(cue.text, { accentColor: context.brandAccent ?? undefined }));
      captions.push({ pngPath, start: cue.start, end: cue.end });
    }
    const outputPath = join(dir, "reel.mp4");
    const rendered = await renderReel({ scenes: renderScenes, captions, audioPath, outputPath, loudnorm: loudnormFilter(narrationLoudness) });
    const probe = await probeReel(outputPath);
    const finalLoudness = await measureLoudness(outputPath);
    const coverPath = join(dir, "cover.png");
    await extractFrame(outputPath, Math.min(1, probe.durationSeconds / 2), coverPath);
    const video = await deps.store(job, "reel.mp4", readFileSync(outputPath), "video/mp4");
    const cover = await deps.store(job, "cover.png", readFileSync(coverPath), "image/png");
    return {
      artifacts: {
        ...job.artifacts,
        video: {
          ...video, probe, renderMs: rendered.durationMs,
          loudness: { integratedLufs: finalLoudness.integratedLufs, truePeakDb: finalLoudness.truePeakDb, lra: finalLoudness.lra },
          narrationLoudness: { integratedLufs: narrationLoudness.integratedLufs, truePeakDb: narrationLoudness.truePeakDb },
        },
        cover,
      },
      cost: 0,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Final gate: technical spec, duration policy and audio loudness/clipping. */
export function reelQaErrors(artifacts: ReelArtifacts, policy: ReelDurationPolicy) {
  const video = artifacts.video;
  if (!video) return ["REEL_VIDEO_MISSING"];
  const expected = artifacts.voice ? artifacts.voice.seconds + (artifacts.voice.tailSeconds ?? REEL_TAIL_SECONDS) : undefined;
  const errors = [...reelTechnicalQa(video.probe, expected).errors];
  if (video.probe.durationSeconds < policy.minSeconds - 0.25 || video.probe.durationSeconds > policy.maxSeconds + 0.25) errors.push("REEL_DURATION_OUT_OF_POLICY");
  if (video.loudness) errors.push(...loudnessQa(video.loudness));
  else errors.push("REEL_LOUDNESS_NOT_MEASURED");
  return [...new Set(errors)];
}

function runQa(job: RenderJob) {
  if (!job.artifacts.video) throw new ReelPipelineError("REEL_VIDEO_MISSING", false);
  const errors = reelQaErrors(job.artifacts, jobDurationPolicy(job));
  if (errors.length) throw new ReelPipelineError("REEL_TECHNICAL_QA_FAILED", false, errors.join(","));
  return { artifacts: { ...job.artifacts, qa: { technical: "PASS" as const, errors } }, cost: 0 };
}

export type AdvanceResult =
  | { state: "READY_FOR_REVIEW"; outputVariantId: string; videoAssetId: string }
  | { state: "RUNNING"; step: ReelStep; reason: "DEADLINE" };

/** Runs steps until done or until the deadline would be exceeded by the next heavy step. */
export async function advanceRenderJob(job: RenderJob, deps: ReelDeps, options: { deadlineAt: number; reserveMs?: Partial<Record<ReelStep, number>>; maxCostUsd?: number }): Promise<AdvanceResult> {
  const capUsd = options.maxCostUsd ?? DEFAULT_REEL_JOB_MAX_COST_USD;
  const reserve = { SCRIPT: 60_000, VOICE: 45_000, VISUALS: 90_000, RENDER: 150_000, QA: 10_000, DONE: 0, ...(options.reserveMs ?? {}) };
  const context = await deps.loadContext(job);
  while (job.step !== "DONE") {
    if (deps.now() + reserve[job.step] > options.deadlineAt) return { state: "RUNNING", step: job.step, reason: "DEADLINE" };
    const step = job.step;
    const outcome = step === "SCRIPT" ? await runScript(job, deps, context, capUsd)
      : step === "VOICE" ? await runVoice(job, deps, context, capUsd)
      : step === "VISUALS" ? await runVisuals(job, deps, context, capUsd)
      : step === "RENDER" ? await runRender(job, deps, context)
      : runQa(job);
    const following = nextStep(step);
    const stepsCompleted = Math.min(job.steps_completed + 1, job.steps_total);
    await deps.saveStep(job, { step: following, stepsCompleted, artifacts: outcome.artifacts, costDeltaUsd: outcome.cost });
    job.step = following;
    job.steps_completed = stepsCompleted;
    job.artifacts = outcome.artifacts;
    job.cost_usd += outcome.cost;
  }
  const output = await deps.finalize(job, context, job.artifacts);
  return { state: "READY_FOR_REVIEW", ...output };
}
