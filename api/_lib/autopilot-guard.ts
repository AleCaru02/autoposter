/**
 * Server-side switch for paid AI generation started by the hourly cron.
 *
 * Fail-closed: the cron generates content only when AUTOPILOT_AI_ENABLED is exactly "true".
 * Any other value (missing, "false", typo) pauses paid generation while the cron keeps
 * running its free work (social re-verification, learning). Manual runs started by the
 * owner from the app are not affected: they are an explicit, per-click request.
 */
export const AUTOPILOT_AI_PAUSED = "AUTOPILOT_AI_PAUSED" as const;

export function cronAutopilotAiEnabled(value: string | undefined): boolean {
  return value === "true";
}

export function pausedAutopilotResult() {
  return { profilesChecked: 0, generated: 0, scheduled: 0, blockedForReview: 0, skipped: 0, errors: [] as string[], paused: AUTOPILOT_AI_PAUSED };
}
