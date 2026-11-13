import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Runtime behaviour of the route without any database, OpenAI or Blob access.
for (const key of ["REEL_ENGINE_ENABLED", "DATABASE_URL", "OPENAI_API_KEY", "BLOB_READ_WRITE_TOKEN", "CRON_SECRET"]) delete process.env[key];
const { default: handler, reelEngineReadiness } = await import("../api/render.js");

type Captured = { status: number; body: unknown; headers: Record<string, string> };
function call(input: { method: string; path: string; headers?: Record<string, string>; query?: Record<string, string>; body?: unknown }) {
  const captured: Captured = { status: 0, body: null, headers: {} };
  const res = {
    setHeader(name: string, value: string) { captured.headers[name.toLowerCase()] = value; },
    status(code: number) { captured.status = code; return res; },
    json(body: unknown) { captured.body = body; return res; },
  };
  const req = { method: input.method, headers: input.headers ?? {}, query: { path: input.path, ...(input.query ?? {}) }, body: input.body ?? {} };
  return (handler as unknown as (req: unknown, res: unknown) => Promise<unknown>)(req, res).then(() => captured);
}

assert.deepEqual(reelEngineReadiness({}).missing, ["REEL_ENGINE_ENABLED", "DATABASE_URL", "OPENAI_API_KEY", "BLOB_READ_WRITE_TOKEN"]);
assert.equal(reelEngineReadiness({ REEL_ENGINE_ENABLED: "TRUE", DATABASE_URL: "x", OPENAI_API_KEY: "x", BLOB_READ_WRITE_TOKEN: "x" }).ready, true);
assert.equal(reelEngineReadiness({ REEL_ENGINE_ENABLED: "yes", DATABASE_URL: "x", OPENAI_API_KEY: "x", BLOB_READ_WRITE_TOKEN: "x" }).ready, false, "only the explicit value true enables paid rendering");

let r = await call({ method: "GET", path: "tick" });
assert.equal(r.status, 503, "cron tick fails closed without CRON_SECRET");
process.env.CRON_SECRET = "s".repeat(32);
r = await call({ method: "GET", path: "tick", headers: { authorization: "Bearer wrong" } });
assert.equal(r.status, 401);
r = await call({ method: "GET", path: "tick", headers: { authorization: `Bearer ${"s".repeat(32)}` } });
assert.equal(r.status, 200);
assert.equal((r.body as { engine?: string }).engine, "DISABLED_CONFIG", "a disabled engine never claims jobs or calls providers");
assert.equal(r.headers["cache-control"], "no-store");

r = await call({ method: "POST", path: "enqueue", body: { profileId: "11111111-1111-4111-8111-111111111111" } });
assert.equal(r.status, 401, "enqueue requires a user session");
r = await call({ method: "GET", path: "status", headers: { authorization: "Bearer token" }, query: { profileId: "not-a-uuid" } });
assert.equal(r.status, 400);

// Static contract: config and source boundaries.
const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
assert.ok(config.crons.some((entry: { path: string; schedule: string }) => entry.path === "/api/render/tick" && entry.schedule === "30 * * * *"), "hourly recovery tick, not per-minute (keeps Neon free compute asleep)");
assert.ok(config.rewrites.findIndex((rule: { source: string }) => rule.source === "/api/render/:path*") < config.rewrites.findIndex((rule: { source: string }) => rule.source === "/((?!api/).*)"));
const fn = config.functions["api/render.ts"];
assert.equal(fn.maxDuration, 300);
for (const file of ["@ff*-installer/linux-x64/**", "inter-latin-[47]00-normal.woff", "@resvg/resvg-wasm/*.wasm"]) assert.ok(fn.includeFiles.includes(file), `binary/font missing from function bundle: ${file}`);
assert.ok(fn.includeFiles.length <= 256, "Vercel rejects includeFiles longer than 256 characters");

const source = readFileSync(new URL("../api/render.ts", import.meta.url), "utf8");
assert.match(source, /authorizedUser\(token, profileId\)/, "every user route checks profile ownership through the RLS-scoped Data API");
assert.match(source, /waitUntil\(/, "rendering continues after the 202 response");
assert.doesNotMatch(source, /processDuePublications|publishVariant|SAFE_MODE/, "the render route never publishes");
console.log("PASS vercel render route: fail-closed (flag, cron secret, sessione), nessuna pubblicazione, bundle con FFmpeg/font.");

{
  delete process.env.VERCEL_ENV;
  const denied = await call({ method: "GET", path: "selftest" });
  assert.equal(denied.status, 401, "production self-test requires CRON_SECRET");
  const allowed = await call({ method: "GET", path: "selftest", headers: { authorization: `Bearer ${"s".repeat(32)}` } });
  assert.equal(allowed.status, 200);
  assert.equal((allowed.body as { ok?: boolean }).ok, true, `self-test render: ${JSON.stringify(allowed.body).slice(0, 300)}`);
  console.log("PASS render self-test: rendering sintetico nella route senza DB né provider.");
}
