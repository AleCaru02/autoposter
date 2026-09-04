import assert from "node:assert/strict";
import {
  makeQaProviderKey,
  parseQaProviderKey,
  openAiCallType,
  allowedProviderCallType,
  fakeOpenAiPlan,
  safeProviderRecord,
  technicalPersistenceFailureBody,
} from "./ai-content-text-provider-harness.mjs";

const correlation = {
  marker: "33853769917",
  profileId: "11111111-1111-1111-1111-111111111111",
  scenario: "provider-contract",
  operationId: "operation-00000001",
  mode: "fake",
};
const key = makeQaProviderKey(correlation);
assert.deepEqual(parseQaProviderKey(key), correlation);
assert.equal(parseQaProviderKey("not-qa"), null);
assert.equal(parseQaProviderKey(makeQaProviderKey({ ...correlation, profileId: "not-a-uuid" })), null);

const bodyFor = (name, input = "{}") => ({ method: "POST", body: JSON.stringify({ text: { format: { name } }, input }) });
for (const [name, expected] of [
  ["post_automatici_social_content", "MAIN"],
  ["post_automatici_research_agent", "RESEARCH"],
  ["post_automatici_fact_check_agent", "FACTCHECK"],
  ["post_automatici_editorial_qa", "EDITORIAL_QA"],
]) {
  assert.equal(openAiCallType("https://api.openai.com/v1/responses", bodyFor(name)), expected);
  assert.equal(allowedProviderCallType(expected), true);
}
assert.equal(openAiCallType("https://api.openai.com/v1/responses", bodyFor("post_automatici_strategy")), "STRATEGIST");
assert.equal(openAiCallType("https://api.openai.com/v1/responses", bodyFor("post_automatici_editorial_plan")), "PLANNER");
assert.equal(openAiCallType("https://api.openai.com/v1/images/generations", { method: "POST", body: "{}" }), "IMAGE");
assert.equal(openAiCallType("https://example.com/v1/responses", bodyFor("post_automatici_social_content")), null);
assert.equal(allowedProviderCallType("STRATEGIST"), false);
assert.equal(allowedProviderCallType("IMAGE"), false);

const mainPlan = fakeOpenAiPlan({
  callType: "MAIN",
  correlation,
  requestBody: { input: JSON.stringify({ task: { providers: ["INSTAGRAM"], formats: ["POST"] } }), text: { format: { name: "post_automatici_social_content" } } },
});
assert.equal(mainPlan.status, 200);
assert.equal(mainPlan.barrier, false);
assert.equal(mainPlan.body.model, "gpt-5.6-terra");
const mainOutput = JSON.parse(mainPlan.body.output_text);
assert.equal(mainOutput.variants.length, 1);
assert.equal(mainOutput.variants[0].provider, "INSTAGRAM");
assert.equal(mainOutput.variants[0].format, "POST");

const researchPlan = fakeOpenAiPlan({ callType: "RESEARCH", correlation, requestBody: {} });
assert.equal(researchPlan.status, 200);
assert.ok(researchPlan.body.output.some((item) => item.type === "web_search_call"));
assert.equal(JSON.parse(fakeOpenAiPlan({ callType: "FACTCHECK", correlation, requestBody: {} }).body.output_text).verdict, "PASS");
assert.equal(JSON.parse(fakeOpenAiPlan({ callType: "EDITORIAL_QA", correlation, requestBody: {} }).body.output_text).verdict, "PASS");

const failure = fakeOpenAiPlan({ callType: "MAIN", correlation: { ...correlation, scenario: "provider-failure-release" }, requestBody: {} });
assert.equal(failure.status, 502);
for (const scenario of ["duplicate-reserved", "concurrent-distinct", "concurrent-duplicate"]) {
  const plan = fakeOpenAiPlan({ callType: "MAIN", correlation: { ...correlation, scenario }, requestBody: {} });
  assert.equal(plan.barrier, true, `${scenario} must arm deterministic barrier`);
}
const unsupported = fakeOpenAiPlan({ callType: "STRATEGIST", correlation, requestBody: {} });
assert.equal(unsupported.status, 500);
assert.equal(unsupported.body.error.code, "RUNTIME_VERIFIER_NOT_CERTIFIED");

const record = safeProviderRecord(correlation, "MAIN");
assert.deepEqual(Object.keys(record).sort(), ["callType","marker","operationId","profileId","scenario"].sort());
for (const forbidden of ["prompt","authorization","cookie","password","database","token"]) assert.equal(JSON.stringify(record).toLowerCase().includes(forbidden), false);

assert.equal(technicalPersistenceFailureBody(JSON.stringify({ query: "insert into public.ai_usage_events", params: ["AI_TEXT_QA_33853769917 metering-persistence-failure"] })), true);
assert.equal(technicalPersistenceFailureBody("insert into public.ai_usage_events"), false);

console.log("AI content text provider instrumentation contract: PASS");
