import assert from "node:assert/strict";
import { fetchOpenAiQaWithRetry, openAiQaFailureCode } from "../api/_lib/openai-qa-retry.js";

let transientCalls = 0;
const transient = await fetchOpenAiQaWithRetry({
  fetcher: (async () => {
    transientCalls += 1;
    if (transientCalls === 1) return new Response(JSON.stringify({ error: { type: "rate_limit_exceeded" } }), { status: 429 });
    return new Response('{"ok":true}', { status: 200 });
  }) as typeof fetch,
  url: "https://api.openai.com/v1/responses",
  init: { method: "POST" },
  sleep: async () => undefined,
});
assert.equal(transient.response.status, 200);
assert.equal(transient.attempts, 2);
assert.equal(transientCalls, 2);

let quotaCalls = 0;
const quota = await fetchOpenAiQaWithRetry({
  fetcher: (async () => {
    quotaCalls += 1;
    return new Response(JSON.stringify({ error: { code: "insufficient_quota" } }), { status: 429 });
  }) as typeof fetch,
  url: "https://api.openai.com/v1/responses",
  init: { method: "POST" },
  sleep: async () => undefined,
});
assert.equal(quota.response.status, 429);
assert.equal(quota.attempts, 1);
assert.equal(quotaCalls, 1);
assert.equal(openAiQaFailureCode("OPENAI_AGENT", quota.response, quota.raw), "OPENAI_AGENT_HTTP_429_INSUFFICIENT_QUOTA");

console.log("OpenAI QA retry regression: PASS — transient throttles retry; quota throttles remain actionable.");
