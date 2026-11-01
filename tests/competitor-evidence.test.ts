import assert from "node:assert/strict";
import { competitorResearchContext, editorialQualityGate, validCompetitorObservation } from "../api/_lib/competitor-evidence.js";
const observation={
  competitor:"Studio Alfa",sourceUrl:"https://example.org/posts/1",observedAt:"2026-10-28T10:00:00Z",
  platform:"INSTAGRAM",positioning:"Siti per negozi",format:"REEL" as const,
  topic:"Errori dei siti dei negozi",hook:"Tre errori frequenti",cta:"Richiedi una consulenza",
  publicLikes:50,publicComments:2
};
assert.equal(validCompetitorObservation(observation),true);
assert.equal(validCompetitorObservation({...observation,sourceUrl:"javascript:alert(1)"}),false);
assert.equal(validCompetitorObservation({...observation,publicLikes:-3}),false);
const context=competitorResearchContext([observation,{...observation,sourceUrl:"ftp://example.org"}],[]);
assert.equal(context.evidenceCount,1);
assert.equal(context.untestedDirections.length,1);
assert.equal(competitorResearchContext([observation],[observation.topic]).untestedDirections.length,0);
assert.deepEqual(editorialQualityGate({
 audience:"Commercianti",objective:"Richieste di bozza",topic:"Sito veloce",
 hook:"Il tuo sito fa scappare clienti?",angle:"Mostrare come un sito lento perde opportunità",
 cta:"Richiedi la bozza gratuita"
},[]),{approved:true,blockers:[]});
assert.equal(editorialQualityGate({
 audience:"",objective:"",topic:"Sito veloce",hook:"No",angle:"No",cta:"No"
},["Sito veloce"]).approved,false);
console.log("competitor evidence tests passed");
