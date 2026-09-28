import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertSocialPublishingAllowed,
  processDuePublications,
  socialSafeModeState,
} from "../api/_lib/social.js";

assert.equal(socialSafeModeState({ SAFE_MODE: true }), "ON");
assert.equal(socialSafeModeState({ SAFE_MODE: " true " }), "ON");
assert.equal(socialSafeModeState({ SAFE_MODE: false }), "OFF");
assert.equal(socialSafeModeState({ SAFE_MODE: "FALSE" }), "OFF");
assert.equal(socialSafeModeState({}), "INVALID");
assert.equal(socialSafeModeState({ SAFE_MODE: "1" }), "INVALID");

assert.throws(
  () => assertSocialPublishingAllowed({ SAFE_MODE: true }),
  (error: unknown) => error instanceof Error && error.message === "SAFE_MODE_ACTIVE",
);
assert.throws(
  () => assertSocialPublishingAllowed({}),
  (error: unknown) => error instanceof Error && error.message === "SAFE_MODE_UNDETERMINED",
);
assert.doesNotThrow(() => assertSocialPublishingAllowed({ SAFE_MODE: false }));

const active = await processDuePublications({ SAFE_MODE: "true" });
assert.deepEqual(active, {
  ready: true,
  blocked: true,
  safeMode: "ON",
  reason: "SAFE_MODE_ACTIVE",
  checked: 0,
  published: 0,
  failed: 0,
  retryScheduled: 0,
  reviewRequired: 0,
});

const invalid = await processDuePublications({});
assert.deepEqual(invalid, {
  ready: true,
  blocked: true,
  safeMode: "INVALID",
  reason: "SAFE_MODE_UNDETERMINED",
  checked: 0,
  published: 0,
  failed: 0,
  retryScheduled: 0,
  reviewRequired: 0,
});

const socialSource = readFileSync(new URL("../api/_lib/social.ts", import.meta.url), "utf8");
const vercelSource = readFileSync(new URL("../api/social.ts", import.meta.url), "utf8");
const workerConfig = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");

const publishVariant = socialSource.slice(
  socialSource.indexOf("async function publishVariant"),
  socialSource.indexOf("export async function handleSocialApi"),
);
assert.match(
  publishVariant,
  /assertSocialPublishingAllowed\(env\);/,
  "every real provider publication must pass the server-side Safe Mode boundary",
);
assert.match(
  socialSource,
  /export async function processDuePublications[\s\S]*socialSafeModeState\(env\)/,
  "cron/retry publication processing must be blocked before claiming due jobs",
);
assert.match(
  vercelSource,
  /SAFE_MODE:\s*process\.env\.SAFE_MODE/,
  "the Vercel social runtime must receive the same server-side Safe Mode switch",
);
assert.match(workerConfig, /"SAFE_MODE":\s*"true"/, "production Worker config must keep Safe Mode enabled");
assert.match(envExample, /SAFE_MODE=true/, "documented default must be fail-closed");

console.log("Safe Mode: PASS");
