/**
 * Reel duration policy: per content (enqueue request) > per profile (profiles.reel_*_seconds) > default.
 * Every limit is enforced before the next paid step: script (words/scenes) before voice and
 * images, measured voice before images. Nothing expensive runs on an out-of-range plan.
 */
export type ReelDurationSource = "CONTENT" | "PROFILE" | "DEFAULT";
export type ReelDurationPolicy = { minSeconds: number; maxSeconds: number; source: ReelDurationSource };

export const DEFAULT_REEL_DURATION: ReelDurationPolicy = Object.freeze({ minSeconds: 20, maxSeconds: 40, source: "DEFAULT" as const });
export const REEL_DURATION_BOUNDS = Object.freeze({ min: 10, max: 90, minSpan: 5 });
/** Measured 14/11/2026 on the first real Reel: gpt-4o-mini-tts, voice alloy, Italian, 104 words in 52.8 s. */
export const SPOKEN_WORDS_PER_SECOND = 1.95;
/** Silent hold after the narration so the CTA frame stays on screen. */
export const REEL_TAIL_SECONDS = 0.6;
/** Largest speed-up applied to a too-long narration before blocking (keeps the voice natural). */
export const MAX_TEMPO_CORRECTION = 1.12;
/** Largest extra hold allowed to reach the minimum duration on a slightly short narration. */
export const MAX_TAIL_PADDING_SECONDS = 3;

export function normalizeDurationPolicy(value: unknown, source: ReelDurationSource): ReelDurationPolicy | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.minSeconds !== "number" || typeof record.maxSeconds !== "number") return null;
  const min = record.minSeconds;
  const max = record.maxSeconds;
  if (!Number.isInteger(min) || !Number.isInteger(max)) return null;
  if (min < REEL_DURATION_BOUNDS.min || max > REEL_DURATION_BOUNDS.max || max - min < REEL_DURATION_BOUNDS.minSpan) return null;
  return { minSeconds: min, maxSeconds: max, source };
}

export function resolveDurationPolicy(input: { content?: unknown; profile?: { minSeconds: number | null; maxSeconds: number | null } | null }): ReelDurationPolicy {
  const content = normalizeDurationPolicy(input.content, "CONTENT");
  if (content) return content;
  const profile = input.profile ? normalizeDurationPolicy({ minSeconds: input.profile.minSeconds, maxSeconds: input.profile.maxSeconds }, "PROFILE") : null;
  return profile ?? { ...DEFAULT_REEL_DURATION };
}

/** Script targets derived from the policy (prudent: the narration plus tail must fit under max). */
export function scriptTargets(policy: Pick<ReelDurationPolicy, "minSeconds" | "maxSeconds">) {
  const maxWords = Math.floor((policy.maxSeconds - 2) * SPOKEN_WORDS_PER_SECOND);
  const minWords = Math.ceil((policy.minSeconds - 0.5) * SPOKEN_WORDS_PER_SECOND);
  const maxScenes = Math.min(6, Math.max(3, Math.floor(policy.maxSeconds / 6.5)));
  return { minWords, maxWords, minScenes: 3, maxScenes };
}

export function countWords(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

export type VoiceFit =
  | { action: "OK"; tailSeconds: number }
  | { action: "SPEED_UP"; tempo: number; expectedSeconds: number; tailSeconds: number }
  | { action: "BLOCK"; code: "REEL_VOICE_TOO_LONG" | "REEL_VOICE_TOO_SHORT"; message: string };

/** Decides how a measured narration fits the policy: keep, speed up slightly, pad the tail, or block. */
export function planVoiceFit(narrationSeconds: number, policy: Pick<ReelDurationPolicy, "minSeconds" | "maxSeconds">): VoiceFit {
  const maxNarration = policy.maxSeconds - REEL_TAIL_SECONDS;
  let seconds = narrationSeconds;
  let tempo = 1;
  if (seconds > maxNarration) {
    tempo = Number((seconds / (maxNarration - 0.2)).toFixed(4));
    if (tempo > MAX_TEMPO_CORRECTION) {
      return { action: "BLOCK", code: "REEL_VOICE_TOO_LONG", message: `Voce di ${narrationSeconds.toFixed(1)} s: oltre ${policy.maxSeconds} s anche accelerando del ${Math.round((MAX_TEMPO_CORRECTION - 1) * 100)}%` };
    }
    seconds = seconds / tempo;
  }
  let tail = REEL_TAIL_SECONDS;
  if (seconds + tail < policy.minSeconds) {
    const missing = policy.minSeconds - (seconds + tail);
    if (missing > MAX_TAIL_PADDING_SECONDS) {
      return { action: "BLOCK", code: "REEL_VOICE_TOO_SHORT", message: `Voce di ${narrationSeconds.toFixed(1)} s: sotto il minimo di ${policy.minSeconds} s` };
    }
    tail = Number((tail + missing + 0.1).toFixed(3));
  }
  return tempo > 1
    ? { action: "SPEED_UP", tempo, expectedSeconds: Number(seconds.toFixed(3)), tailSeconds: tail }
    : { action: "OK", tailSeconds: tail };
}
