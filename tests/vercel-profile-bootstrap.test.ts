import assert from "node:assert/strict";
import handler, { NEON_PROFILES_DATA_API } from "../api/profile-bootstrap.js";
import { readFileSync } from "node:fs";

const originalFetch = globalThis.fetch;
const TEST_JWT = "header.payload.signature";
const PROFILE_ID_A = "11111111-1111-4111-8111-111111111111";
const PROFILE_ID_B = "22222222-2222-4222-8222-222222222222";

type Capture = { status: number; headers: Record<string, string | string[]>; body: unknown };
function capture() {
  const data: Capture = { status: 200, headers: {}, body: null };
  const res = {
    setHeader(key: string, value: string | string[]) { data.headers[key.toLowerCase()] = value; return res; },
    status(value: number) { data.status = value; return res; },
    json(value: unknown) { data.body = value; return res; },
  };
  return { res, data };
}
function req(token: string | undefined, method = "GET") {
  return { method, headers: { authorization: token ? `Bearer ${token}` : undefined } };
}

async function run() {
  try {
    const src = readFileSync(new URL("../api/profile-bootstrap.ts", import.meta.url), "utf8");
    assert.doesNotMatch(src, /process\.env\.DATABASE_URL|service.role|service_role|admin_secret/i);
    assert.match(src, /archived_at=is\.null/);
    assert.match(src, /profile_tenant_modes\?select=/);
    const route = readFileSync(new URL("../src/features/profiles/profile-context.tsx", import.meta.url), "utf8");
    assert.match(route, /fetch\("\/api\/profile-bootstrap"/);

    let requests: Array<{ url: string; auth: string | null }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, auth: new Headers(init?.headers).get("authorization") });
      assert.equal(init?.method, "GET");
      assert.ok(url.startsWith(NEON_PROFILES_DATA_API + "/"));
      if (url.includes("/profile_tenant_modes?")) {
        return Response.json([
          { profile_id: PROFILE_ID_B, tenant_type: "QA_EPHEMERAL", external_publishing_enabled: false },
        ]);
      }
      return Response.json([
        { id: PROFILE_ID_A, name: "Attività reale", slug: "real", website_url: null, industry: null, timezone: "Europe/Rome", locale: "it-IT", onboarding_completed: true, created_at: "2026-11-05T10:00:00Z", profile_type: "BUSINESS" },
        { id: PROFILE_ID_B, name: "Profilo di test", slug: "test", website_url: null, industry: null, timezone: "Europe/Rome", locale: "it-IT", onboarding_completed: true, created_at: "2026-11-05T11:00:00Z", profile_type: "PERSONAL_BRAND" },
      ]);
    }) as typeof fetch;
    {
      const { res, data } = capture();
      await handler(req(TEST_JWT) as never, res as never);
      assert.equal(data.status, 200);
      assert.equal(data.headers["cache-control"], "no-store");
      assert.equal(data.headers["vary"], "authorization");
      const body = data.body as { profiles: Array<{ tenant_type: string; external_publishing_enabled: boolean }> };
      assert.equal(body.profiles.length, 2);
      assert.equal(body.profiles[0].tenant_type, "CUSTOMER_REAL");
      assert.equal(body.profiles[0].external_publishing_enabled, true);
      assert.equal(body.profiles[1].tenant_type, "QA_EPHEMERAL");
      assert.equal(body.profiles[1].external_publishing_enabled, false);
      assert.equal(requests.length, 2);
      for (const item of requests) assert.equal(item.auth, `Bearer ${TEST_JWT}`);
    }
    for (const [query, status] of [
      [req(undefined), 401],
      [req("opaque-session"), 401],
      [req(TEST_JWT, "POST"), 405],
    ] as const) {
      const calls = requests.length;
      const { res, data } = capture();
      await handler(query as never, res as never);
      assert.equal(data.status, status);
      assert.equal(requests.length, calls);
    }

    requests = [];
    globalThis.fetch = (async () => Response.json({ code: "permission_denied" }, { status: 401 })) as typeof fetch;
    {
      const { res, data } = capture();
      await handler(req(TEST_JWT) as never, res as never);
      assert.equal(data.status, 401);
      assert.deepEqual(data.body, { error: "SESSION_INVALID" });
    }
    let calls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls++;
      return String(input).includes("/profile_tenant_modes?")
        ? Response.json({ code: "tenant_modes_unavailable" }, { status: 500 })
        : Response.json([{ id: PROFILE_ID_A }]);
    }) as typeof fetch;
    {
      const { res, data } = capture();
      await handler(req(TEST_JWT) as never, res as never);
      assert.equal(data.status, 502);
      assert.deepEqual(data.body, { error: "TENANT_MODE_DATA_API_FAILED" });
      assert.equal(calls, 2);
    }
    console.log("Vercel RLS profile bootstrap contract: PASS");
  } finally {
    globalThis.fetch = originalFetch;
  }
}
await run();
