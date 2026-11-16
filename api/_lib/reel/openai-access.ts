/**
 * Free OpenAI checks for the Reel pipeline: model metadata only (GET /v1/models/{id}),
 * never a generation. Used to explain 401/403/404 before any paid step is attempted.
 */
export const REEL_PIPELINE_MODELS = ["gpt-5.6-terra", "gpt-image-2.5-sunburst", "gpt-4o-mini-tts"] as const;

/** Extracts OpenAI's error code/type from a failed response without echoing request data. */
export async function openAiErrorDetail(response: Response) {
  try {
    const body = await response.json() as { error?: { code?: string | null; type?: string | null; message?: string | null } };
    const code = body.error?.code ?? body.error?.type ?? "unknown";
    const message = (body.error?.message ?? "").replace(/sk-[A-Za-z0-9_-]{6,}/g, "sk-***").slice(0, 180);
    return `${code}${message ? `: ${message}` : ""}`;
  } catch {
    return "unreadable_error_body";
  }
}

export async function checkOpenAiModelAccess(apiKey: string, fetcher: typeof fetch = fetch) {
  const results: Record<string, { status: number; detail: string | null }> = {};
  for (const model of REEL_PIPELINE_MODELS) {
    const response = await fetcher(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
    results[model] = { status: response.status, detail: response.ok ? null : await openAiErrorDetail(response) };
  }
  const listResponse = await fetcher("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000) });
  let visibleModelCount: number | null = null;
  if (listResponse.ok) visibleModelCount = ((await listResponse.json()) as { data?: unknown[] }).data?.length ?? null;
  return { ready: Object.values(results).every((result) => result.status === 200), models: results, visibleModelCount, keyStatus: listResponse.status };
}
