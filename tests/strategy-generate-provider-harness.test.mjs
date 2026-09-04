import assert from "node:assert/strict";
import { allowedProviderCallType, fakeOpenAiPlan, makeQaProviderKey, openAiCallType, parseQaProviderKey, technicalPersistenceFailureBody } from "./strategy-generate-provider-harness.mjs";
const c={marker:"33870000000",profileId:"11111111-1111-1111-1111-111111111111",scenario:"success-and-duplicate",operationId:"strategy-success-and-duplicate"};
assert.deepEqual(parseQaProviderKey(makeQaProviderKey(c)),{...c,mode:"fake"});
assert.equal(openAiCallType("https://api.openai.com/v1/responses",{body:JSON.stringify({text:{format:{name:"post_automatici_strategy"}}})}),"STRATEGIST");
assert.equal(openAiCallType("https://api.openai.com/v1/responses",{body:JSON.stringify({text:{format:{name:"post_automatici_editorial_plan"}}})}),"PLANNER");
assert.equal(allowedProviderCallType("STRATEGIST"),true);assert.equal(allowedProviderCallType("PLANNER"),true);assert.equal(allowedProviderCallType("MAIN"),false);
for(const type of ["STRATEGIST","PLANNER"]){const plan=fakeOpenAiPlan({callType:type,correlation:c});assert.equal(plan.status,200);assert.equal(plan.body.output[0].content[0].type,"output_text");}
assert.equal(technicalPersistenceFailureBody("insert into public.ai_usage_events technical-persistence-failure STRATEGY_QA_"),true);
assert.equal(technicalPersistenceFailureBody("insert into public.ai_usage_events success STRATEGY_QA_"),false);
console.log("Strategy generate provider harness: PASS");
