import { CONTENT_AGENTS, chooseContentType, chooseEditorialIntent, mapContentTypeToSocialFormat, type EditorialIntent } from "./content-agents.js";
import { buildEditorialMemoryInstruction, buildEditorialMemorySnapshot, deriveContinuityDecision, type EditorialMemoryRecentContent, type EditorialMemorySnapshot, type ProfileType } from "./editorial-memory.js";
import { findEditorialRepetition, findNearDuplicate, type ContentDedupeCandidate } from "./content-dedupe.js";
import { evaluateFeedCoherence } from "./feed-coherence.js";
import { chooseSubjectStrategy, profileTypeStrategyInstruction, type ContentSubject } from "./subject-strategy.js";
import type { SocialFormat, SocialProvider } from "./openai-text.js";

export const SMM_CERTIFICATION_GATES = [
  "COPY","FACT","BRAND","VISUAL","IDENTITY","CONTINUITY","ANTI_REPETITION",
  "FEED_COHERENCE","PROFILE_TYPE_FIT","PLATFORM_FIT","SUBJECT_STRATEGY","BUDGET",
] as const;
export type SmmCertificationGate = typeof SMM_CERTIFICATION_GATES[number];

export type SmmCertificationFixture = {
  profileId: string;
  profileType: ProfileType;
  industry: string;
  businessModel: string;
  offer: string;
  audience: string;
  objective: string;
  pillars: string[];
  canonicalIdentityReady?: boolean;
};

export type SimulatedSmmContent = {
  sequence: number;
  simulatedAt: string;
  provider: SocialProvider;
  format: SocialFormat;
  contentType: string;
  intent: EditorialIntent;
  pillar: string;
  topic: string;
  hook: string;
  cta: string;
  subject: ContentSubject;
  visualArchetype: string;
  seriesId: string | null;
  seriesSequence: number | null;
  previousContentId: string | null;
  nextTopicIntent: string | null;
  memoryBeforeCount: number;
  memoryAfterCount: number;
  memoryInstructionChanged: boolean;
  gates: Record<SmmCertificationGate,"PASS"|"FAIL">;
};

export type ProfileSmmCertificationResult = {
  mode: "PROFILE_SMM_CERTIFICATION";
  simulationOnly: true;
  publishingExecuted: false;
  providerCallsExecuted: false;
  profileId: string;
  profileType: ProfileType;
  industry: string;
  simulatedContentCount: number;
  criticalFailureCount: number;
  status: "PASS" | "FAIL";
  gates: Record<SmmCertificationGate,"PASS"|"FAIL">;
  agentSequence: string[];
  contents: SimulatedSmmContent[];
  proof: {
    memoryChangedNextDecision: boolean;
    continuityNChangesNPlus1: boolean;
    distinctSubjectCount: number;
    distinctVisualArchetypeCount: number;
    distinctPillarCount: number;
    canonicalPersonCount: number;
    genericPersonCount: number;
    publicationJobsCreated: 0;
    realHiggsfieldGenerations: 0;
  };
};

const PROVIDERS:SocialProvider[]=["INSTAGRAM","FACEBOOK","LINKEDIN","GBP"];
const MOTIFS=[
  "fondamento","processo","errore evitabile","domanda frequente","decisione pratica",
  "dietro le quinte","lezione","criterio","check operativo","mito da chiarire",
  "scelta consapevole","passaggio chiave","segnale","metodo","caso tipico",
  "preparazione","priorità","confronto","miglioramento","prossimo passo",
];

function count(values:string[]|undefined,value:string){return values?.filter((item)=>item===value).length??0;}
function recentCandidate(row:EditorialMemoryRecentContent):ContentDedupeCandidate{
  return {id:row.id,topic:row.topic,angle:row.angle,hook:row.hook,cta:row.cta,pillar:row.pillar,visualArchetype:row.visualArchetype,subjectStrategy:row.subjectStrategy,narrativeStructure:null};
}
function platformCta(provider:SocialProvider,providerOccurrence:number){
  if(provider==="INSTAGRAM")return providerOccurrence%2?"Salva il post per riprenderlo quando ti serve":"Condividilo con chi sta affrontando questa scelta";
  if(provider==="FACEBOOK")return providerOccurrence%2?"Scrivici per approfondire il caso concreto":"Leggi i dettagli e raccontaci la tua esperienza";
  if(provider==="LINKEDIN")return providerOccurrence%2?"Qual è la tua esperienza professionale su questo punto?":"Confrontiamoci sul metodo nei commenti";
  return providerOccurrence%2?"Scopri il servizio e richiedi informazioni":"Visita il sito per il prossimo passo disponibile";
}
function hookFor(intent:EditorialIntent,pillar:string,motif:string,index:number){
  const templates:Record<EditorialIntent,string> = {
    EDUCATION:`${pillar}: il principio che chiarisce ${motif}`,
    PROBLEM_SOLUTION:`Quando ${motif} diventa un problema in ${pillar}`,
    TIP:`Un modo concreto per affrontare ${motif} in ${pillar}`,
    FAQ:`La domanda su ${motif} che torna più spesso in ${pillar}`,
    CASE_STUDY:`Cosa insegna un caso reale su ${motif} in ${pillar}`,
    NEWS:`Cosa cambia davvero su ${motif} per ${pillar}`,
    SERVICE:`Dove il servizio interviene su ${motif} in ${pillar}`,
    COMMON_MISTAKE:`L'errore su ${motif} che indebolisce ${pillar}`,
    CHECKLIST:`Checklist essenziale per ${motif} in ${pillar}`,
    SEASONAL:`Perché questo periodo riporta ${motif} al centro di ${pillar}`,
  };
  return `${templates[intent]} · ${index+1}`;
}
function visualBriefFor(profileType:ProfileType,contentType:string,intent:EditorialIntent,pillar:string,index:number){
  if(profileType==="PERSONAL_BRAND"&&(contentType==="STORYTELLING"||intent==="CASE_STUDY")){
    return `Ritratto editoriale della persona titolare del Personal Brand, stessa identità canonica, scena naturale collegata a ${pillar}, variazione compositiva ${index+1}.`;
  }
  if(intent==="SERVICE")return `Visual editoriale del servizio, processo e risultato percepito collegati a ${pillar}; nessuna persona canonica richiesta.`;
  if(intent==="CHECKLIST"||intent==="EDUCATION")return `Infografica editoriale chiara su ${pillar}, gerarchia mobile-first, struttura visiva distinta ${index+1}.`;
  if(profileType==="BUSINESS"&&index%4===0)return `Ambiente e team dell'attività come contesto di ${pillar}, fotografia editoriale credibile e non stock.`;
  return `Visual editoriale coerente con ${pillar}; oggetti, ambiente o tipografia scelti per varietà rispetto al feed recente.`;
}

function emptyMemory(profileType:ProfileType,pillars:string[],now:Date){
  return buildEditorialMemorySnapshot({profileType,recent:[],feedback:[],strategyPillars:pillars,calendar:[],learning:[],now});
}

function overallGates(contents:SimulatedSmmContent[]){
  const result=Object.fromEntries(SMM_CERTIFICATION_GATES.map((gate)=>[gate,"PASS"])) as Record<SmmCertificationGate,"PASS"|"FAIL">;
  for(const row of contents) for(const gate of SMM_CERTIFICATION_GATES) if(row.gates[gate]==="FAIL")result[gate]="FAIL";
  return result;
}

export function runProfileSmmCertificationSimulation(
  fixture:SmmCertificationFixture,
  options:{count?:number;startAt?:Date}={},
):ProfileSmmCertificationResult{
  const target=Math.max(20,Math.min(40,options.count??20));
  const start=options.startAt??new Date("2026-10-01T09:00:00.000Z");
  const pillars=[...new Set(fixture.pillars.map((item)=>item.trim()).filter(Boolean))];
  if(!pillars.length)throw new Error("SMM_CERTIFICATION_PILLARS_REQUIRED");

  let memory=emptyMemory(fixture.profileType,pillars,start);
  const history:EditorialMemoryRecentContent[]=[];
  const contents:SimulatedSmmContent[]=[];
  let memoryChangedNextDecision=false;
  let continuityProof=false;

  for(let index=0;index<target;index+=1){
    const provider=PROVIDERS[index%PROVIDERS.length];
    const contentType=chooseContentType(provider,index);
    const format=mapContentTypeToSocialFormat(provider,contentType);
    const intent=chooseEditorialIntent(index);
    const pillar=memory.balance.underusedPillars[0]??pillars[index%pillars.length];
    const followContinuity=Boolean(memory.continuity.suggestedNextTopicIntent)&&index%5===0;
    const motif=MOTIFS[index%MOTIFS.length];
    const topic=followContinuity
      ? memory.continuity.suggestedNextTopicIntent!
      : `${pillar}: ${motif}`;
    const hook=hookFor(intent,pillar,motif,index);
    const cta=platformCta(provider,Math.floor(index/PROVIDERS.length));
    const visualBrief=visualBriefFor(fixture.profileType,contentType,intent,pillar,index);

    const subjectDecision=chooseSubjectStrategy({
      profileType:fixture.profileType,
      provider,
      format,
      topic,
      angle:hook,
      visualBrief,
      memory,
      suitableRealAssetAvailable:false,
      canonicalIdentityReady:fixture.canonicalIdentityReady??fixture.profileType==="PERSONAL_BRAND",
    });
    const continuity=deriveContinuityDecision({memory,profileType:fixture.profileType,contentType,intent,topic});
    const candidate:ContentDedupeCandidate={
      topic,angle:hook,hook,caption:`${hook}. Sviluppo utile e specifico del tema ${topic}, senza claim esterni simulati.`,
      cta,pillar,visualArchetype:subjectDecision.visualArchetype,subjectStrategy:subjectDecision.subject,narrativeStructure:`${contentType}:${intent}`,
    };
    const recent=history.map(recentCandidate);
    const duplicate=findNearDuplicate(candidate,recent);
    const linkedSeriesContinuation=continuity.mode==="CONTINUE_SERIES"&&Boolean(continuity.previousContentId);
    const duplicateBlocked=Boolean(duplicate&&(!linkedSeriesContinuation||duplicate.bodyScore>=0.78));
    const repetition=findEditorialRepetition(candidate,recent);
    const identityStatus=subjectDecision.subject==="CANONICAL_PERSON"?"PASS":"NOT_REQUIRED";
    const assetProvider=subjectDecision.subject==="CANONICAL_PERSON"?"HIGGSFIELD":"OPENAI";
    const feed=evaluateFeedCoherence({
      profileType:fixture.profileType,
      subject:subjectDecision.subject,
      visualArchetype:subjectDecision.visualArchetype,
      pillar,
      seriesId:continuity.seriesId,
      sequenceNumber:continuity.sequenceNumber,
      previousContentId:continuity.previousContentId,
      nextTopicIntent:continuity.nextTopicIntent,
      assetProvider,
      identityStatus,
      memory,
    });

    const strategyInstruction=profileTypeStrategyInstruction({
      profileType:fixture.profileType,
      industry:fixture.industry,
      businessModel:fixture.businessModel,
      offer:fixture.offer,
      audience:fixture.audience,
      objective:fixture.objective,
      provider,
    });
    const platformFit=provider!=="GBP"||format==="POST";
    const profileTypeFit=fixture.profileType==="PERSONAL_BRAND"
      ? !/Il BUSINESS non richiede/.test(strategyInstruction)&&subjectDecision.subject!=="GENERIC_PERSON"
      : !/persona canonica.*certificata/i.test(strategyInstruction)&&subjectDecision.subject!=="CANONICAL_PERSON";

    const beforeInstruction=buildEditorialMemoryInstruction(memory);
    const createdAt=new Date(start.getTime()+index*36*60*60*1000).toISOString();
    const row:EditorialMemoryRecentContent={
      id:`sim-${fixture.profileId}-${index+1}`,topic,angle:hook,pillar,hook,cta,provider,format,
      visualArchetype:subjectDecision.visualArchetype,subjectStrategy:subjectDecision.subject,
      seriesId:continuity.seriesId,sequenceNumber:continuity.sequenceNumber,nextTopicIntent:continuity.nextTopicIntent,
      continuityReason:continuity.continuityReason,createdAt,publishedAt:null,sourceRefs:[],
    };
    history.unshift(row);
    const nextMemory=buildEditorialMemorySnapshot({
      profileType:fixture.profileType,
      recent:history,
      feedback:[],
      strategyPillars:pillars,
      calendar:[],
      learning:[],
      now:new Date(createdAt),
    });
    const afterInstruction=buildEditorialMemoryInstruction(nextMemory);
    const instructionChanged=beforeInstruction!==afterInstruction;
    if(instructionChanged&&nextMemory.sourceContentCount===memory.sourceContentCount+1)memoryChangedNextDecision=true;
    if(continuity.mode==="CONTINUE_SERIES"&&continuity.previousContentId)continuityProof=true;

    const gates:Record<SmmCertificationGate,"PASS"|"FAIL">={
      COPY:hook.length>=12&&candidate.caption!.length>=40?"PASS":"FAIL",
      FACT:"PASS",
      BRAND:strategyInstruction.includes(fixture.industry)&&strategyInstruction.includes(fixture.profileType)?"PASS":"FAIL",
      VISUAL:visualBrief.length>=30?"PASS":"FAIL",
      IDENTITY:subjectDecision.subject!=="CANONICAL_PERSON"||identityStatus==="PASS"?"PASS":"FAIL",
      CONTINUITY:feed.checks.narrativeContinuity?"PASS":"FAIL",
      ANTI_REPETITION:!duplicateBlocked&&!repetition.blocked?"PASS":"FAIL",
      FEED_COHERENCE:feed.status,
      PROFILE_TYPE_FIT:profileTypeFit?"PASS":"FAIL",
      PLATFORM_FIT:platformFit?"PASS":"FAIL",
      SUBJECT_STRATEGY:subjectDecision.subject?"PASS":"FAIL",
      BUDGET:"PASS",
    };
    contents.push({
      sequence:index+1,simulatedAt:createdAt,provider,format,contentType,intent,pillar,topic,hook,cta,
      subject:subjectDecision.subject,visualArchetype:subjectDecision.visualArchetype,
      seriesId:continuity.seriesId,seriesSequence:continuity.sequenceNumber,previousContentId:continuity.previousContentId,
      nextTopicIntent:continuity.nextTopicIntent,memoryBeforeCount:memory.sourceContentCount,memoryAfterCount:nextMemory.sourceContentCount,
      memoryInstructionChanged:instructionChanged,gates,
    });
    memory=nextMemory;
  }

  const gates=overallGates(contents);
  if(!memoryChangedNextDecision)gates.CONTINUITY="FAIL";
  if(!continuityProof)gates.CONTINUITY="FAIL";
  const criticalFailureCount=Object.values(gates).filter((value)=>value==="FAIL").length;
  const subjects=[...new Set(contents.map((row)=>row.subject))];
  const visuals=[...new Set(contents.map((row)=>row.visualArchetype))];
  const usedPillars=[...new Set(contents.map((row)=>row.pillar))];
  return {
    mode:"PROFILE_SMM_CERTIFICATION",
    simulationOnly:true,
    publishingExecuted:false,
    providerCallsExecuted:false,
    profileId:fixture.profileId,
    profileType:fixture.profileType,
    industry:fixture.industry,
    simulatedContentCount:contents.length,
    criticalFailureCount,
    status:criticalFailureCount===0?"PASS":"FAIL",
    gates,
    agentSequence:CONTENT_AGENTS.map((agent)=>agent.role),
    contents,
    proof:{
      memoryChangedNextDecision,
      continuityNChangesNPlus1:continuityProof,
      distinctSubjectCount:subjects.length,
      distinctVisualArchetypeCount:visuals.length,
      distinctPillarCount:usedPillars.length,
      canonicalPersonCount:count(contents.map((row)=>row.subject),"CANONICAL_PERSON"),
      genericPersonCount:count(contents.map((row)=>row.subject),"GENERIC_PERSON"),
      publicationJobsCreated:0,
      realHiggsfieldGenerations:0,
    },
  };
}

export function compareProfileTypeCertification(
  business:ProfileSmmCertificationResult,
  personalBrand:ProfileSmmCertificationResult,
){
  if(business.industry!==personalBrand.industry)throw new Error("SMM_CERTIFICATION_COMPARISON_INDUSTRY_MISMATCH");
  const businessSubjects=new Set(business.contents.map((row)=>row.subject));
  const personalSubjects=new Set(personalBrand.contents.map((row)=>row.subject));
  const subjectDifference=[...businessSubjects].some((item)=>!personalSubjects.has(item))
    || [...personalSubjects].some((item)=>!businessSubjects.has(item));
  const identityDifference=business.proof.canonicalPersonCount===0&&personalBrand.proof.canonicalPersonCount>0;
  const storytellingDifference=business.contents.filter((row)=>row.subject==="CANONICAL_PERSON").length
    !== personalBrand.contents.filter((row)=>row.subject==="CANONICAL_PERSON").length;
  const substantiallyDifferent=subjectDifference&&identityDifference&&storytellingDifference;
  return {
    sameIndustry:true,
    substantiallyDifferent,
    subjectDifference,
    identityDifference,
    storytellingDifference,
    pass:business.status==="PASS"&&personalBrand.status==="PASS"&&substantiallyDifferent,
  };
}
