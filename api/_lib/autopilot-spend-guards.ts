import type { EditorialIntent } from "./content-agents.js";

/**
 * Free (no AI) checks that run BEFORE a paid autopilot generation, so a deterministic
 * rejection never costs money. Introduced after 12 paid runs in 24h on 15–16/11/2026
 * produced no content.
 */

/** Same window and threshold as findEditorialRepetition (content-dedupe.ts). */
export const NARRATIVE_WINDOW = 12;
export const NARRATIVE_MAX_REPEATS = 3;

/** Evergreen intents that need no external event; NEWS/SEASONAL stay plan-driven only. */
const FALLBACK_INTENTS: readonly EditorialIntent[] = [
  "TIP", "FAQ", "PROBLEM_SOLUTION", "SERVICE", "EDUCATION", "CHECKLIST", "COMMON_MISTAKE", "CASE_STUDY",
];

function normalized(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Picks the narrative intent before generation. Keeps the planned intent unless the
 * contentType:intent pair already appears NARRATIVE_MAX_REPEATS times in the recent window
 * (the post-generation repetition check would then reject it after paying). Otherwise
 * returns the least used evergreen intent, or null when every option is overused: the slot
 * is then skipped for free.
 */
export function chooseNarrativeIntent(contentType: string, plannedIntent: EditorialIntent, recentStructures: Array<string | null | undefined>): EditorialIntent | null {
  const window = recentStructures.slice(0, NARRATIVE_WINDOW).map(normalized);
  const uses = (intent: EditorialIntent) => window.filter((item) => item === normalized(`${contentType}:${intent}`)).length;
  if (uses(plannedIntent) < NARRATIVE_MAX_REPEATS) return plannedIntent;
  let best: { intent: EditorialIntent; count: number } | null = null;
  for (const intent of FALLBACK_INTENTS) {
    const count = uses(intent);
    if (count >= NARRATIVE_MAX_REPEATS) continue;
    if (!best || count < best.count) best = { intent, count };
  }
  return best?.intent ?? null;
}

/** The brief the editorial quality rules enforce: never the "avoid recent topics" list. */
export function autopilotQualityBrief(input: { websitePilotBrief: string | null; planTopicDirection: string | null; pillarInstruction: string | null }) {
  return input.websitePilotBrief?.trim() || input.planTopicDirection?.trim() || input.pillarInstruction?.trim() || null;
}

/** Release reasons caused by the content itself (not budget, locks or infrastructure). */
export const CONTENT_REJECTION_REASON = /^(OPENAI_EDITORIAL_QUALITY_BLOCKED|OPENAI_FACTCHECK_BLOCK|AUTOPILOT_DUPLICATE_CONTENT|AUTOPILOT_REPETITION_BLOCKED|AUTOPILOT_EDITORIAL_QA_BLOCKED|OPENAI_UNEXPECTED_CAROUSEL_SLIDES|OPENAI_INVALID_CAROUSEL_SLIDES|OPENAI_INVALID_SCHEMA|OPENAI_INVALID_JSON|OPENAI_INCOMPLETE_VARIANTS|OPENAI_DUPLICATE_VARIANTS|AUTOPILOT_VARIANT_MISSING)(:|$)/;

export const FAILURE_BREAKER_THRESHOLD = 3;
export const FAILURE_BREAKER_WINDOW_MS = 24 * 60 * 60 * 1000;

export type AutopilotAttemptRecord = { state: string; reason: string | null; created_at: string };

/**
 * Profile-level circuit breaker. Open when the most recent FAILURE_BREAKER_THRESHOLD autopilot
 * attempts (newest first) all fall inside the last 24h and were all rejected for content
 * reasons. A committed generation in between closes it. While open, the cron makes no paid
 * call for that profile; it re-opens to one attempt once the oldest of those failures ages out.
 */
export function failureBreakerOpen(recentAttempts: AutopilotAttemptRecord[], now = new Date()): boolean {
  const latest = recentAttempts.slice(0, FAILURE_BREAKER_THRESHOLD);
  if (latest.length < FAILURE_BREAKER_THRESHOLD) return false;
  return latest.every((record) => {
    const age = now.getTime() - new Date(record.created_at).getTime();
    return record.state === "RELEASED"
      && CONTENT_REJECTION_REASON.test(record.reason ?? "")
      && Number.isFinite(age) && age >= 0 && age < FAILURE_BREAKER_WINDOW_MS;
  });
}
