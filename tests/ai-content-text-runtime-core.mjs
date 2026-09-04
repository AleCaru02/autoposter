import assert from "node:assert/strict";
import { control,op,manual,autopilot,waitBackground,reset,entitlement,usage,genericCommitted,genericReserved,technicalOps,callTypes } from "./ai-content-text-runtime-lib.mjs";

export async function runCore({user,profileA,profileB,observed}){
  await reset(profileA);await entitlement(profileA,"disabled");
  let r=await manual(user.token,profileA,"capability-disabled");assert.equal(r.status,429);assert.equal(r.body?.error,"CAPABILITY_DISABLED");let calls=await control("provider-calls",{profileId:profileA,scenario:"capability-disabled"});assert.equal(calls.count,0);let u=await usage(profileA);assert.equal(u.generic.length,0);observed.push(r,calls,u);

  await reset(profileA);await entitlement(profileA,"limited",0);
  r=await manual(user.token,profileA,"limit-zero");assert.equal(r.status,429);assert.equal(r.body?.error,"CAPABILITY_LIMIT_REACHED");calls=await control("provider-calls",{profileId:profileA,scenario:"limit-zero"});assert.equal(calls.count,0);observed.push(r,calls);

  await reset(profileA);await entitlement(profileA,"limited",1);
  r=await manual(user.token,profileA,"first-generation");assert.equal(r.status,200);u=await usage(profileA);assert.equal(genericCommitted(u),1);assert.equal(genericReserved(u),0);assert.deepEqual(technicalOps(u),["GENERATE_SOCIAL_TEXT"]);
  r=await manual(user.token,profileA,"second-over-limit");assert.equal(r.status,429);calls=await control("provider-calls",{profileId:profileA,scenario:"second-over-limit"});assert.equal(calls.count,0);u=await usage(profileA);assert.equal(genericCommitted(u),1);observed.push(r,calls,u);

  await reset(profileA);await entitlement(profileA,"unlimited");await control("setup-profile",{profileId:profileA,researchMode:"NEWS",approvalMode:"MANUAL_REVIEW",topicTag:"research"});
  let a=await autopilot(user.token,profileA,"research-no-double-count");assert.equal(a.status,202);await waitBackground(profileA,"research-no-double-count",a.operationId);calls=await control("provider-calls",{profileId:profileA,scenario:"research-no-double-count"});assert.deepEqual(new Set(callTypes(calls)),new Set(["RESEARCH","MAIN","FACTCHECK"]));u=await usage(profileA);assert.equal(genericCommitted(u),1);for(const expected of ["GENERATE_SOCIAL_TEXT","AGENT_RESEARCH","AGENT_FACTCHECK"])assert.ok(technicalOps(u).includes(expected));observed.push(calls,u);

  await reset(profileA);await entitlement(profileA,"unlimited");await control("setup-profile",{profileId:profileA,researchMode:"WEBSITE_ONLY",approvalMode:"MANUAL_REVIEW"});
  r=await manual(user.token,profileA,"factcheck-no-double-count");assert.equal(r.status,200);calls=await control("provider-calls",{profileId:profileA,scenario:"factcheck-no-double-count"});assert.deepEqual(new Set(callTypes(calls)),new Set(["MAIN","FACTCHECK"]));u=await usage(profileA);assert.equal(genericCommitted(u),1);assert.ok(technicalOps(u).includes("AGENT_FACTCHECK"));observed.push(calls,u);

  await reset(profileA);await entitlement(profileA,"unlimited");await control("setup-profile",{profileId:profileA,researchMode:"WEBSITE_ONLY",approvalMode:"AUTOMATIC",topicTag:"editorial"});
  a=await autopilot(user.token,profileA,"editorial-qa-no-double-count");assert.equal(a.status,202);await waitBackground(profileA,"editorial-qa-no-double-count",a.operationId);calls=await control("provider-calls",{profileId:profileA,scenario:"editorial-qa-no-double-count"});assert.deepEqual(callTypes(calls),["MAIN","EDITORIAL_QA"]);u=await usage(profileA);assert.equal(genericCommitted(u),1);assert.ok(technicalOps(u).includes("AGENT_EDITORIAL_QA"));observed.push(calls,u);

  await reset(profileA);await reset(profileB);await control("seed-cost",{profileId:profileA,costUsd:1.25,tag:"current-spend-a-b"});await control("seed-cost",{profileId:profileB,costUsd:2.5,tag:"current-spend-a-b"});const spendA=await control("current-spend",{profileId:profileA});const spendB=await control("current-spend",{profileId:profileB});assert.equal(spendA.spend,1.25);assert.equal(spendB.spend,2.5);observed.push(spendA,spendB);

  await reset(profileA);await reset(profileB);await entitlement(profileA,"limited",1);await entitlement(profileB,"limited",1);
  assert.equal((await manual(user.token,profileA,"profile-a-b-isolation",op("profile-a-b-isolation","a-first"))).status,200);assert.equal((await manual(user.token,profileA,"profile-a-b-isolation",op("profile-a-b-isolation","a-second"))).status,429);assert.equal((await manual(user.token,profileB,"profile-a-b-isolation",op("profile-a-b-isolation","b-first"))).status,200);assert.equal(genericCommitted(await usage(profileA)),1);assert.equal(genericCommitted(await usage(profileB)),1);

  await reset(profileA);await entitlement(profileA,"limited",1);await control("setup-profile",{profileId:profileA,researchMode:"WEBSITE_ONLY",approvalMode:"MANUAL_REVIEW"});assert.equal((await manual(user.token,profileA,"manual-autopilot-shared-quota",op("manual-autopilot-shared-quota","manual"))).status,200);a=await autopilot(user.token,profileA,"manual-autopilot-shared-quota",op("manual-autopilot-shared-quota","autopilot"));assert.equal(a.status,202);await waitBackground(profileA,"manual-autopilot-shared-quota",a.operationId);calls=await control("provider-calls",{profileId:profileA,scenario:"manual-autopilot-shared-quota"});assert.equal(calls.count,1);u=await usage(profileA);assert.equal(genericCommitted(u),1);assert.equal(u.content,0);observed.push(calls,u);

  await reset(profileA);await entitlement(profileA,"limited",1);r=await manual(user.token,profileA,"provider-failure-release");assert.equal(r.status,502);calls=await control("provider-calls",{profileId:profileA,scenario:"provider-failure-release"});assert.equal(calls.count,1);u=await usage(profileA);assert.equal(u.generic.length,1);assert.equal(u.generic[0].state,"RELEASED");assert.equal(genericCommitted(u),0);assert.equal(genericReserved(u),0);observed.push(r,u);

  await reset(profileA);await entitlement(profileA,"limited",1);await control("seed-cost",{profileId:profileA,costUsd:0.1,tag:"legacy-budget-denial"});r=await manual(user.token,profileA,"legacy-budget-denial");assert.equal(r.status,429);assert.equal(r.body?.error,"AI_BUDGET_EXCEEDED");calls=await control("provider-calls",{profileId:profileA,scenario:"legacy-budget-denial"});assert.equal(calls.count,0);u=await usage(profileA);assert.equal(u.generic.length,1);assert.equal(u.generic[0].state,"RELEASED");observed.push(r,u);

  await reset(profileA);await entitlement(profileA,"limited",1);r=await manual(user.token,profileA,"metering-persistence-failure");assert.equal(r.status,503);assert.equal(r.body?.error,"METERING_FAILED");u=await usage(profileA);assert.equal(u.generic.length,1);assert.equal(u.generic[0].state,"RELEASED");assert.equal(u.generic[0].technical_usage_state,"PENDING_RECONCILIATION");assert.ok(Number(u.generic[0].technical_outbox_items)>0);assert.equal(u.technical.length,0);observed.push(r,u);
}
