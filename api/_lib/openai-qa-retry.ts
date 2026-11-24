const NON_RETRYABLE_429 = new Set([
  "credit_balance_exhausted",
  "insufficient_quota",
  "billing_hard_limit_reached",
  "billing_not_active",
  "account_deactivated",
]);

function errorKind(raw: string) {
  try {
    const body = JSON.parse(raw) as { error?: { code?: unknown; type?: unknown } };
    const error = body.error ?? {};
    const value = typeof error.code === "string" && error.code.trim()
      ? error.code
      : typeof error.type === "string" ? error.type : "unknown";
    return value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 80) || "unknown";
  } catch {
    return "unknown";
  }
}

function retryDelayMs(response: Response, attempt: number) {
  const header = response.headers.get("retry-after")?.trim() ?? "";
  const requested = /^\d+$/.test(header) ? Number(header) * 1000
    : /^[A-Za-z]{3}, /.test(header) ? Math.max(0, Date.parse(header) - Date.now()) : 0;
  // Do not make another paid request earlier than the provider permits.
  // Long waits are surfaced to the caller instead of holding an interactive function.
  if (requested > 10_000) return null;
  return Math.min(Math.max(Number.isFinite(requested) ? requested : 0, 750 * 2 ** (attempt - 1)), 10_000);
}

export type OpenAiQaResponse = {
  response: Response;
  raw: string;
  attempts: number;
};

/**
 * Retries only transient OpenAI throttling. Billing/quota 429s are returned
 * immediately so the caller can show the real actionable state to the user.
 */
export async function fetchOpenAiQaWithRetry(input: {
  fetcher: typeof fetch;
  url: string;
  init: RequestInit;
  maxAttempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}): Promise<OpenAiQaResponse> {
  const maxAttempts = Math.max(1, Math.min(input.maxAttempts ?? 3, 3));
  const sleep = input.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let latest: OpenAiQaResponse | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await input.fetcher(input.url, input.init);
    const raw = await response.text();
    latest = { response, raw, attempts: attempt };
    const kind = errorKind(raw);
    if (response.ok || response.status !== 429 || NON_RETRYABLE_429.has(kind) || attempt === maxAttempts) return latest;
    const delay = retryDelayMs(response, attempt);
    if (delay === null) return latest;
    await sleep(delay);
  }

  // The loop always returns; this protects TypeScript narrowing if it changes later.
  if (!latest) throw new Error("OPENAI_QA_NO_RESPONSE");
  return latest;
}

export function openAiQaFailureCode(prefix: string, response: Response, raw: string) {
  return `${prefix}_HTTP_${response.status}_${errorKind(raw).toUpperCase()}`;
}
