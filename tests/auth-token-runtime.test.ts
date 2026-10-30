import assert from "node:assert/strict";

// Exercise the installed Neon/Better Auth adapter, not a fake auth client.
// Every HTTP request is intercepted; no credentials or live services are used.
const originalFetch = globalThis.fetch;
const requests: Array<{ path: string; credentials?: RequestCredentials }> = [];
let responseBody: unknown = { token: "test-header.test-payload.test-signature" };
let responseStatus = 200;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  requests.push({ path: url.pathname, credentials: init?.credentials });
  if (url.pathname !== "/api/auth/token") {
    return Response.json({ code: "NOT_FOUND" }, { status: 404 });
  }
  return Response.json(responseBody, { status: responseStatus });
};

try {
  const { authenticatedApiToken } = await import("../src/lib/auth-token.js");
  const jwt = "test-header.test-payload.test-signature";
  assert.equal(await authenticatedApiToken("opaque-session-must-not-be-forwarded"), jwt);
  assert.deepEqual(requests.map((request) => request.path), ["/api/auth/token"],
    "the public adapter must call the supported JWT endpoint, not /get-jwt-token");
  assert.equal(requests[0].credentials, "include", "JWT retrieval must carry the normal session cookie");

  // A new request must use the current session's JWT, not the preferred/cached bearer.
  responseBody = { token: "next-header.next-payload.next-signature" };
  assert.equal(await authenticatedApiToken(jwt), "next-header.next-payload.next-signature");

  for (const body of [{}, { token: null }, { token: 42 }, { token: "opaque-session" }]) {
    responseBody = body;
    await assert.rejects(() => authenticatedApiToken(jwt), /Sessione non valida/,
      "missing or opaque token must fail closed even when a preferred bearer exists");
  }
  responseStatus = 401;
  responseBody = { code: "UNAUTHORIZED", message: "test-only" };
  await assert.rejects(() => authenticatedApiToken(jwt), "an expired session must fail closed");
  assert.ok(requests.every((request) => request.path === "/api/auth/token"),
    "there must be no anonymous or opaque-session fallback");
  console.log("public Neon JWT runtime regression: PASS (real SDK, mocked HTTP, zero live calls)");
} catch (error) {
  console.error("Auth endpoint paths observed:", requests.map((request) => request.path));
  throw error;
} finally {
  globalThis.fetch = originalFetch;
}
