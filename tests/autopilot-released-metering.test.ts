import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldDeferRejectedAutopilotSlot } from "../api/_lib/autopilot.js";

const now=new Date("2026-11-07T19:00:00.000Z");
const rejected={state:"RELEASED",reason:"OPENAI_EDITORIAL_QUALITY_BLOCKED",created_at:"2026-11-07T17:02:26.500Z"};
assert.equal(shouldDeferRejectedAutopilotSlot(rejected,now),true);
assert.equal(shouldDeferRejectedAutopilotSlot({...rejected,reason:"OPENAI_FACTCHECK_BLOCK"},now),true);
assert.equal(shouldDeferRejectedAutopilotSlot({...rejected,reason:"AUTOPILOT_DUPLICATE_CONTENT:0.8"},now),true);
assert.equal(shouldDeferRejectedAutopilotSlot({...rejected,reason:"AI_BUDGET_HARD_STOP"},now),false);
assert.equal(shouldDeferRejectedAutopilotSlot({...rejected,state:"COMMITTED"},now),false);
assert.equal(shouldDeferRejectedAutopilotSlot({...rejected,created_at:"2026-11-06T18:59:59.000Z"},now),false);
assert.equal(shouldDeferRejectedAutopilotSlot({...rejected,created_at:"invalid"},now),false);
assert.equal(shouldDeferRejectedAutopilotSlot({...rejected,created_at:"2026-11-07T19:01:00Z"},now),false);

const source=readFileSync(new URL("../api/_lib/autopilot.ts",import.meta.url),"utf8");
const runner=readFileSync(new URL("../api/_lib/autopilot-serialized.ts",import.meta.url),"utf8");
assert.doesNotMatch(source,/if\(reservation\.status==="RELEASED"\)throw new Error\("METERING_FAILED"\)/);
assert.match(source,/if\(reservation\.status==="RELEASED"\)return \{scheduled:false,blocked:false,skipped:true,deferred:true\}/);
assert.match(source,/metadata->>'client_operation_identity'=\$\{operationIdentity\}/);
assert.match(source,/state='RELEASED' and created_at>=now\(\)-interval '24 hours'/);
assert.match(source,/newAttempts>=missing/);
assert.match(source,/if\(created\.skipped\)/);
assert.match(runner,/if\(source\.deferred\)/);
console.log("Autopilot released QA no-repeat metering and bounded retry PASS");
