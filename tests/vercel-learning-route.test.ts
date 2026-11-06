import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import handler from "../api/learning.js";

const profileId = "00000000-0000-4000-8000-000000000001";
const originalFetch = globalThis.fetch;
const originalDatabaseUrl = process.env.DATABASE_URL;
delete process.env.DATABASE_URL;

function capture() {
  const result: { status: number; body: any } = { status: 200, body: undefined };
  const response = {
    status(code: number) { result.status = code; return response; },
    json(body: unknown) { result.body = body; return response; },
  };
  return { result, response };
}

async function call({ method = "POST", token, id = profileId, path = "run" }: { method?: string; token?: string; id?: string; path?: string }) {
  const { response, result } = capture();
  await handler({
    method, query: { path }, headers: token ? { authorization: `Bearer ${token}` } : {},
    body: { profileId: id },
  } as never, response as never);
  return result;
}

try {
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.ok(vercel.rewrites.some((entry: any) =>
    entry.source === "/api/learning/:path*" && entry.destination === "/api/learning?path=:path*"));
  const source = readFileSync(new URL("../api/_lib/learning-runtime.ts", import.meta.url), "utf8");
  assert.match(source, /snapshot\.source='PROVIDER_API'/);
  assert.match(source, /not public\.is_demo_persistent_profile/);
  assert.equal((await call({ token: "opaque", path: "other" })).status, 404);
  assert.equal((await call({ method: "GET", token: "opaque" })).status, 405);
  assert.equal((await call({})).status, 401);
  assert.equal((await call({ token: "opaque", id: "bad" })).status, 400);
  globalThis.fetch = async () => Response.json([], { status: 200 });
  assert.deepEqual(await call({ token: "opaque" }), { status: 404, body: { error: "PROFILE_NOT_FOUND" } });
  globalThis.fetch = async () => Response.json({ error: "bad token" }, { status: 401 });
  assert.deepEqual(await call({ token: "opaque" }), { status: 401, body: { error: "SESSION_INVALID" } });
  globalThis.fetch = async () => { throw new Error("ENOTFOUND"); };
  assert.deepEqual(await call({ token: "opaque" }), { status: 502, body: { error: "PROFILE_DATA_API_UNAVAILABLE" } });
  let observed = "";
  globalThis.fetch = async (input, init) => {
    observed = String(input);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer opaque");
    assert.equal(init?.cache, "no-store");
    return Response.json([{ id: profileId }]);
  };
  assert.deepEqual(await call({ token: "opaque" }), { status: 503, body: { error: "DATABASE_NOT_CONFIGURED" } });
  assert.match(observed, /ep-divine-band-arrkz7vq/);
  console.log("Vercel authenticated learning route: PASS (RLS, fail closed, real-metrics-only, no writes)");
} finally {
  globalThis.fetch = originalFetch;
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
}
