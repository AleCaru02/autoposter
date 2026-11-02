import assert from "node:assert/strict";
import { test } from "node:test";
import { decideEditorialMix } from "../api/_lib/adaptive-editorial-mix.js";

const costs={REEL:8,POST:0.5,CAROUSEL:1.5};
test("never exceeds monthly budget or maximum count",()=>{
 for(const budget of [0,1,5,30,100,250]){
  const d=decideEditorialMix({monthlyBudgetEur:budget,unitCostEur:costs,maxPublications:30});
  assert.ok(d.total<=30);
  assert.ok(d.mix.REEL*8+d.mix.POST*.5+d.mix.CAROUSEL*1.5<=budget+1e-7);
  assert.equal(d.total,d.mix.REEL+d.mix.POST+d.mix.CAROUSEL);
 }
});
test("zero budget produces no content or billable activity",()=>{
 const d=decideEditorialMix({monthlyBudgetEur:0,unitCostEur:costs,maxPublications:30});
 assert.equal(d.total,0);
 assert.equal(d.requiresApproval,true);
});
test("autopublish authorization only changes approval flag, not publishing",()=>{
 const d=decideEditorialMix({monthlyBudgetEur:20,unitCostEur:costs,maxPublications:30,autopublishAuthorized:true});
 assert.equal(d.requiresApproval,false);
 assert.ok(d.total>0);
});
test("invalid budgets and performance cannot pass",()=>{
 assert.throws(()=>decideEditorialMix({monthlyBudgetEur:-1,unitCostEur:costs,maxPublications:30}));
 assert.throws(()=>decideEditorialMix({monthlyBudgetEur:30,unitCostEur:costs,maxPublications:30,history:[{format:"REEL",qualifiedLeads:-1,published:2}]}));
});
test("insufficient performance evidence is explicitly declared",()=>{
 const d=decideEditorialMix({monthlyBudgetEur:30,unitCostEur:costs,maxPublications:30});
 assert.match(d.rationale[0],/insufficienti/i);
});
