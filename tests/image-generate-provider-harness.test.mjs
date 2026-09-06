import assert from "node:assert/strict";
import { allowedProviderCallType, fakeOpenAiPlan, makeQaProviderKey, openAiCallType, parseQaProviderKey, technicalPersistenceFailureBody } from "./image-generate-provider-harness.mjs";
const c={marker:"33870000000",profileId:"11111111-1111-1111-1111-111111111111",scenario:"success-and-duplicate",operationId:"image-success-and-duplicate"};
assert.deepEqual(parseQaProviderKey(makeQaProviderKey(c)),{...c,mode:"fake"});
assert.equal(openAiCallType("https://api.openai.com/v1/responses",{body:JSON.stringify({text:{format:{name:"post_automatici_media_manager"}}})}),"MEDIA_MANAGER");
assert.equal(openAiCallType("https://api.openai.com/v1/images/generations",{body:"{}"}),"IMAGE");
assert.equal(openAiCallType("https://api.openai.com/v1/responses",{body:JSON.stringify({text:{format:{name:"post_automatici_social_content"}}})}),"TEXT");
for(const type of ["MEDIA_MANAGER","IMAGE","TEXT"]){assert.equal(allowedProviderCallType(type),true);assert.equal(fakeOpenAiPlan({callType:type,correlation:c}).status,200);}
assert.equal(allowedProviderCallType("OTHER"),false);
assert.equal(technicalPersistenceFailureBody("insert into public.ai_usage_events technical-persistence-failure IMAGE_QA_"),true);
assert.equal(technicalPersistenceFailureBody("insert into public.ai_usage_events success IMAGE_QA_"),false);
console.log("Image generate provider harness: PASS");
