import assert from "node:assert/strict";
import { handleSameOriginAuthProxy, SAME_ORIGIN_AUTH_PROXY_CONTRACT } from "../cloudflare/auth-proxy.js";

const APP_ORIGIN = "https://autoposter.02alessandrocaruso.workers.dev";
const env = { APP_BASE_URL: APP_ORIGIN };
const originalFetch = globalThis.fetch;

type SeenFetch = { url: string; init?: RequestInit };

function setFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  }) as typeof fetch;
}

async function noUpstream(request: Request) {
  let called = false;
  setFetch(async () => {
    called = true;
    throw new Error("unexpected upstream call");
  });
  const response = await handleSameOriginAuthProxy(request, env);
  assert.equal(called, false, "denied request must not reach upstream");
  return response;
}

try {
  assert.equal(SAME_ORIGIN_AUTH_PROXY_CONTRACT.prefix, "/api/auth");
  assert.equal(SAME_ORIGIN_AUTH_PROXY_CONTRACT.upstream, "https://ep-nameless-truth-a698bwer.neonauth.us-west-2.aws.neon.tech/neondb/auth");
  assert.deepEqual(SAME_ORIGIN_AUTH_PROXY_CONTRACT.methods, ["GET", "POST"]);

  {
    const seen: SeenFetch[] = [];
    setFetch(async (url, init) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ session: null }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const response = await handleSameOriginAuthProxy(new Request(`${APP_ORIGIN}/api/auth/get-session?disableCookieCache=true`, {
      headers: { accept: "application/json" },
    }), env);
    assert.equal(response?.status, 200);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.url, `${SAME_ORIGIN_AUTH_PROXY_CONTRACT.upstream}/get-session?disableCookieCache=true`);
    assert.equal(seen[0]?.init?.method, "GET");
    assert.equal(response?.headers.get("cache-control"), "no-store");
  }

  {
    const payload = JSON.stringify({ email: "qa@example.invalid", password: "redacted-test-value" });
    let upstreamHeaders: Headers | null = null;
    let upstreamBody = "";
    setFetch(async (url, init) => {
      assert.equal(url, `${SAME_ORIGIN_AUTH_PROXY_CONTRACT.upstream}/sign-in/email`);
      upstreamHeaders = new Headers(init?.headers);
      upstreamBody = init?.body instanceof ArrayBuffer ? new TextDecoder().decode(init.body) : String(init?.body ?? "");
      const headers = new Headers({ "content-type": "application/json", "cache-control": "public, max-age=300" });
      headers.append("set-cookie", "__Secure-neon-auth.session_token=opaque-a; Path=/; HttpOnly; Secure; SameSite=None");
      headers.append("set-cookie", "__Host-neon-auth.marker=opaque-b; Path=/; HttpOnly; Secure; SameSite=Lax");
      return new Response(JSON.stringify({ user: { id: "qa" } }), { status: 200, headers });
    });

    const response = await handleSameOriginAuthProxy(new Request(`${APP_ORIGIN}/api/auth/sign-in/email`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        cookie: "__Secure-neon-auth.session_token=browser-opaque",
        origin: APP_ORIGIN,
        referer: `${APP_ORIGIN}/login`,
        "x-force-fetch": "1",
        "x-forwarded-host": "evil.invalid",
        "x-forwarded-proto": "http",
        forwarded: "host=evil.invalid;proto=http",
      },
      body: payload,
    }), env);

    assert.equal(response?.status, 200);
    assert.equal(upstreamBody, payload, "raw Auth body must be forwarded unchanged");
    assert.equal(upstreamHeaders?.get("content-type"), "application/json");
    assert.equal(upstreamHeaders?.get("cookie"), "__Secure-neon-auth.session_token=browser-opaque");
    assert.equal(upstreamHeaders?.get("origin"), APP_ORIGIN);
    assert.equal(upstreamHeaders?.get("referer"), `${APP_ORIGIN}/login`);
    assert.equal(upstreamHeaders?.get("x-force-fetch"), "1");
    assert.equal(upstreamHeaders?.has("x-forwarded-host"), false);
    assert.equal(upstreamHeaders?.has("x-forwarded-proto"), false);
    assert.equal(upstreamHeaders?.has("forwarded"), false);
    assert.equal(response?.headers.get("cache-control"), "no-store");
    assert.equal(response?.headers.get("pragma"), "no-cache");
    assert.equal(response?.headers.getSetCookie().length, 2, "multiple Set-Cookie headers must remain distinct");
  }

  for (const query of ["?url=https%3A%2F%2Fevil.invalid", "?upstream=https%3A%2F%2Fevil.invalid"]) {
    const response = await noUpstream(new Request(`${APP_ORIGIN}/api/auth/get-session${query}`));
    assert.equal(response?.status, 400, `proxy target override must be denied: ${query}`);
  }

  {
    const response = await noUpstream(new Request("https://evil.invalid/api/auth/get-session"));
    assert.equal(response?.status, 403, "malicious request host must be denied");
  }

  for (const path of [
    "/api/auth/%252e%252e/admin/list-users",
    "/api/auth/a%252f..%252fadmin/list-users",
    "/api/auth/https:%2f%2fevil.invalid/path",
    "/api/auth//admin/list-users",
  ]) {
    const response = await noUpstream(new Request(`${APP_ORIGIN}${path}`));
    assert.ok(response === null || (response.status >= 400 && response.status < 500), `unsafe Auth path must not proxy: ${path}`);
  }

  {
    const response = await noUpstream(new Request(`${APP_ORIGIN}/api/not-auth/get-session`));
    assert.equal(response, null, "foreign namespace must not be claimed by Auth proxy");
  }

  {
    const response = await noUpstream(new Request(`${APP_ORIGIN}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { origin: "https://evil.invalid", "content-type": "application/json" },
      body: "{}",
    }));
    assert.equal(response?.status, 403, "foreign Origin must be denied");
  }

  {
    const response = await noUpstream(new Request(`${APP_ORIGIN}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }));
    assert.equal(response?.status, 403, "POST without Origin must fail closed");
  }

  {
    const response = await noUpstream(new Request(`${APP_ORIGIN}/api/auth/get-session`, { method: "PUT" }));
    assert.equal(response?.status, 405, "unsupported Auth method must be denied");
  }

  {
    setFetch(async () => new Response(null, {
      status: 302,
      headers: { location: `${SAME_ORIGIN_AUTH_PROXY_CONTRACT.upstream}/callback/google?state=opaque` },
    }));
    const response = await handleSameOriginAuthProxy(new Request(`${APP_ORIGIN}/api/auth/callback/google?state=opaque`), env);
    assert.equal(response?.status, 302);
    assert.equal(response?.headers.get("location"), `${APP_ORIGIN}/api/auth/callback/google?state=opaque`);
  }

  {
    setFetch(async () => new Response(null, {
      status: 302,
      headers: { location: "https://accounts.google.com/o/oauth2/v2/auth?client_id=public-test" },
    }));
    const response = await handleSameOriginAuthProxy(new Request(`${APP_ORIGIN}/api/auth/sign-in/social`), env);
    assert.equal(response?.headers.get("location"), "https://accounts.google.com/o/oauth2/v2/auth?client_id=public-test", "external OAuth provider redirect must remain provider-owned");
  }

  console.log("same-origin Auth proxy regression: PASS");
} finally {
  globalThis.fetch = originalFetch;
}
