import { REEL_HEIGHT, REEL_WIDTH } from "./reel-captions.js";
import { runMediaBinary } from "./media-binaries.js";

/**
 * Deterministic Reel assembly: one still per scene with a slow Ken Burns move,
 * burned-in caption overlays, narration audio, H.264 High + AAC, 1080x1920, 30 fps, faststart.
 * Uses only filters available in FFmpeg 4.1 (zoompan, fade, concat, overlay, apad).
 */
export type ReelSceneInput = { imagePath: string; durationSeconds: number };
export type ReelCaptionInput = { pngPath: string; start: number; end: number };
export type ReelRenderInput = {
  scenes: ReelSceneInput[];
  captions: ReelCaptionInput[];
  audioPath: string;
  outputPath: string;
  fps?: number;
};

export const REEL_FPS = 30;
export const REEL_MIN_SECONDS = 3;
export const REEL_MAX_SECONDS = 90;

function seconds(value: number) {
  return Number(value.toFixed(3));
}

export function reelTotalSeconds(scenes: ReelSceneInput[]) {
  return seconds(scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0));
}

export function validateReelRenderInput(input: ReelRenderInput) {
  if (!input.scenes.length || input.scenes.length > 12) throw new Error("REEL_SCENES_INVALID");
  if (input.scenes.some((scene) => !Number.isFinite(scene.durationSeconds) || scene.durationSeconds < 1 || scene.durationSeconds > 20)) throw new Error("REEL_SCENE_DURATION_INVALID");
  const total = reelTotalSeconds(input.scenes);
  if (total < REEL_MIN_SECONDS || total > REEL_MAX_SECONDS) throw new Error("REEL_DURATION_INVALID");
  if (input.captions.length > 80) throw new Error("REEL_CAPTIONS_INVALID");
  if (input.captions.some((caption) => !(caption.end > caption.start) || caption.start < 0 || caption.end > total + 0.5)) throw new Error("REEL_CAPTION_TIMING_INVALID");
}

export function buildReelFfmpegArgs(input: ReelRenderInput): string[] {
  validateReelRenderInput(input);
  const fps = input.fps ?? REEL_FPS;
  const total = reelTotalSeconds(input.scenes);
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  for (const scene of input.scenes) args.push("-i", scene.imagePath);
  const audioIndex = input.scenes.length;
  args.push("-i", input.audioPath);
  const captionBase = audioIndex + 1;
  for (const caption of input.captions) args.push("-i", caption.pngPath);

  const filters: string[] = [];
  input.scenes.forEach((scene, index) => {
    const frames = Math.max(1, Math.round(scene.durationSeconds * fps));
    const zoomIn = index % 2 === 0;
    const zoomExpr = zoomIn ? `min(1+0.10*on/${frames},1.10)` : `max(1.10-0.10*on/${frames},1.0)`;
    const fadeOut = Math.max(scene.durationSeconds - 0.25, 0);
    filters.push(
      `[${index}:v]scale=${REEL_WIDTH * 2}:${REEL_HEIGHT * 2}:force_original_aspect_ratio=increase,crop=${REEL_WIDTH * 2}:${REEL_HEIGHT * 2},`
      + `zoompan=z='${zoomExpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${REEL_WIDTH}x${REEL_HEIGHT}:fps=${fps},`
      + `setsar=1,format=yuv420p${index > 0 ? ",fade=t=in:st=0:d=0.25" : ""},fade=t=out:st=${seconds(fadeOut)}:d=0.25[v${index}]`,
    );
  });
  filters.push(`${input.scenes.map((_, index) => `[v${index}]`).join("")}concat=n=${input.scenes.length}:v=1:a=0[base0]`);
  let last = "base0";
  input.captions.forEach((caption, index) => {
    const next = `cap${index}`;
    filters.push(`[${last}][${captionBase + index}:v]overlay=0:0:enable='between(t,${seconds(caption.start)},${seconds(caption.end)})'[${next}]`);
    last = next;
  });
  filters.push(`[${last}]format=yuv420p[vout]`);
  filters.push(`[${audioIndex}:a]aresample=48000,apad,atrim=0:${total}[aout]`);

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p", "-r", String(fps),
    "-c:a", "aac", "-b:a", "160k", "-ac", "2", "-ar", "48000",
    "-t", String(total),
    "-movflags", "+faststart",
    input.outputPath,
  );
  return args;
}

export async function renderReel(input: ReelRenderInput, options: { timeoutMs?: number } = {}) {
  const args = buildReelFfmpegArgs(input);
  const result = await runMediaBinary("ffmpeg", args, { timeoutMs: options.timeoutMs ?? 240_000 });
  if (result.code !== 0) throw new Error(`REEL_RENDER_FAILED: ${result.stderrTail.split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 400)}`);
  return { durationMs: result.durationMs, totalSeconds: reelTotalSeconds(input.scenes) };
}

/** Extracts a still (cover / visual QA frame) at a timestamp. */
export async function extractFrame(videoPath: string, atSeconds: number, outputPath: string) {
  const result = await runMediaBinary("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(seconds(atSeconds)), "-i", videoPath, "-frames:v", "1", outputPath], { timeoutMs: 30_000 });
  if (result.code !== 0) throw new Error("REEL_FRAME_EXTRACT_FAILED");
}
