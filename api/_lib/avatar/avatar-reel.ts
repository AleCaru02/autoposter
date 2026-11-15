import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderCaptionPng, splitCaptionCues, timeCaptionCues } from "../reel/reel-captions.js";
import { countWords, SPOKEN_WORDS_PER_SECOND } from "../reel/reel-duration.js";
import { extractFrame, renderAvatarReel, trimVideo } from "../reel/reel-render.js";
import { loudnessQa, loudnormFilter, measureLoudness, probeReel } from "../reel/reel-probe.js";
import { assertWithinJobCap, jobDurationPolicy, ReelPipelineError, runScript, type AdvanceResult, type ReelArtifacts, type ReelContext, type ReelDeps, type ReelStep, type RenderJob, type StoredArtifact } from "../reel/reel-pipeline.js";
import { narrationText } from "../reel/reel-script.js";
import { reelTechnicalQa } from "../reel/reel-probe.js";
import { estimateAvatarRenderUsd, type AvatarProviderId } from "./avatar-provider.js";

/**
 * Avatar Reel = the existing Reel engine with a talking-head step instead of voice + stills:
 *   SCRIPT (same generator, limits, rewrite and metering) -> AVATAR -> RENDER -> QA.
 * The talking-head video and the final MP4 stay in the PRIVATE identity store.
 * Dry run: the AVATAR step reuses the owner's uploaded training video (already consented,
 * no provider call, no cost) so composition, captions, loudness and approval can be checked.
 */
export const AVATAR_REEL_STEPS = ["SCRIPT", "AVATAR", "RENDER", "QA"] as const;
export const DEFAULT_AVATAR_JOB_MAX_COST_USD = 5;

export type AvatarReelDeps = ReelDeps & {
  provider: AvatarProviderId;
  /** Produces the talking-head clip for the script and stores it privately. */
  avatarClip(job: RenderJob, input: { script: string; targetSeconds: number }): Promise<{ pathname: string; seconds: number; simulated: boolean; costUsd: number; renderId?: string }>;
  /** Short-lived signed URL of a private identity file. */
  privateUrl(pathname: string): Promise<string>;
  storePrivate(job: RenderJob, name: string, body: Uint8Array, contentType: string): Promise<StoredArtifact & { pathname: string }>;
};

function nextAvatarStep(step: ReelStep): ReelStep {
  const index = AVATAR_REEL_STEPS.indexOf(step as (typeof AVATAR_REEL_STEPS)[number]);
  return index < 0 || index === AVATAR_REEL_STEPS.length - 1 ? "DONE" : AVATAR_REEL_STEPS[index + 1];
}

/** Target length of the spoken script, clamped inside the duration policy. */
export function avatarTargetSeconds(script: string, policy: { minSeconds: number; maxSeconds: number }) {
  const spoken = countWords(script) / SPOKEN_WORDS_PER_SECOND + 0.6;
  return Number(Math.min(Math.max(spoken, policy.minSeconds + 0.5), policy.maxSeconds - 0.5).toFixed(2));
}

async function runAvatar(job: RenderJob, deps: AvatarReelDeps, capUsd: number) {
  const script = job.artifacts.script;
  if (!script) throw new ReelPipelineError("REEL_SCRIPT_MISSING", false);
  if (job.artifacts.avatar) return { artifacts: job.artifacts, cost: 0 }; // resume: never pay twice
  const text = narrationText(script);
  const targetSeconds = avatarTargetSeconds(text, jobDurationPolicy(job));
  const reserve = job.dry_run ? 0 : estimateAvatarRenderUsd(deps.provider, targetSeconds);
  if (reserve === null) throw new ReelPipelineError("AVATAR_PROVIDER_PRICE_UNKNOWN", false);
  assertWithinJobCap(job, reserve, capUsd);
  const clip = await deps.avatarClip(job, { script: text, targetSeconds });
  return { artifacts: { ...job.artifacts, avatar: { pathname: clip.pathname, seconds: clip.seconds, provider: deps.provider, simulated: clip.simulated, ...(clip.renderId ? { renderId: clip.renderId } : {}) } }, cost: clip.costUsd };
}

async function runAvatarRender(job: RenderJob, deps: AvatarReelDeps, context: ReelContext) {
  const { script, avatar } = job.artifacts;
  if (!script || !avatar) throw new ReelPipelineError("REEL_RENDER_INPUTS_MISSING", false);
  const dir = mkdtempSync(join(tmpdir(), "avatar-render-"));
  try {
    const sourcePath = join(dir, "avatar.mp4");
    writeFileSync(sourcePath, await deps.fetchArtifact(await deps.privateUrl(avatar.pathname)));
    const sourceProbe = await probeReel(sourcePath);
    const durationSeconds = Math.min(sourceProbe.durationSeconds, jobDurationPolicy(job).maxSeconds);
    const loudness = await measureLoudness(sourcePath);
    const cues = timeCaptionCues(splitCaptionCues(narrationText(script)), Math.max(durationSeconds - 0.3, 1));
    const captions = [];
    for (const [index, cue] of cues.entries()) {
      const pngPath = join(dir, `caption-${index}.png`);
      writeFileSync(pngPath, await renderCaptionPng(cue.text, { accentColor: context.brandAccent ?? undefined }));
      captions.push({ pngPath, start: cue.start, end: Math.min(cue.end, durationSeconds) });
    }
    const outputPath = join(dir, "reel.mp4");
    const rendered = await renderAvatarReel({ videoPath: sourcePath, durationSeconds, captions, outputPath, loudnorm: loudnormFilter(loudness) });
    const probe = await probeReel(outputPath);
    const finalLoudness = await measureLoudness(outputPath);
    const coverPath = join(dir, "cover.png");
    await extractFrame(outputPath, Math.min(1, probe.durationSeconds / 2), coverPath);
    const video = await deps.storePrivate(job, "reel.mp4", readFileSync(outputPath), "video/mp4");
    const cover = await deps.storePrivate(job, "cover.png", readFileSync(coverPath), "image/png");
    return {
      artifacts: {
        ...job.artifacts,
        privateMedia: true,
        video: { ...video, probe, renderMs: rendered.durationMs, loudness: { integratedLufs: finalLoudness.integratedLufs, truePeakDb: finalLoudness.truePeakDb, lra: finalLoudness.lra }, narrationLoudness: { integratedLufs: loudness.integratedLufs, truePeakDb: loudness.truePeakDb } },
        cover,
      } as ReelArtifacts,
      cost: 0,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function avatarQaErrors(artifacts: ReelArtifacts, policy: { minSeconds: number; maxSeconds: number }) {
  const video = artifacts.video;
  if (!video) return ["REEL_VIDEO_MISSING"];
  const errors = [...reelTechnicalQa(video.probe).errors];
  if (video.probe.durationSeconds < policy.minSeconds - 0.25 || video.probe.durationSeconds > policy.maxSeconds + 0.25) errors.push("REEL_DURATION_OUT_OF_POLICY");
  if (video.loudness) errors.push(...loudnessQa(video.loudness));
  else errors.push("REEL_LOUDNESS_NOT_MEASURED");
  return [...new Set(errors)];
}

/** Same contract as advanceRenderJob: runs steps until done or until the deadline. */
export async function advanceAvatarReelJob(job: RenderJob, deps: AvatarReelDeps, options: { deadlineAt: number; maxCostUsd?: number }): Promise<AdvanceResult> {
  const capUsd = options.maxCostUsd ?? DEFAULT_AVATAR_JOB_MAX_COST_USD;
  const reserve: Record<string, number> = { SCRIPT: 60_000, AVATAR: 240_000, RENDER: 180_000, QA: 10_000, DONE: 0 };
  const context = await deps.loadContext(job);
  if (job.step === "VOICE" || job.step === "VISUALS") throw new ReelPipelineError("AVATAR_JOB_STEP_INVALID", false);
  while (job.step !== "DONE") {
    if (deps.now() + (reserve[job.step] ?? 60_000) > options.deadlineAt) return { state: "RUNNING", step: job.step, reason: "DEADLINE" };
    const step = job.step;
    let outcome: { artifacts: ReelArtifacts; cost: number };
    if (step === "SCRIPT") outcome = await runScript(job, deps, context, capUsd);
    else if (step === "AVATAR") outcome = await runAvatar(job, deps, capUsd);
    else if (step === "RENDER") outcome = await runAvatarRender(job, deps, context);
    else {
      const errors = avatarQaErrors(job.artifacts, jobDurationPolicy(job));
      if (errors.length) throw new ReelPipelineError("REEL_TECHNICAL_QA_FAILED", false, errors.join(","));
      outcome = { artifacts: { ...job.artifacts, qa: { technical: "PASS", errors } }, cost: 0 };
    }
    const following = nextAvatarStep(step);
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

export { trimVideo };
