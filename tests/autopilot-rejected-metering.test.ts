import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldDeferRejectedAutopilotSlot } from "../api/_lib/autopilot.js";

const now = new Date("2026-11-07T19:00:00.000Z");
const base = { state: "RELEASED", reason: "OPENAI_EDITORIAL_QUALITY_BLOCKED", created_at: "2026-11-07T17:02:26.500Z" };
assert.equal(shouldDeferRejectedAutopilotSlot(base, now), true, "a recent rejected attempt is on cooldown");
assert.equal(shouldDeferRejectedAutopilotSlot({...base, reason:"OPENAI_FACTCHECK_BLOCK"},now),true);
assert.equal(shouldDeferRejectedAutopilotSlot({...base, reason:"AUTOPILOT_DUPLICATE_CONTENT:0.82"},now),true);
assert.equal(shouldDeferRejectedAutopilotSlot({...base, reason:"AI_BUDGET_HARD_STOP"},now),false,"budget release is not quality rejection");
assert.equal(shouldDeferRejectedAutopilotSlot({...base, state:"COMMITTED"},now),false,"committed attempts are not rejected");
assert.equal(shouldDeferRejectedAutopilotSlot({...base, state:"RESERVED"},now),false,"pending attempts are not rejected");
assert.equal(shouldDeferRejectedAutopilotSlot({...base, created_at:"2026-11-06T18:59:59.999Z"},now),false,"24h cooldown expires");
assert.equal(shouldDeferRejectedAutopilotSlot({...base, created_at:"invalid"},now),false,"unparseable dates are not accepted");
assert.equal(shouldDeferRejectedAutopilotSlot({...base, created_at:"2026-11-07T19:01:00.000Z"},now),false,"future events ignored");

const autopilot = readFileSync(new URL("../api/_lib/autopilot.ts",import.meta.url),"utf8");
const serialized = readFileSync(new URL("../api/_lib/autopilot-serialized.ts",import.meta.url),"utf8");
const contentPage = readFileSync(new URL("../src/pages/content-generator-page.tsx",import.meta.url),"utf8");
assert.doesNotMatch(autopilot,/if\(reservation\.status==="RELEASED"\)throw new Error\("METERING_FAILED"\)/,
  "an intentionally released QA attempt must not be mislabeled as a metering infrastructure failure");
assert.match(autopilot,/if\(reservation\.status==="RELEASED"\)return \{scheduled:false,blocked:false,skipped:true,deferred:true\}/,
  "released attempts must be deferred instead of charged again");
assert.match(autopilot,/metadata->>'client_operation_identity'=\$\{operationIdentity\}/,
  "cooldown is identity-scoped to the same profile/provider/date slot");
assert.match(autopilot,/profile_id=\$\{profile\.id\}::uuid/,
  "cooldown must be profile-scoped");
assert.match(autopilot,/newAttempts>=missing/,
  "new AI requests must remain capped to the plan's missing content");
assert.match(autopilot,/if\(created\.skipped\)/,
  "master skip and prior QA rejections must not count as newly generated content");
assert.match(serialized,/if\(source\.deferred\)/,
  "deferred count must survive serialized aggregator");
assert.match(contentPage,/value\.deferred/,
  "the customer must be told that the next generation was deferred");
console.log("Autopilot QA release cooldown, accurate counting, and bounded AI requests: PASS");
