import assert from "node:assert/strict";
import { buildWebsitePlanningEvidence } from "../api/_lib/strategy-website-evidence.js";
import { verifyCompetitorResearch } from "../api/_lib/competitor-evidence.js";
import { readFileSync } from "node:fs";

const data = [
  {url:"https://client.example/",title:"Homepage",meta_description:"Attività",content_excerpt:"Presentazione",scanned_at:"2026-11-01T10:00:00Z"},
  {url:"https://client.example/servizi",title:"Servizi",meta_description:"Gestione immobiliare",content_excerpt:"Affitti brevi Milano",scanned_at:"2026-11-02T10:00:00Z"},
  {url:"https://client.example/faq",title:"FAQ",meta_description:"Risposte",content_excerpt:"Come funziona",scanned_at:"2026-11-02T10:00:00Z"},
  ...Array.from({length:80},(_,i)=>({url:`https://client.example/blog/seo-${i}`,title:`Blog ${i}`,meta_description:null,content_excerpt:"SEO",scanned_at:"2026-10-01T10:00:00Z"})),
];
const evidence=buildWebsitePlanningEvidence(data,5);
assert.equal(evidence.scannedPageCount,83);
assert.equal(evidence.sampledPageCount,5);
assert.equal(evidence.latestScanAt,"2026-11-02T10:00:00Z");
assert.ok(evidence.pages.some(p=>p.url.endsWith("/servizi")));
assert.ok(evidence.pages.some(p=>p.url.endsWith("/faq")));
assert.ok(evidence.sections.some(s=>s.section==="blog"&&s.pageCount===80));
const fake=verifyCompetitorResearch({
  candidates:[
    {name:"Competitor reale",website:"https://competitor.example/offerta",positioning:"Proposta",editorialOpportunity:"Confronto originale"},
    {name:"Inventato",website:"https://made-up.example",positioning:"Invenzione",editorialOpportunity:"Errore"},
    {name:"Stesso brand",website:"https://client.example/servizi",positioning:"",editorialOpportunity:""},
  ],
  providerSources:["https://competitor.example/offerta","https://directory.example/list"],ownWebsite:"https://client.example",searched:true,
});
assert.equal(fake.status,"VERIFIED_PUBLIC_SOURCES");
assert.equal(fake.competitors.length,1);
assert.equal(fake.competitors[0].verifiedSource,"https://competitor.example/offerta");
assert.equal(verifyCompetitorResearch({candidates:[{name:"Fake",website:"https://fake.example",positioning:"",editorialOpportunity:""}],providerSources:[],ownWebsite:null,searched:true}).status,"NO_VERIFIED_SOURCES");
assert.equal(verifyCompetitorResearch({candidates:[],providerSources:[],ownWebsite:null,searched:false}).status,"NOT_SEARCHED");
const store=readFileSync(new URL("../src/pages/content-generator-page.tsx",import.meta.url),"utf8");
assert.ok(store.indexOf("autopilot-master")<store.indexOf("<ManualContentComposer"),"Autopilot must come before manual form");
assert.ok(store.indexOf("I prossimi argomenti") < store.indexOf("Preferenze dell\'automazione"), "Saved AI plan must precede optional settings");
assert.ok(store.includes("showManualComposer && <div className=\"editorial-manual-composer\""),"Manual composer must be opt-in");
assert.ok(store.includes("I prossimi argomenti"),"The autonomous editorial plan must be immediately visible");
assert.ok(store.includes("Fonti e concorrenti"),"Competitor research status must be visible without invented claims");
const storeApi=readFileSync(new URL("../src/features/content/autopilot-store.ts",import.meta.url),"utf8");
assert.ok(storeApi.includes("aiEditorialPlan"),"Topics must come from actual saved AI plan");
assert.ok(storeApi.includes("VERIFIED_PUBLIC_SOURCES"),"Only verified competitor results may be displayed");
const cron=readFileSync(new URL("../api/_lib/autopilot-serialized.ts",import.meta.url),"utf8");
assert.match(cron,/order by activity\.last_generated asc nulls first/);
console.log("autonomous website/competitor grounding, fair profiles and UX: PASS");
