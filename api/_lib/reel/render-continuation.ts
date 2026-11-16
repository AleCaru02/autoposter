/**
 * Cloud continuation of a Reel job without waiting for the hourly cron.
 * When a run yields (time budget) or schedules a short retry, the function calls its own
 * deployment's tick route for that job. The tick answers immediately and keeps working in
 * waitUntil, so no invocation waits for another. Safety comes from the database, not from
 * the chain: a claim takes a lease with a claim_token (one runner per job), attempts are
 * bounded by max_attempts, the per-job spending cap is checked before every paid call, and
 * the hop limit stops a runaway chain (the hourly cron stays as last-resort fallback).
 */
export const MAX_CONTINUATION_HOPS = 8;
/** Longest wait a continuation will hold before claiming a job scheduled for a retry. */
export const MAX_CONTINUATION_DELAY_SECONDS = 180;

type ContinuationEnv = {
  VERCEL_ENV?: string;
  VERCEL_URL?: string;
  CRON_SECRET?: string;
  VERCEL_AUTOMATION_BYPASS_SECRET?: string;
};

export type ContinuationPlan =
  | { dispatch: true; url: string; headers: Record<string, string> }
  | { dispatch: false; reason: "HOP_LIMIT" | "CRON_SECRET_MISSING" | "DEPLOYMENT_URL_MISSING" | "PREVIEW_PROTECTED_NO_BYPASS" };

export function planContinuation(env: ContinuationEnv, jobId: string, hop: number, delaySeconds = 0): ContinuationPlan {
  if (hop > MAX_CONTINUATION_HOPS) return { dispatch: false, reason: "HOP_LIMIT" };
  if (!env.CRON_SECRET) return { dispatch: false, reason: "CRON_SECRET_MISSING" };
  const host = env.VERCEL_URL?.trim();
  if (!host || !/^[a-z0-9.-]+$/i.test(host)) return { dispatch: false, reason: "DEPLOYMENT_URL_MISSING" };
  const bypass = env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  // Preview deployments sit behind Vercel Authentication: without the automation bypass the
  // call would be rejected, so it is not attempted (the job stays QUEUED for the next tick).
  if (env.VERCEL_ENV === "preview" && !bypass) return { dispatch: false, reason: "PREVIEW_PROTECTED_NO_BYPASS" };
  const delay = Math.max(0, Math.min(Math.round(delaySeconds), MAX_CONTINUATION_DELAY_SECONDS));
  const url = `https://${host}/api/render/tick?jobId=${encodeURIComponent(jobId)}&hop=${hop}${delay ? `&delay=${delay}` : ""}`;
  const headers: Record<string, string> = { authorization: `Bearer ${env.CRON_SECRET}` };
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  return { dispatch: true, url, headers };
}

/** Fires the continuation and returns as soon as the target accepted it (202). */
export async function dispatchContinuation(env: ContinuationEnv, jobId: string, hop: number, delaySeconds = 0, fetcher: typeof fetch = fetch) {
  const plan = planContinuation(env, jobId, hop, delaySeconds);
  if (!plan.dispatch) return { dispatched: false as const, reason: plan.reason };
  try {
    const response = await fetcher(plan.url, { method: "GET", headers: plan.headers, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(15_000) });
    return response.status === 202
      ? { dispatched: true as const, status: response.status }
      : { dispatched: false as const, reason: `HTTP_${response.status}` };
  } catch (reason) {
    return { dispatched: false as const, reason: reason instanceof Error ? reason.name : "FETCH_FAILED" };
  }
}

export function parseContinuationQuery(query: { jobId?: unknown; hop?: unknown; delay?: unknown }) {
  const jobId = typeof query.jobId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.jobId) ? query.jobId : null;
  const hop = Number(query.hop);
  const delay = Number(query.delay);
  return {
    jobId,
    hop: Number.isInteger(hop) && hop >= 0 && hop <= MAX_CONTINUATION_HOPS + 1 ? hop : 0,
    delaySeconds: Number.isFinite(delay) ? Math.max(0, Math.min(delay, MAX_CONTINUATION_DELAY_SECONDS)) : 0,
  };
}
