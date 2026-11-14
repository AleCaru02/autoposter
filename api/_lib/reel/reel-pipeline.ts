import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CapabilityKey } from "../capabilities.js";
import type { TechnicalUsage } from "./capability-meter.js";
import { narrationText, validateReelScript, type ReelScript, type ReelSource } from "./reel-script.js";
import { renderCaptionPng, splitCaptionCues, timeCaptionCues } from "./reel-captions.js";
import { extractFrame, renderReel } from "./reel-render.js";
import { probeAudioSeconds, probeReel, reelTechnicalQa, type ReelProbe } from "./reel-probe.js";
import { estimateTtsCostUsd } from "./openai-tts.js";

/**
 * Resumable Reel pipeline. Each step is idempotent and persists its artifacts before the next
 * one starts, so an interrupted function resumes from the saved step instead of paying twice.
 * Progress shown to the user = steps_completed / steps_total (no invented percentages).
 */
export const REEL_STEPS = ["SCRIPT", "VISUALS", "VOICE", "RENDER", "QA"] as const;
export type ReelStep = (typeof REEL_STEPS)[number] | "DONE";

export type StoredArtifact = { url: string; sizeBytes: number; contentType: string };
export type ReelArtifacts = {
  script?: ReelScript;
  scenes?: Array<StoredArtifact & { index: number }>;
  voice?: StoredArtifact & { seconds: number; model: string; voice: string };
  video?: StoredArtifact & { probe: ReelProbe; renderMs: number };
  cover?: StoredArtifact;
  qa?: { technical: "PASS" | "FAIL"; errors: string[] };
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
  generateScript(source: ReelSource): Promise<{ value: ReelScript; usage: TechnicalUsage[] }>;
  /** Generates one 9:16 still (metered internally through ImageGenerationMetering). */
  generateSceneImage(input: { job: RenderJob; context: ReelContext; index: number; visualBrief: string; voiceover: string }): Promise<{ stored: StoredArtifact; costUsd: number }>;
  synthesize(text: string, tone: string | null): Promise<{ value: { audio: Uint8Array; model: string; voice: string }; usage: TechnicalUsage[] }>;
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

function nextStep(step: ReelStep): ReelStep {
  const index = REEL_STEPS.indexOf(step as (typeof REEL_STEPS)[number]);
  return index < 0 || index === REEL_STEPS.length - 1 ? "DONE" : REEL_STEPS[index + 1];
}

/** Scene durations follow the share of narration each scene speaks; the tail holds the CTA. */
export function sceneDurations(script: ReelScript, narrationSeconds: number, tailSeconds = 0.6) {
  const lengths = script.scenes.map((scene) => Math.max(scene.voiceover.trim().length, 1));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  const durations = lengths.map((length) => Math.max(1, (length / total) * narrationSeconds));
  durations[durations.length - 1] += tailSeconds;
  const scale = (narrationSeconds + tailSeconds) / durations.reduce((sum, value) => sum + value, 0);
  return durations.map((value) => Number((value * scale).toFixed(3)));
}

async function runScript(job: RenderJob, deps: ReelDeps, context: ReelContext) {
  if (job.artifacts.script) return { artifacts: job.artifacts, cost: 0 }; // resume: already paid and persisted
  const result = await deps.metered({
    capability: "ai.reel.script",
    idempotencyKey: `reel-script:v1:${job.id}`,
    estimatedUsd: 0.08,
    run: () => deps.generateScript(context.source),
    encode: (script) => ({ script }),
    decode: (cached) => cached.script as ReelScript,
  });
  const errors = validateReelScript(result.value, context.source);
  if (errors.length) throw new ReelPipelineError("REEL_SCRIPT_REJECTED", false, errors.join(","));
  return { artifacts: { ...job.artifacts, script: result.value }, cost: result.costUsd };
}

async function runVisuals(job: RenderJob, deps: ReelDeps, context: ReelContext) {
  const script = job.artifacts.script;
  if (!script) throw new ReelPipelineError("REEL_SCRIPT_MISSING", false);
  const scenes = [...(job.artifacts.scenes ?? [])];
  let cost = 0;
  for (const [index, scene] of script.scenes.entries()) {
    if (scenes.some((stored) => stored.index === index)) continue; // resume: never regenerate a stored still
    const image = await deps.generateSceneImage({ job, context, index, visualBrief: scene.visualBrief, voiceover: scene.voiceover });
    scenes.push({ ...image.stored, index });
    cost += image.costUsd;
    // Persist after every still so a timeout mid-step keeps what was already paid for.
    await deps.saveStep(job, { step: "VISUALS", stepsCompleted: job.steps_completed, artifacts: { ...job.artifacts, scenes }, costDeltaUsd: image.costUsd });
    job.artifacts = { ...job.artifacts, scenes };
    job.cost_usd += image.costUsd;
  }
  return { artifacts: { ...job.artifacts, scenes: scenes.sort((a, b) => a.index - b.index) }, cost: 0, alreadyCounted: cost };
}

async function runVoice(job: RenderJob, deps: ReelDeps, context: ReelContext) {
  const script = job.artifacts.script;
  if (!script) throw new ReelPipelineError("REEL_SCRIPT_MISSING", false);
  if (job.artifacts.voice) return { artifacts: job.artifacts, cost: 0 }; // resume: already paid and persisted
  const text = narrationText(script);
  type Voice = NonNullable<ReelArtifacts["voice"]>;
  const result = await deps.metered<Voice>({
    capability: "ai.voice.tts",
    idempotencyKey: `reel-tts:v1:${job.id}`,
    estimatedUsd: 0.05,
    // Audio is measured and stored inside the metered call: a resume after commit reuses the stored file.
    run: async () => {
      const spoken = await deps.synthesize(text, context.source.tone);
      const dir = mkdtempSync(join(tmpdir(), "reel-voice-"));
      try {
        const path = join(dir, "voice.mp3");
        writeFileSync(path, spoken.value.audio);
        const seconds = await probeAudioSeconds(path);
        const stored = await deps.store(job, "voice.mp3", spoken.value.audio, "audio/mpeg");
        const usage = spoken.usage.map((event) => ({ ...event, costUsd: event.costUsd ?? estimateTtsCostUsd(seconds), metadata: { ...(event.metadata ?? {}), seconds } }));
        return { value: { ...stored, seconds, model: spoken.value.model, voice: spoken.value.voice }, usage };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    encode: (voice) => ({ voice }),
    decode: (cached) => cached.voice as Voice,
  });
  return { artifacts: { ...job.artifacts, voice: result.value }, cost: result.costUsd };
}

async function runRender(job: RenderJob, deps: ReelDeps, context: ReelContext) {
  const { script, scenes, voice } = job.artifacts;
  if (!script || !scenes || scenes.length !== script.scenes.length || !voice) throw new ReelPipelineError("REEL_RENDER_INPUTS_MISSING", false);
  const dir = mkdtempSync(join(tmpdir(), "reel-render-"));
  try {
    const durations = sceneDurations(script, voice.seconds);
    const renderScenes = [];
    for (const scene of scenes) {
      const path = join(dir, `scene-${scene.index}.png`);
      writeFileSync(path, await deps.fetchArtifact(scene.url));
      renderScenes.push({ imagePath: path, durationSeconds: durations[scene.index] });
    }
    const audioPath = join(dir, "voice.mp3");
    writeFileSync(audioPath, await deps.fetchArtifact(voice.url));
    const cues = timeCaptionCues(splitCaptionCues(narrationText(script)), voice.seconds);
    const captions = [];
    for (const [index, cue] of cues.entries()) {
      const pngPath = join(dir, `caption-${index}.png`);
      writeFileSync(pngPath, await renderCaptionPng(cue.text, { accentColor: context.brandAccent ?? undefined }));
      captions.push({ pngPath, start: cue.start, end: cue.end });
    }
    const outputPath = join(dir, "reel.mp4");
    const rendered = await renderReel({ scenes: renderScenes, captions, audioPath, outputPath });
    const probe = await probeReel(outputPath);
    const coverPath = join(dir, "cover.png");
    await extractFrame(outputPath, Math.min(1, probe.durationSeconds / 2), coverPath);
    const video = await deps.store(job, "reel.mp4", readFileSync(outputPath), "video/mp4");
    const cover = await deps.store(job, "cover.png", readFileSync(coverPath), "image/png");
    return { artifacts: { ...job.artifacts, video: { ...video, probe, renderMs: rendered.durationMs }, cover }, cost: 0 };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runQa(job: RenderJob) {
  const video = job.artifacts.video;
  if (!video) throw new ReelPipelineError("REEL_VIDEO_MISSING", false);
  const expected = job.artifacts.voice ? job.artifacts.voice.seconds + 0.6 : undefined;
  const qa = reelTechnicalQa(video.probe, expected);
  if (qa.status !== "PASS") throw new ReelPipelineError("REEL_TECHNICAL_QA_FAILED", false, qa.errors.join(","));
  return { artifacts: { ...job.artifacts, qa: { technical: qa.status, errors: qa.errors } }, cost: 0 };
}

export type AdvanceResult =
  | { state: "READY_FOR_REVIEW"; outputVariantId: string; videoAssetId: string }
  | { state: "RUNNING"; step: ReelStep; reason: "DEADLINE" };

/** Runs steps until done or until the deadline would be exceeded by the next heavy step. */
export async function advanceRenderJob(job: RenderJob, deps: ReelDeps, options: { deadlineAt: number; reserveMs?: Partial<Record<ReelStep, number>> }): Promise<AdvanceResult> {
  const reserve = { SCRIPT: 45_000, VISUALS: 90_000, VOICE: 45_000, RENDER: 150_000, QA: 10_000, DONE: 0, ...(options.reserveMs ?? {}) };
  const context = await deps.loadContext(job);
  while (job.step !== "DONE") {
    if (deps.now() + reserve[job.step] > options.deadlineAt) return { state: "RUNNING", step: job.step, reason: "DEADLINE" };
    const step = job.step;
    const outcome = step === "SCRIPT" ? await runScript(job, deps, context)
      : step === "VISUALS" ? await runVisuals(job, deps, context)
      : step === "VOICE" ? await runVoice(job, deps, context)
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
