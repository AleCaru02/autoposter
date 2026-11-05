import assert from "node:assert/strict";

// Real auth-token helper, with all HTTP mocked; no live account is accessed.
const originalFetch = globalThis.fetch;
const requests: Array<{ path: string; method?: string; credentials?: RequestCredentials; cache?: RequestCache }> = [];
let responseBody: unknown = { token: "test-header.test-payload.test-signature" };
let responseStatus = 200;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input), "https://post-automatici-canonical.vercel.app");
  requests.push({ path: url.pathname, method: init?.method, credentials: init?.credentials, cache: init?.cache });
  if (url.pathname !== "/api/auth/token") return Response.json({ code: "NOT_FOUND" }, { status: 404 });
  return Response.json(responseBody, { status: responseStatus });
}) as typeof fetch;

try {
  const { authenticatedApiToken, tokenFromAuthSession } = await import("../src/lib/auth-token.js");
  const jwt = "test-header.test-payload.test-signature";
  assert.equal(await authenticatedApiToken("opaque-session-must-not-be-forwarded"), jwt);
  assert.deepEqual(requests.map((request) => request.path), ["/api/auth/token"],
    "must use documented Auth JWT endpoint rather than cached authClient.token");
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[0].credentials, "include", "use the first-party session cookie");
  assert.equal(requests[0].cache, "no-store", "do not reuse stale JWT responses");
  assert.equal(tokenFromAuthSession({ session: { token: "opaque-id" } }), "opaque-id");

  responseBody = { token: "next-header.next-payload.next-signature" };
  assert.equal(await authenticatedApiToken(jwt), "next-header.next-payload.next-signature");

  for (const body of [{}, { session: { token: "opaque" } }, { token: null },
    { token: 42 }, { token: "opaque-session" }, { token: "header..signature" },
    { token: "bad token.payload.signature" }]) {
    responseBody = body;
    responseStatus = 200;
    await assert.rejects(() => authenticatedApiToken(jwt), /AUTH_JWT_INVALID_RESPONSE/);
  }
  responseStatus = 401;
  await assert.rejects(() => authenticatedApiToken(jwt), /SESSION_INVALID/);
  responseStatus = 404;
  await assert.rejects(() => authenticatedApiToken(jwt), /AUTH_JWT_ENDPOINT_MISSING/);
  responseStatus = 503;
  await assert.rejects(() => authenticatedApiToken(jwt), /AUTH_JWT_ENDPOINT_FAILED/);
  assert.ok(requests.every((request) => request.path === "/api/auth/token"),
    "never fall back to anonymous identity or opaque session ID");
  console.log("Neon JWT endpoint regression: PASS (cookie mode, fail closed, mocked HTTP)");
} finally {
  globalThis.fetch = originalFetch;
}
