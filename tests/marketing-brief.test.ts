import assert from "node:assert/strict";
import { buildMarketingBrief, marketingChannels } from "../src/features/marketing/marketing-brief.js";
const input = {brand:"Test A",objective:"Contatti",audience:"Proprietari",offer:"Consulenza",evidence:"",budgetEur:"100,50"};
for(const channel of marketingChannels){
  const brief = buildMarketingBrief({...input,channel});
  assert.match(brief,/Test A/);
  assert.match(brief,/Nessuna: verificare ogni affermazione/);
  assert.match(brief,/Nessuna campagna, invio, pubblicazione/);
  assert.doesNotMatch(brief,/Test B/);
}
assert.match(buildMarketingBrief({...input,channel:"META_ADS"}),/EUR 100,50/);
for(const budgetEur of ["", "0", "-10", "NaN", "100x"])assert.throws(()=>buildMarketingBrief({...input,channel:"META_ADS",budgetEur}),/budget/);
assert.throws(()=>buildMarketingBrief({...input,channel:"SEO",offer:" "}),/Compila/);
assert.match(buildMarketingBrief({...input,channel:"EMAIL"}),/disiscrizione/);
assert.match(buildMarketingBrief({...input,channel:"GEO"}),/Non garantire visibilità/);
console.log("Marketing brief: PASS");
