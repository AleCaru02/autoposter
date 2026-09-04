import assert from "node:assert/strict";
import { bootstrap,control,assertNoSensitive } from "./ai-content-text-runtime-lib.mjs";
import { runCore } from "./ai-content-text-runtime-core.mjs";
import { runConcurrency } from "./ai-content-text-runtime-concurrency.mjs";

export const scenarios=["capability-disabled","limit-zero","first-generation","second-over-limit","research-no-double-count","factcheck-no-double-count","editorial-qa-no-double-count","current-spend-a-b","profile-a-b-isolation","manual-autopilot-shared-quota","provider-failure-release","legacy-budget-denial","metering-persistence-failure","duplicate-committed","duplicate-reserved","concurrent-distinct","concurrent-duplicate","autopilot-retry","cleanup"];
const observed=[];const ctx=await bootstrap();await runCore({...ctx,observed});await runConcurrency({...ctx,observed});for(const value of observed)assertNoSensitive(value);
const finalState=await control("state");assert.equal(finalState.superAdmins,1);assert.equal(finalState.profilesWithoutOwner,0);assert.equal(finalState.multipleOwners,0);assert.equal(finalState.ownerMismatch,0);assert.equal(finalState.openPolicies,0);assert.equal(finalState.anonymousPrivilegedTables,0);
console.log("AI_CONTENT_TEXT_AUTHENTICATED_RUNTIME: PASS",JSON.stringify({scenarios:scenarios.length,providerInstrumentation:"PASS",genericAndTechnicalLedgers:"PASS",currentSpendIsolation:"PASS",concurrency:"PASS",sensitiveFindings:0}));
