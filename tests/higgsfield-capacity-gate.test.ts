import assert from "node:assert/strict";
import {assessHiggsfieldCapacity} from "../api/_lib/higgsfield-capacity-gate.js";
const base={availableCredits:0,quotedCredits:15,modelId:"wan3_0_prime"};
assert.equal(assessHiggsfieldCapacity(base).reason,"INSUFFICIENT_CREDITS");
assert.equal(assessHiggsfieldCapacity({...base,availableCredits:15}).canSubmit,true);
assert.equal(assessHiggsfieldCapacity({...base,allowFreeGeneration:true,freeGenerationsRemaining:1,
 freeGenerationModelIds:["hf_mult_motion_control"]}).canSubmit,false);
assert.equal(assessHiggsfieldCapacity({...base,modelId:"hf_mult_motion_control",allowFreeGeneration:true,
 freeGenerationsRemaining:1,freeGenerationModelIds:["hf_mult_motion_control"]}).mode,"FREE");
assert.equal(assessHiggsfieldCapacity({...base,quotedCredits:-1}).canSubmit,false);
console.log("Higgsfield capacity gate passed");
