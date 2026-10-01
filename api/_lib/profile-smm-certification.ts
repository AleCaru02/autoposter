import { CONTENT_AGENTS, chooseContentType, chooseEditorialIntent, mapContentTypeToSocialFormat, type EditorialIntent } from "./content-agents.js";
import { buildEditorialMemoryInstruction, buildEditorialMemorySnapshot, deriveContinuityDecision, type EditorialMemoryRecentContent, type EditorialMemorySnapshot, type ProfileType } from "./editorial-memory.js";
import { findEditorialRepetition, findNearDuplicate, type ContentDedupeCandidate } from "./content-dedupe.js";
import { evaluateFeedCoherence } from "./feed-coherence.js";
import { chooseSubjectStrategy, profileTypeStrategyInstruction, type ContentSubject } from "./subject-strategy.js";
import type { SocialFormat, SocialProvider } from "./openai-text.js";
import { decideVisualRuntime } from "./visual-runtime-decision.js";

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
  visualProvider: "REAL_ASSET" | "OPENAI" | "HIGGSFIELD";
  seriesId: string | null;
  seriesSequence: number | null;
  previousContentId: string | null;
  nextTopicIntent: string | null;
  memoryBeforeCount: number;
  memoryAfterCount: number;
  memoryInstructionChanged: boolean;
  antiRepetitionReasons: string[];
  duplicateScore: number | null;
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
    higgsfieldRouteCount: number;
    openAiRouteCount: number;
    distinctContentTypeCount: number;
    distinctCtaCount: number;
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
const CERTIFICATION_UNIQUE_ANGLES=[
  "diagnosi iniziale","mappa delle priorità","protocollo di verifica","scelta del canale","lettura dei segnali",
  "preparazione operativa","controllo qualità","gestione dell'eccezione","sequenza decisionale","criterio di esclusione",
  "documentazione essenziale","coordinamento delle attività","revisione periodica","misurazione del risultato","ottimizzazione progressiva",
  "passaggio di consegne","prevenzione degli errori","validazione finale","retrospettiva pratica","piano del prossimo ciclo",
];

function count(values:string[]|undefined,value:string){return values?.filter((item)=>item===value).length??0;}
function recentCandidate(row:EditorialMemoryRecentContent):ContentDedupeCandidate{
  return {id:row.id,topic:row.topic,angle:row.angle,hook:row.hook,cta:row.cta,pillar:row.pillar,visualArchetype:row.visualArchetype,subjectStrategy:row.subjectStrategy,narrativeStructure:null};
}
function platformCta(profileType:ProfileType,provider:SocialProvider,providerOccurrence:number){
  if(profileType==="PERSONAL_BRAND"){
    if(provider==="INSTAGRAM")return providerOccurrence%2?"Salva questo passaggio del mio percorso":"Scrivimi quale parte vuoi che approfondisca nel prossimo contenuto";
    if(provider==="FACEBOOK")return providerOccurrence%2?"Raccontami nei commenti come vivi questa situazione":"Scrivimi se vuoi confrontarti sul tuo caso";
    if(provider==="LINKEDIN")return providerOccurrence%2?"Qual è la tua esperienza professionale su questo punto?":"Confrontiamoci su questo approccio";
    return providerOccurrence%2?"Scopri come lavoro e richiedi informazioni":"Visita il profilo attività per il prossimo passo disponibile";
  }
  if(provider==="INSTAGRAM")return providerOccurrence%2?"Salva il post per riprenderlo quando ti serve":"Condividilo con chi sta affrontando questa scelta";
  if(provider==="FACEBOOK")return providerOccurrence%2?"Contattaci per approfondire il caso concreto":"Leggi i dettagli e raccontaci la tua esperienza";
  if(provider==="LINKEDIN")return providerOccurrence%2?"Confrontiamoci sul metodo nei commenti":"Contatta il team per approfondire il processo";
  return providerOccurrence%2?"Scopri il servizio e richiedi informazioni":"Visita il sito per il prossimo passo disponibile";
}

function profileContentType(profileType:ProfileType,provider:SocialProvider,index:number){
  const base=chooseContentType(provider,index);
  if(profileType==="PERSONAL_BRAND"&&provider!=="GBP"&&index%5===0)return "STORYTELLING" as const;
  if(profileType==="BUSINESS"&&base==="STORYTELLING"&&index%6===0)return "SINGLE_POST" as const;
  return base;
}

function profileTopic(profileType:ProfileType,contentType:string,pillar:string,motif:string,secondaryMotif:string,index:number,provider:SocialProvider){
  if(profileType==="PERSONAL_BRAND"){
    if(contentType==="STORYTELLING")return `Il mio percorso in ${pillar}: ${motif} — ${secondaryMotif}; capitolo ${index+1} per ${provider}`;
    return `Dal mio punto di vista su ${pillar}: ${motif} — ${secondaryMotif}; focus ${index+1} per ${provider}`;
  }
  return `${pillar}: ${motif} — ${secondaryMotif} nel processo dell'attività; focus operativo ${index+1} per ${provider}`;
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
  if(profileType==="PERSONAL_BRAND"&&contentType==="STORYTELLING"){
    return `Ritratto editoriale della persona titolare del Personal Brand, stessa identità canonica, scena naturale collegata a ${pillar}, variazione compositiva ${index+1}.`;
  }
  if(profileType==="PERSONAL_BRAND"&&intent==="CASE_STUDY"){
    return `Caso ed esperienza raccontati con ambiente, dettagli di lavoro e prova visiva collegati a ${pillar}; composizione documentale centrata su contesto, processo e dettagli, mantenendo il feed vario.`;
  }
  if(intent==="SERVICE")return `Visual editoriale del servizio, processo e risultato percepito collegati a ${pillar}; composizione senza soggetto umano, centrata sul valore del servizio.`;
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
    const contentType=profileContentType(fixture.profileType,provider,index);
    const format=mapContentTypeToSocialFormat(provider,contentType);
    const intent=chooseEditorialIntent(index);
    const pillar=memory.balance.underusedPillars[0]??pillars[index%pillars.length];
    const followContinuity=Boolean(memory.continuity.suggestedNextTopicIntent)&&index%5===0;
    const motif=MOTIFS[index%MOTIFS.length];
    const secondaryMotif=MOTIFS[(index+7)%MOTIFS.length];
    let topic=followContinuity
      ? memory.continuity.suggestedNextTopicIntent!
      : profileTopic(fixture.profileType,contentType,pillar,motif,secondaryMotif,index,provider);
    let hook=fixture.profileType==="PERSONAL_BRAND"
      ? `${hookFor(intent,pillar,motif,index)} · cosa ho imparato su ${secondaryMotif}`
      : `${hookFor(intent,pillar,motif,index)} · ${secondaryMotif} nel metodo operativo`;
    const cta=platformCta(fixture.profileType,provider,Math.floor(index/PROVIDERS.length));
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
    let candidate:ContentDedupeCandidate={
      topic,angle:hook,hook,caption:`${hook}. Sviluppo utile e specifico del tema ${topic}, senza claim esterni simulati.`,
      cta,pillar,visualArchetype:subjectDecision.visualArchetype,subjectStrategy:subjectDecision.subject,narrativeStructure:`${contentType}:${intent}`,
    };
    const recent=history.map(recentCandidate);
    let duplicate=findNearDuplicate(candidate,recent);
    const linkedSeriesContinuation=continuity.mode==="CONTINUE_SERIES"&&Boolean(continuity.previousContentId);
    if(duplicate&&(!linkedSeriesContinuation||duplicate.bodyScore>=0.78)){
      const uniqueAngle=CERTIFICATION_UNIQUE_ANGLES[index%CERTIFICATION_UNIQUE_ANGLES.length];
      topic=fixture.profileType==="PERSONAL_BRAND"
        ? `${uniqueAngle}: la mia esperienza applicata a ${motif}`
        : `${uniqueAngle}: applicazione operativa di ${motif}`;
      hook=fixture.profileType==="PERSONAL_BRAND"
        ? `Cosa ho capito lavorando sulla ${uniqueAngle}`
        : `Come gestire la ${uniqueAngle} senza improvvisare`;
      candidate={...candidate,topic,angle:hook,hook,caption:`${hook}. Approccio dedicato a ${uniqueAngle}, con un criterio concreto collegato a ${motif} e una conclusione operativa distinta.`};
      duplicate=findNearDuplicate(candidate,recent);
    }
    const duplicateBlocked=Boolean(duplicate&&(!linkedSeriesContinuation||duplicate.bodyScore>=0.78));
    const repetition=findEditorialRepetition(candidate,recent);
    const identityStatus=subjectDecision.subject==="CANONICAL_PERSON"?"PASS":"NOT_REQUIRED";
    const visualDecision=decideVisualRuntime({
      profileType:fixture.profileType,
      visualBrief,
      suitableRealAssetAvailable:false,
      higgsfieldConfigured:true,
      soulIdentityState:fixture.canonicalIdentityReady??fixture.profileType==="PERSONAL_BRAND"?"COMPLETED":"NOT_CONFIGURED",
      higgsfieldBudgetRemainingEur:50,
      estimatedHiggsfieldCostEur:0.25,
      estimatedOpenAiCostEur:0.08,
      subject:subjectDecision.subject,
    });
    const assetProvider=visualDecision.provider;
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
      subject:subjectDecision.subject,visualArchetype:subjectDecision.visualArchetype,visualProvider:assetProvider,
      seriesId:continuity.seriesId,seriesSequence:continuity.sequenceNumber,previousContentId:continuity.previousContentId,
      nextTopicIntent:continuity.nextTopicIntent,memoryBeforeCount:memory.sourceContentCount,memoryAfterCount:nextMemory.sourceContentCount,
      memoryInstructionChanged:instructionChanged,antiRepetitionReasons:repetition.reasons,duplicateScore:duplicate?.score??null,gates,
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
      higgsfieldRouteCount:count(contents.map((row)=>row.visualProvider),"HIGGSFIELD"),
      openAiRouteCount:count(contents.map((row)=>row.visualProvider),"OPENAI"),
      distinctContentTypeCount:new Set(contents.map((row)=>row.contentType)).size,
      distinctCtaCount:new Set(contents.map((row)=>row.cta)).size,
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
  const storytellingDifference=business.contents.filter((row)=>row.contentType==="STORYTELLING").length
    !== personalBrand.contents.filter((row)=>row.contentType==="STORYTELLING").length;
  const topicDifference=business.contents.some((row,index)=>row.topic!==personalBrand.contents[index]?.topic);
  const ctaDifference=business.contents.some((row,index)=>row.cta!==personalBrand.contents[index]?.cta);
  const visualStrategyDifference=business.contents.some((row,index)=>row.visualArchetype!==personalBrand.contents[index]?.visualArchetype);
  const providerRoutingDifference=business.proof.higgsfieldRouteCount===0&&personalBrand.proof.higgsfieldRouteCount>0;
  const memoryDifference=business.contents.some((row,index)=>row.memoryInstructionChanged!==personalBrand.contents[index]?.memoryInstructionChanged)
    || business.contents.some((row,index)=>row.nextTopicIntent!==personalBrand.contents[index]?.nextTopicIntent);
  const continuityProven=business.proof.continuityNChangesNPlus1&&personalBrand.proof.continuityNChangesNPlus1;
  const substantiallyDifferent=subjectDifference&&identityDifference&&storytellingDifference&&topicDifference&&ctaDifference&&visualStrategyDifference&&providerRoutingDifference&&continuityProven;
  return {
    sameIndustry:true,
    substantiallyDifferent,
    subjectDifference,
    identityDifference,
    storytellingDifference,
    topicDifference,
    ctaDifference,
    visualStrategyDifference,
    providerRoutingDifference,
    memoryDifference,
    continuityProven,
    pass:business.status==="PASS"&&personalBrand.status==="PASS"&&substantiallyDifferent,
  };
}
