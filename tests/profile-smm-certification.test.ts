import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildEditorialMemoryInstruction,
  buildEditorialMemorySnapshot,
  deriveContinuityDecision,
  type EditorialMemoryRecentContent,
} from "../api/_lib/editorial-memory.js";
import { chooseSubjectStrategy, profileTypeStrategyInstruction } from "../api/_lib/subject-strategy.js";
import { evaluateFeedCoherence } from "../api/_lib/feed-coherence.js";
import { findEditorialRepetition } from "../api/_lib/content-dedupe.js";
import { classifyContentFeedback } from "../api/_lib/content-review.js";
import { compareProfileTypeCertification, runProfileSmmCertificationSimulation } from "../api/_lib/profile-smm-certification.js";

const recent:EditorialMemoryRecentContent[]=[
  {id:"1",topic:"Tema A",angle:"Angolo A",pillar:"Pillar A",hook:"Hook A",cta:"CTA A",provider:"INSTAGRAM",format:"POST",visualArchetype:"INFOGRAPHIC",subjectStrategy:"INFOGRAPHIC",seriesId:null,sequenceNumber:null,nextTopicIntent:null,continuityReason:null,createdAt:"2026-09-29T10:00:00Z",publishedAt:null,sourceRefs:[{url:"https://example.com/a"}],decisionRecord:{offer:"Consulenza Premium",services:["Audit profilo","Piano editoriale"]}},
  {id:"2",topic:"Tema B",angle:"Angolo B",pillar:"Pillar A",hook:"Hook B",cta:"CTA A",provider:"FACEBOOK",format:"POST",visualArchetype:"ENVIRONMENT_EDITORIAL",subjectStrategy:"ENVIRONMENT",seriesId:null,sequenceNumber:null,nextTopicIntent:null,continuityReason:null,createdAt:"2026-09-28T10:00:00Z",publishedAt:null,sourceRefs:[]},
  {id:"3",topic:"Tema C",angle:"Angolo C",pillar:"Pillar B",hook:"Hook C",cta:"CTA B",provider:"LINKEDIN",format:"POST",visualArchetype:"SERVICE_EXPLAINER",subjectStrategy:"SERVICE",seriesId:null,sequenceNumber:null,nextTopicIntent:null,continuityReason:null,createdAt:"2026-09-27T10:00:00Z",publishedAt:null,sourceRefs:[]},
];
const memory=buildEditorialMemorySnapshot({
  profileType:"BUSINESS",
  recent,
  feedback:[
    {code:"TOO_GENERIC",note:"recente",weight:1,createdAt:"2026-09-30T09:00:00Z"},
    {code:"WRONG_TONE",note:"vecchio",weight:1,createdAt:"2026-05-01T09:00:00Z"},
  ],
  strategyPillars:["Pillar A","Pillar B","Pillar C"],
  calendar:[{provider:"INSTAGRAM",format:"POST",scheduledAt:"2026-10-02T09:00:00Z",state:"SCHEDULED",topic:"Futuro"}],
  learning:[{dimension:"TOPIC",value:"Pillar B",confidence:"HIGH",upliftPct:18,sampleSize:12}],
  performance:[
    {contentId:"1",provider:"INSTAGRAM",format:"POST",topic:"Tema A",publishedAt:"2026-09-29T09:00:00Z",capturedAt:"2026-09-30T09:00:00Z",metrics:{reach:1000,likes:80,comments:10,shares:5,saves:10}},
    {contentId:"2",provider:"FACEBOOK",format:"POST",topic:"Tema B",publishedAt:"2026-09-28T09:00:00Z",capturedAt:"2026-09-30T09:00:00Z",metrics:{impressions:1000,reactions:20,comments:2,shares:1}},
  ],
  now:new Date("2026-09-30T10:00:00Z"),
});
assert.equal(memory.profileType,"BUSINESS");
assert.ok(memory.balance.underusedPillars.includes("Pillar C"),"pillar non usato deve emergere nella memoria");
assert.equal(memory.feedback.weightedSignals[0].code,"TOO_GENERIC","feedback recente deve pesare più di uno molto vecchio");
assert.match(buildEditorialMemoryInstruction(memory),/Pillar relativamente trascurati/i);
assert.equal(memory.calendar.futureCount,1);
assert.ok(memory.recent.productsOrServices.includes("Consulenza Premium"));
assert.ok(memory.recent.productsOrServices.includes("Audit profilo"));
assert.equal(memory.performance.realSnapshotCount,2);
assert.equal(memory.performance.scoredContentCount,2);
assert.equal(memory.performance.topContent[0].topic,"Tema A");
const memoryInstruction=buildEditorialMemoryInstruction(memory);
assert.match(memoryInstruction,/Prodotti\/servizi già trattati/i);
assert.match(memoryInstruction,/Performance reali provider/i);

const startSeries=deriveContinuityDecision({
  memory,
  profileType:"BUSINESS",
  contentType:"STORYTELLING",
  intent:"CASE_STUDY",
  topic:"Pillar C: come è iniziato il processo",
});
assert.equal(startSeries.mode,"START_SERIES");
assert.ok(startSeries.seriesId);
assert.ok(startSeries.nextTopicIntent);

const seriesMemory=buildEditorialMemorySnapshot({
  profileType:"BUSINESS",
  strategyPillars:["Pillar A","Pillar B","Pillar C"],
  recent:[{
    id:"series-1",topic:"Pillar C: come è iniziato il processo",angle:"Origine",pillar:"Pillar C",hook:"Come è iniziato",cta:"Approfondisci",provider:"INSTAGRAM",format:"CAROUSEL",
    visualArchetype:"ENVIRONMENT_CAROUSEL",subjectStrategy:"ENVIRONMENT",seriesId:startSeries.seriesId,sequenceNumber:1,nextTopicIntent:startSeries.nextTopicIntent,
    continuityReason:startSeries.continuityReason,createdAt:"2026-09-30T10:00:00Z",publishedAt:null,sourceRefs:[],
  }],
  feedback:[],calendar:[],learning:[],now:new Date("2026-10-01T10:00:00Z"),
});
const continuation=deriveContinuityDecision({
  memory:seriesMemory,
  profileType:"BUSINESS",
  contentType:"SINGLE_POST",
  intent:"EDUCATION",
  topic:startSeries.nextTopicIntent!,
});
assert.equal(continuation.mode,"CONTINUE_SERIES","N+1 deve usare il nextTopicIntent persistito quando è davvero coerente");
assert.equal(continuation.previousContentId,"series-1");
assert.equal(continuation.sequenceNumber,2);

const businessStrategy=profileTypeStrategyInstruction({
  profileType:"BUSINESS",industry:"Servizi professionali",businessModel:"Consulenza",offer:"Servizio",audience:"Clienti",objective:"Fiducia",provider:"INSTAGRAM",
});
const personalStrategy=profileTypeStrategyInstruction({
  profileType:"PERSONAL_BRAND",industry:"Servizi professionali",businessModel:"Consulenza",offer:"Servizio",audience:"Clienti",objective:"Fiducia",provider:"INSTAGRAM",
});
assert.notEqual(businessStrategy,personalStrategy);
assert.match(personalStrategy,/persona canonica/i);
assert.match(businessStrategy,/non richiede una persona canonica/i);

const businessSubject=chooseSubjectStrategy({
  profileType:"BUSINESS",provider:"INSTAGRAM",format:"POST",topic:"Il professionista spiega il servizio",angle:"Metodo",visualBrief:"Persona professionista generica in ambiente di lavoro",memory:null,suitableRealAssetAvailable:false,canonicalIdentityReady:false,
});
const personalSubject=chooseSubjectStrategy({
  profileType:"PERSONAL_BRAND",provider:"INSTAGRAM",format:"POST",topic:"La mia storia personale",angle:"Il mio percorso",visualBrief:"Ritratto della persona titolare del personal brand",memory:null,suitableRealAssetAvailable:false,canonicalIdentityReady:true,
});
assert.notEqual(businessSubject.subject,personalSubject.subject);
assert.equal(personalSubject.subject,"CANONICAL_PERSON");
assert.equal(personalSubject.canonicalIdentityRequired,true);
assert.notEqual(businessSubject.subject,"CANONICAL_PERSON");

const personalNoIdentity=chooseSubjectStrategy({
  profileType:"PERSONAL_BRAND",provider:"INSTAGRAM",format:"POST",topic:"La mia storia personale",angle:"Il mio percorso",visualBrief:"Ritratto della persona titolare del personal brand",memory:null,suitableRealAssetAvailable:false,canonicalIdentityReady:false,
});
assert.notEqual(personalNoIdentity.subject,"CANONICAL_PERSON");
assert.equal(personalNoIdentity.prohibitSyntheticPerson,true);

const identityBlocked=evaluateFeedCoherence({
  profileType:"PERSONAL_BRAND",subject:"CANONICAL_PERSON",visualArchetype:"EDITORIAL_PORTRAIT",pillar:"Authority",seriesId:null,sequenceNumber:null,previousContentId:null,nextTopicIntent:null,
  assetProvider:"OPENAI",identityStatus:"NOT_REQUIRED",memory:null,
});
assert.equal(identityBlocked.status,"FAIL");
assert.ok(identityBlocked.reasons.includes("CANONICAL_PERSON_IDENTITY_NOT_CERTIFIED"));
const identityPass=evaluateFeedCoherence({
  profileType:"PERSONAL_BRAND",subject:"CANONICAL_PERSON",visualArchetype:"EDITORIAL_PORTRAIT",pillar:"Authority",seriesId:null,sequenceNumber:null,previousContentId:null,nextTopicIntent:null,
  assetProvider:"HIGGSFIELD",identityStatus:"PASS",memory:null,
});
assert.equal(identityPass.status,"PASS");

assert.equal(classifyContentFeedback("Il volto non è abbastanza simile", {hook:false,caption:false,cta:false,hashtags:false,visualBrief:false,altText:false}),"IDENTITY_BAD");
assert.equal(classifyContentFeedback("Troppo generico", {hook:false,caption:false,cta:false,hashtags:false,visualBrief:false,altText:false}),"TOO_GENERIC");
assert.equal(classifyContentFeedback(null, {hook:false,caption:false,cta:false,hashtags:false,visualBrief:true,altText:false}),"BAD_VISUAL");

const repetition=findEditorialRepetition(
  {topic:"Nuovo tema",angle:"Nuovo angolo",hook:"Hook distinto",caption:"Caption distinta",cta:"Contattaci",pillar:"Authority",visualArchetype:"INFOGRAPHIC",subjectStrategy:"INFOGRAPHIC",narrativeStructure:"SINGLE_POST"},
  Array.from({length:5},(_,index)=>({topic:`Altro ${index}`,angle:`Angolo ${index}`,hook:`Hook ${index}`,caption:`Copy ${index}`,cta:"Contattaci",pillar:"Authority",visualArchetype:index<3?"INFOGRAPHIC":"OBJECT",subjectStrategy:"INFOGRAPHIC",narrativeStructure:"SINGLE_POST"})),
);
assert.equal(repetition.blocked,true);
assert.ok(repetition.reasons.includes("CTA_OVERUSED"));
assert.ok(repetition.reasons.includes("PILLAR_OVERUSED"));
assert.ok(repetition.reasons.includes("VISUAL_ARCHETYPE_OVERUSED"));

const commonFixture={
  industry:"Servizi professionali generici",
  businessModel:"Servizio consulenziale",
  offer:"Consulenza e supporto",
  audience:"Persone interessate al servizio",
  objective:"Costruire fiducia e generare richieste qualificate",
  pillars:["Competenza","Processo","Esperienza","Servizio"],
};
const business=runProfileSmmCertificationSimulation({profileId:"business-test",profileType:"BUSINESS",...commonFixture,canonicalIdentityReady:false},{count:20});
const personal=runProfileSmmCertificationSimulation({profileId:"personal-test",profileType:"PERSONAL_BRAND",...commonFixture,canonicalIdentityReady:true},{count:20});
assert.equal(business.simulatedContentCount,20);
assert.equal(personal.simulatedContentCount,20);
assert.equal(business.publishingExecuted,false);
assert.equal(personal.publishingExecuted,false);
assert.equal(business.providerCallsExecuted,false);
assert.equal(personal.providerCallsExecuted,false);
assert.equal(business.proof.publicationJobsCreated,0);
assert.equal(personal.proof.realHiggsfieldGenerations,0);
assert.equal(business.proof.memoryChangedNextDecision,true);
assert.equal(personal.proof.memoryChangedNextDecision,true);
assert.equal(business.proof.continuityNChangesNPlus1,true);
assert.equal(personal.proof.continuityNChangesNPlus1,true);
assert.equal(business.status,"PASS",JSON.stringify({gates:business.gates,failed:business.contents.filter((row)=>Object.values(row.gates).includes("FAIL")).map((row)=>({sequence:row.sequence,gates:row.gates,subject:row.subject,visual:row.visualArchetype,antiRepetitionReasons:row.antiRepetitionReasons,duplicateScore:row.duplicateScore}))},null,2));
assert.equal(personal.status,"PASS",JSON.stringify({gates:personal.gates,failed:personal.contents.filter((row)=>Object.values(row.gates).includes("FAIL")).map((row)=>({sequence:row.sequence,gates:row.gates,subject:row.subject,visual:row.visualArchetype}))},null,2));
const comparison=compareProfileTypeCertification(business,personal);
assert.equal(comparison.pass,true,JSON.stringify(comparison));
assert.equal(comparison.sameIndustry,true);
assert.equal(comparison.substantiallyDifferent,true);

const migration=fs.readFileSync("db/migrations/20260930_profile_autonomous_smm_certification.sql","utf8");
assert.match(migration,/profile_editorial_memory/);
assert.match(migration,/content_feedback_events/);
assert.match(migration,/profile_smm_certification_runs/);
assert.match(migration,/series_id uuid/);
assert.match(migration,/next_topic_intent text/);
assert.match(migration,/CANONICAL_PERSON/);

const autopilot=fs.readFileSync("api/_lib/autopilot.ts","utf8");
assert.match(autopilot,/refreshProfileEditorialMemory/);
assert.match(autopilot,/buildEditorialMemoryInstruction\(memory\)/);
assert.match(autopilot,/profileTypeStrategyInstruction/);
assert.match(autopilot,/deriveContinuityDecision/);
assert.match(autopilot,/findEditorialRepetition/);
assert.match(autopilot,/subject_strategy/);
assert.match(autopilot,/next_topic_intent/);
assert.match(autopilot,/subject:subjectDecision\.subject/);
assert.match(autopilot,/profileType:profile\.profile_type/);
const memorySource=fs.readFileSync("api/_lib/editorial-memory.ts","utf8");
assert.match(memorySource,/from public\.metric_snapshots/);
assert.match(memorySource,/data_origin='PROVIDER_REAL'/);
assert.match(memorySource,/decision_record/);
assert.match(memorySource,/productsOrServices/);
assert.match(memorySource,/Performance reali provider/);

console.log("PROFILE AUTONOMOUS SMM certification simulation: PASS");
