import assert from "node:assert/strict";
import fs from "node:fs";
import { decideVisualRuntime, visualIntentFromBrief } from "../api/_lib/visual-runtime-decision.js";

assert.equal(visualIntentFromBrief("Ritratto della stessa persona in una nuova scena in ufficio").personIsPrimarySubject,true);
assert.equal(visualIntentFromBrief("Grafica informativa con icone e testo").personIsPrimarySubject,false);

const business=decideVisualRuntime({
  profileType:"BUSINESS",
  visualBrief:"Grafica informativa sui servizi",
  suitableRealAssetAvailable:false,
  higgsfieldConfigured:true,
  soulIdentityState:"COMPLETED",
  higgsfieldBudgetRemainingEur:10,
  estimatedHiggsfieldCostEur:0.25,
  estimatedOpenAiCostEur:0.25,
});
assert.equal(business.provider,"OPENAI");
assert.equal(business.model,"gpt-image-2");
assert.equal(business.identityQaStatus,"NOT_REQUIRED");

const fallback=decideVisualRuntime({
  profileType:"PERSONAL_BRAND",
  visualBrief:"Ritratto della stessa persona in una nuova scena professionale",
  suitableRealAssetAvailable:false,
  higgsfieldConfigured:true,
  soulIdentityState:"NOT_CONFIGURED",
  higgsfieldBudgetRemainingEur:10,
  estimatedHiggsfieldCostEur:0.25,
  estimatedOpenAiCostEur:0.25,
});
assert.equal(fallback.provider,"OPENAI");
assert.equal(fallback.mustAvoidSyntheticPerson,true);
assert.equal(fallback.reasonCode,"SOUL_ID_NOT_READY");

const ready=decideVisualRuntime({
  profileType:"PERSONAL_BRAND",
  visualBrief:"Shooting virtuale della stessa persona in studio",
  suitableRealAssetAvailable:false,
  higgsfieldConfigured:true,
  soulIdentityState:"COMPLETED",
  higgsfieldBudgetRemainingEur:10,
  estimatedHiggsfieldCostEur:0.25,
  estimatedOpenAiCostEur:0.25,
});
assert.equal(ready.provider,"HIGGSFIELD");
assert.equal(ready.model,"soul_2");
assert.equal(ready.identityQaStatus,"PENDING");

const reused=decideVisualRuntime({
  profileType:"PERSONAL_BRAND",
  visualBrief:"Ritratto personale",
  suitableRealAssetAvailable:true,
  higgsfieldConfigured:true,
  soulIdentityState:"COMPLETED",
  higgsfieldBudgetRemainingEur:10,
  estimatedHiggsfieldCostEur:0.25,
  estimatedOpenAiCostEur:0.25,
});
assert.equal(reused.provider,"REAL_ASSET");
assert.equal(reused.estimatedCostEur,0);

const autopilot=fs.readFileSync("api/_lib/autopilot.ts","utf8");
for(const field of ["visual_provider","visual_model","visual_decision_reason","visual_estimated_cost_eur","visual_actual_cost_eur","visual_identity_qa_status"]){
  assert.match(autopilot,new RegExp(field));
}
assert.match(autopilot,/costBucket:"OTHER_AI"/);
assert.match(autopilot,/BLOCKED_UNTIL_RUNTIME_CERTIFIED/);
assert.doesNotMatch(autopilot,/generateHiggsfieldImage|api\.higgsfield\.ai\/.*generate/);

const migration=fs.readFileSync("db/migrations/20260929_zz_visual_routing_persistence.sql","utf8");
assert.match(migration,/visual_provider text/);
assert.match(migration,/REAL_ASSET','OPENAI','HIGGSFIELD/);

console.log("Visual routing persistence: PASS");
