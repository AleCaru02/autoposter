import { statSync } from "node:fs";
import { runMediaBinary } from "./media-binaries.js";
import { reelMediaPreflight } from "../reel-video-provider.js";
import { REEL_HEIGHT, REEL_WIDTH } from "./reel-captions.js";
import { REEL_MAX_SECONDS, REEL_MIN_SECONDS } from "./reel-render.js";

export type ReelProbe = {
  mimeType: "video/mp4";
  container: string;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string;
  audioSampleRate: number;
  durationSeconds: number;
  sizeBytes: number;
  pixelFormat: string;
};

function parseRate(rate: unknown) {
  if (typeof rate !== "string") return 0;
  const [num, den] = rate.split("/").map(Number);
  return den ? num / den : Number(num) || 0;
}

export function parseFfprobeJson(json: string, sizeBytes: number): ReelProbe {
  const data = JSON.parse(json) as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> };
  const video = data.streams?.find((stream) => stream.codec_type === "video") ?? {};
  const audio = data.streams?.find((stream) => stream.codec_type === "audio") ?? {};
  return {
    mimeType: "video/mp4",
    container: String(data.format?.format_name ?? ""),
    width: Number(video.width ?? 0),
    height: Number(video.height ?? 0),
    fps: Number(parseRate(video.avg_frame_rate).toFixed(3)),
    videoCodec: String(video.codec_name ?? ""),
    audioCodec: String(audio.codec_name ?? ""),
    audioSampleRate: Number(audio.sample_rate ?? 0),
    durationSeconds: Number(Number(data.format?.duration ?? 0).toFixed(3)),
    sizeBytes,
    pixelFormat: String(video.pix_fmt ?? ""),
  };
}

export async function probeReel(path: string): Promise<ReelProbe> {
  const result = await runMediaBinary("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", path], { timeoutMs: 30_000 });
  if (result.code !== 0) throw new Error("REEL_PROBE_FAILED");
  return parseFfprobeJson(result.stdout, statSync(path).size);
}

/** Social playback target (Instagram/Facebook/TikTok normalise around -14 LUFS). */
export const REEL_LOUDNESS_TARGET = Object.freeze({ integratedLufs: -14, truePeakDb: -1.5, lra: 11 });
export const REEL_LOUDNESS_TOLERANCE_LU = 2;
export const REEL_TRUE_PEAK_MAX_DB = -1;

export type LoudnessMeasure = { integratedLufs: number; truePeakDb: number; lra: number; threshold: number; offset: number };

/** Parses the JSON block printed by loudnorm(print_format=json). */
export function parseLoudnormJson(stderr: string): LoudnessMeasure {
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("REEL_LOUDNESS_PARSE_FAILED");
  const data = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
  const value = (key: string) => {
    const parsed = Number(data[key]);
    if (!Number.isFinite(parsed)) throw new Error(`REEL_LOUDNESS_PARSE_FAILED:${key}`);
    return parsed;
  };
  return { integratedLufs: value("input_i"), truePeakDb: value("input_tp"), lra: value("input_lra"), threshold: value("input_thresh"), offset: value("target_offset") };
}

/** First loudnorm pass: measures integrated loudness, true peak and range of a file (no output). */
export async function measureLoudness(path: string): Promise<LoudnessMeasure> {
  const target = REEL_LOUDNESS_TARGET;
  const result = await runMediaBinary("ffmpeg", ["-hide_banner", "-nostats", "-i", path, "-vn", "-af", `loudnorm=I=${target.integratedLufs}:TP=${target.truePeakDb}:LRA=${target.lra}:print_format=json`, "-f", "null", "-"], { timeoutMs: 90_000 });
  if (result.code !== 0) throw new Error("REEL_LOUDNESS_MEASURE_FAILED");
  return parseLoudnormJson(result.stderrTail);
}

/** Second loudnorm pass, linear when possible: same gain on the whole narration, true-peak limited. */
export function loudnormFilter(measured: LoudnessMeasure) {
  const target = REEL_LOUDNESS_TARGET;
  return `loudnorm=I=${target.integratedLufs}:TP=${target.truePeakDb}:LRA=${target.lra}:measured_I=${measured.integratedLufs}:measured_TP=${measured.truePeakDb}:measured_LRA=${measured.lra}:measured_thresh=${measured.threshold}:offset=${measured.offset}:linear=true:print_format=none`;
}

/** Audio QA on the rendered Reel: loudness near the social target and no clipping. */
export function loudnessQa(measured: Pick<LoudnessMeasure, "integratedLufs" | "truePeakDb">) {
  const errors: string[] = [];
  if (Math.abs(measured.integratedLufs - REEL_LOUDNESS_TARGET.integratedLufs) > REEL_LOUDNESS_TOLERANCE_LU) errors.push("REEL_LOUDNESS_OUT_OF_RANGE");
  if (measured.truePeakDb > REEL_TRUE_PEAK_MAX_DB) errors.push("REEL_TRUE_PEAK_CLIPPING");
  return errors;
}

export async function probeAudioSeconds(path: string) {
  const result = await runMediaBinary("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path], { timeoutMs: 20_000 });
  const seconds = Number(result.stdout.trim());
  if (result.code !== 0 || !Number.isFinite(seconds) || seconds <= 0) throw new Error("REEL_AUDIO_PROBE_FAILED");
  return Number(seconds.toFixed(3));
}

/**
 * Technical QA gate for a publishable Instagram/Facebook Reel. Combines the provider-neutral
 * preflight from the Higgsfield adapter with the stricter house spec (exact 1080x1920, audio, fps).
 */
export function reelTechnicalQa(probe: ReelProbe, expectedSeconds?: number) {
  const base = reelMediaPreflight({ mimeType: probe.mimeType, durationSeconds: probe.durationSeconds, width: probe.width, height: probe.height, videoCodec: probe.videoCodec, audioCodec: probe.audioCodec, sizeBytes: probe.sizeBytes });
  const errors = [...base.errors];
  if (!/mp4|mov/.test(probe.container)) errors.push("REEL_CONTAINER_NOT_MP4");
  if (probe.width !== REEL_WIDTH || probe.height !== REEL_HEIGHT) errors.push("REEL_NOT_1080X1920");
  if (probe.fps < 23 || probe.fps > 60) errors.push("REEL_FPS_INVALID");
  if (probe.pixelFormat !== "yuv420p") errors.push("REEL_PIXEL_FORMAT_INVALID");
  if (probe.audioSampleRate !== 48_000 && probe.audioSampleRate !== 44_100) errors.push("REEL_AUDIO_SAMPLE_RATE_INVALID");
  if (probe.durationSeconds < REEL_MIN_SECONDS || probe.durationSeconds > REEL_MAX_SECONDS) errors.push("REEL_DURATION_OUT_OF_HOUSE_RANGE");
  if (expectedSeconds && Math.abs(probe.durationSeconds - expectedSeconds) > 0.6) errors.push("REEL_DURATION_MISMATCH");
  if (probe.sizeBytes > 100_000_000) errors.push("REEL_FILE_TOO_LARGE");
  return { status: errors.length ? "FAIL" as const : "PASS" as const, errors: [...new Set(errors)], probe };
}
