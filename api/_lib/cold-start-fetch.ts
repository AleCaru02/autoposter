/**
 * Neon Data API cold-start guard, shared by the browser client and the server routes.
 *
 * Verified 15/11/2026 on the QA project: on the first authenticated request after the
 * compute resumes from scale-to-zero, the Data API can answer as if the caller saw no rows
 * (200 [] for a list, 406 PGRST116 for .single(), null for a scalar RPC) with a valid token.
 * The second identical request answers correctly.
 *
 * Controlled retry:
 *  - at most ONE retry, after a short delay;
 *  - only for requests that are safe to repeat: GET/HEAD reads, PATCH/DELETE that ask for the
 *    affected rows back (Prefer: return=representation, idempotent), and allow-listed
 *    read-only RPCs. Inserts and write RPCs are never repeated;
 *  - only while the connection may be cold: once any request returned data, empty answers
 *    in the following warm window are trusted (no extra latency for genuinely empty lists).
 */
export const COLD_START_RETRY_DELAY_MS = 350;
/** Neon suspends an idle compute after about 5 minutes: below that the compute is warm. */
export const COLD_START_WARM_WINDOW_MS = 240_000;
export const READ_ONLY_RPCS: ReadonlySet<string> = new Set(["current_auth_user_id", "customer_ai_budget_overview"]);

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type ColdStartFetchOptions = {
  delayMs?: number;
  warmWindowMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  readOnlyRpcs?: ReadonlySet<string>;
  onRetry?: (info: { method: string; path: string; reason: string }) => void;
};

function requestParts(input: RequestInfo | URL, init?: RequestInit) {
  const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
  const url = request ? request.url : String(input);
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers ?? request?.headers ?? undefined);
  return { url, method, headers };
}

/** True when repeating the request cannot change data twice. */
export function isRetrySafe(method: string, url: string, headers: Headers, readOnlyRpcs: ReadonlySet<string> = READ_ONLY_RPCS) {
  if (method === "GET" || method === "HEAD") return true;
  const prefer = headers.get("prefer") ?? "";
  if ((method === "PATCH" || method === "DELETE") && /return=representation/i.test(prefer)) return true;
  if (method === "POST") {
    const rpc = /\/rpc\/([a-z0-9_]+)/i.exec(new URL(url, "http://local").pathname)?.[1];
    return Boolean(rpc && readOnlyRpcs.has(rpc));
  }
  return false;
}

/** Classifies a response as "no data" in the shapes the Data API uses on a cold start. */
export async function emptyAnswerReason(response: Response): Promise<string | null> {
  if (response.status === 406) {
    const text = await response.clone().text().catch(() => "");
    return /PGRST116/.test(text) ? "SINGLE_ZERO_ROWS" : null;
  }
  if (response.status !== 200) return null;
  const text = (await response.clone().text().catch(() => "")).trim();
  if (text === "[]") return "EMPTY_ARRAY";
  if (text === "null") return "NULL_RESULT";
  return null;
}

export function createColdStartFetch(base: FetchLike = (...args) => fetch(...args), options: ColdStartFetchOptions = {}): FetchLike {
  const delayMs = options.delayMs ?? COLD_START_RETRY_DELAY_MS;
  const warmWindowMs = options.warmWindowMs ?? COLD_START_WARM_WINDOW_MS;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const readOnlyRpcs = options.readOnlyRpcs ?? READ_ONLY_RPCS;
  let lastDataAt = Number.NEGATIVE_INFINITY;

  return async (input, init) => {
    const { url, method, headers } = requestParts(input, init);
    // A Request body can be read only once: keep a copy for the retry before the first send.
    const retryInput = typeof Request !== "undefined" && input instanceof Request ? input.clone() : input;
    const first = await base(input, init);
    const reason = method === "HEAD" ? null : await emptyAnswerReason(first);
    if (!reason) {
      if (first.ok) lastDataAt = now();
      return first;
    }
    const warm = now() - lastDataAt < warmWindowMs;
    if (warm || !isRetrySafe(method, url, headers, readOnlyRpcs)) return first;
    await sleep(delayMs);
    options.onRetry?.({ method, path: new URL(url, "http://local").pathname, reason });
    const second = await base(retryInput, init);
    if (second.ok && !(await emptyAnswerReason(second))) lastDataAt = now();
    return second;
  };
}

/** Process-wide instance for server routes (state shared within a warm function instance). */
export const dataApiFetch = createColdStartFetch();
