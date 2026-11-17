import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import contentQa from "../api/content-qa.js";
import generationStatus from "../api/generate-text-status.js";

const cfg = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
  rewrites: Array<{ source: string; destination: string }>;
};
const exact = (path: string) => cfg.rewrites.filter((item) => item.source === path);
assert.deepEqual(exact("/api/generate-text/status"), [{
  source: "/api/generate-text/status", destination: "/api/generate-text-status",
}], "generation status must use a native Vercel API");
assert.deepEqual(exact("/api/editorial-agents/strategy-plan"), [{
  source: "/api/editorial-agents/strategy-plan", destination: "/api/editorial-agents",
}], "strategy planner must use the already authenticated Vercel handler");
assert.equal(exact("/api/content-qa").length, 0, "native content QA must not be proxied to untrusted or stale Worker code");
assert.equal(typeof contentQa, "function");
assert.equal(typeof generationStatus, "function");

function response() {
  let statusCode = 200; let payload: unknown = null;
  const res = {
    setHeader() { return res; },
    status(code: number) { statusCode = code; return res; },
    json(body: unknown) { payload = body; return res; },
    send(body: unknown) { payload = body; return res; },
  } as unknown as VercelResponse;
  return { res, result: () => ({ statusCode, payload }) };
}

for (const handler of [contentQa, generationStatus]) {
  let w = response();
  await handler({ method: "GET", headers: {}, body: {} } as unknown as VercelRequest, w.res);
  assert.equal(w.result().statusCode, 405, "non-POST requests must be rejected");
  w = response();
  await handler({ method: "POST", headers: {}, body: {} } as unknown as VercelRequest, w.res);
  assert.equal(w.result().statusCode, 401, "anonymous requests must be rejected without touching providers");
}
const qa = response();
await contentQa({
  method: "POST", headers: { authorization: "Bearer local-test" }, body: null,
} as unknown as VercelRequest, qa.res);
assert.equal(qa.result().statusCode, 400, "invalid QA body rejected before any AI call");

const statusSource = readFileSync(new URL("../api/generate-text-status.ts", import.meta.url), "utf8");
assert.match(statusSource, /verifiedCustomerAuthUserId/);
assert.match(statusSource, /loadEditorialProfile\(sql, profileId, authUserId\)/);
assert.match(statusSource, /getOperationStatus\(/);
assert.doesNotMatch(statusSource, /generateSocialText\(|reserveUsage\(|runOpenAI/);
const qaSource = readFileSync(new URL("../api/content-qa.ts", import.meta.url), "utf8");
assert.match(qaSource, /handleContentQa/);
assert.match(qaSource, /MAX_JSON_BYTES/);
assert.doesNotMatch(qaSource, /workers\.dev|fetch\(/, "QA executes locally and never proxies user credentials to another service");
console.log("Vercel native QA + generation status + strategy routes: PASS");
