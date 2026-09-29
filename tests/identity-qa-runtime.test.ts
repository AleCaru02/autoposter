import assert from "node:assert/strict";
import fs from "node:fs";
import { finalizeIdentityQa } from "../api/_lib/openai-identity-qa.js";

const passScores = {
  face:0.95,eyes:0.9,hair:0.9,nose:0.9,mouth:0.9,apparent_age:0.9,body:0.9,proportions:0.9,
  hands:0.9,fingers:0.9,teeth:0.9,anatomy:0.9,artifacts:0.9,realism:0.9,overall_quality:0.9,
  composition:0.9,social_format:0.9,
};
assert.equal(finalizeIdentityQa(passScores,[]).verdict,"PASS");

assert.equal(finalizeIdentityQa({...passScores,face:0.6},[]).verdict,"BLOCK");
assert.equal(finalizeIdentityQa({...passScores,hands:0.5},[]).verdict,"BLOCK");
assert.equal(finalizeIdentityQa({...passScores,composition:0.5},[]).verdict,"BLOCK");
assert.equal(finalizeIdentityQa({...passScores,social_format:0.5},[]).verdict,"BLOCK");

const runtime=fs.readFileSync("api/_lib/openai-identity-qa.ts","utf8");
for(const dimension of ["face","eyes","hair","nose","mouth","apparent_age","body","proportions","hands","fingers","teeth","anatomy","artifacts","realism","overall_quality","composition","social_format"]){
  assert.match(runtime,new RegExp(`"${dimension}"`));
}
assert.match(runtime,/visual\.identity\.qa/);
assert.match(runtime,/cost_bucket:\s*"OTHER_AI"/);
assert.match(runtime,/markProviderStarted\(eventId,0\.05\)/);
assert.match(runtime,/reconcileProviderCostAttempt\(eventId\)/);
assert.match(runtime,/visual_identity_qa_status/);
assert.match(runtime,/gpt-5\.6-terra/);
assert.match(runtime,/input_image/);
assert.doesNotMatch(runtime,/HF_CREDENTIALS|hf-api-key|hf-secret/);

console.log("Identity QA runtime: PASS");
