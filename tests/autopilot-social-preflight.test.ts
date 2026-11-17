import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  verifiedAutopilotProviders,
  SOCIAL_PREFLIGHT_MAX_AGE_MS,
  type AutopilotSocialConnection,
} from "../api/_lib/autopilot-social-preflight.js";

const now = new Date("2026-11-17T12:00:00.000Z");
const base: AutopilotSocialConnection = {
  provider: "INSTAGRAM",
  status: "ACTIVE",
  has_token: true,
  has_account: true,
  last_validated_at: "2026-11-17T11:00:00.000Z",
  expires_at: null,
};
const providers=(...rows:AutopilotSocialConnection[])=>verifiedAutopilotProviders(rows,now);
assert.deepEqual([...providers(base)], ["INSTAGRAM"], "provider checked recently and connected qualifies");
assert.equal(providers({ ...base, status: "NOT_CONNECTED" }).size,0);
assert.equal(providers({ ...base, status: "RECONNECT_REQUIRED" }).size,0);
assert.equal(providers({ ...base, has_token: false }).size,0);
assert.equal(providers({ ...base, has_account: false }).size,0);
assert.equal(providers({ ...base, last_validated_at: null }).size,0);
assert.equal(providers({ ...base, last_validated_at: "2026-11-15T11:00:00.000Z" }).size,0);
assert.deepEqual([...providers({ ...base, last_validated_at: new Date(now.getTime()-SOCIAL_PREFLIGHT_MAX_AGE_MS) })], ["INSTAGRAM"]);
assert.equal(providers({ ...base, last_validated_at: "2026-11-17T13:00:00.000Z" }).size,0, "future verification rejected");
assert.equal(providers({ ...base, expires_at: "2026-11-17T10:00:00.000Z" }).size,0, "expired Instagram token rejected");
assert.equal(providers({ ...base, expires_at: "broken" }).size,0, "invalid expiry fails closed");
assert.deepEqual([...providers({ ...base, provider:"GBP", expires_at:"2026-11-16T10:00:00.000Z" })], ["GBP"],
  "GBP access token may expire after verification; refresh token handled by publisher");
assert.deepEqual([...providers(base,{...base,provider:"FACEBOOK"},{...base,provider:"LINKEDIN"} )].sort(),
  ["FACEBOOK","INSTAGRAM","LINKEDIN"]);
assert.equal(providers().size,0, "brand without any social must never incur autopilot spend");
const source = readFileSync(new URL("../api/_lib/autopilot.ts", import.meta.url), "utf8");
const start = source.indexOf("export async function runContentAutopilot(");
const end = source.indexOf("async function createPlannedContent",start+1);
const body = start < 0 ? "" : source.slice(start,end > start?end:undefined);
const verify = body.indexOf("verifiedAutopilotProviders(socialConnections,now)");
const skip = body.indexOf("if(!verifiedProviders.has(schedule.provider))");
const generate = body.indexOf("await createPlannedContent({");
assert.ok(verify > 0 && skip > verify && generate > skip, "verified destination must be checked BEFORE any paid content generation");
assert.match(body, /token_reference is not null as has_token/, "never rely on ACTIVE alone");
assert.match(body, /last_validated_at,expires_at/, "expired grants must not be used");
assert.match(body, /where profile_id=\$\{profile\.id\}::uuid/, "read destination credentials only for the same profile");
console.log("Autopilot verified-social preflight: PASS");
