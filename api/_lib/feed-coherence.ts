import type { EditorialMemorySnapshot, ProfileType } from "./editorial-memory.js";
import type { ContentSubject } from "./subject-strategy.js";

export type FeedCoherenceStatus = "PASS" | "FAIL";

export type FeedCoherenceResult = {
  status: FeedCoherenceStatus;
  reasons: string[];
  checks: {
    profileTypeFit: boolean;
    subjectFit: boolean;
    narrativeContinuity: boolean;
    editorialVariety: boolean;
    visualVariety: boolean;
    canonicalIdentity: boolean;
  };
};

function memoryCount(rows: Array<{ value: string; count: number }> | undefined, value: string | null | undefined) {
  if (!value) return 0;
  return rows?.find((row) => row.value === value)?.count ?? 0;
}

export function evaluateFeedCoherence(input: {
  profileType: ProfileType;
  subject: ContentSubject | null;
  visualArchetype: string | null;
  pillar: string | null;
  seriesId: string | null;
  sequenceNumber: number | null;
  previousContentId: string | null;
  nextTopicIntent: string | null;
  assetProvider: "REAL_ASSET" | "OPENAI" | "HIGGSFIELD" | null;
  identityStatus: "NOT_REQUIRED" | "PENDING" | "PASS" | "BLOCK" | null;
  memory: EditorialMemorySnapshot | null;
}): FeedCoherenceResult {
  const reasons:string[]=[];
  const subject=input.subject;
  const subjectRecent=memoryCount(input.memory?.recent.subjects,subject);
  const visualRecent=memoryCount(input.memory?.recent.visualArchetypes,input.visualArchetype);
  const pillarRecent=memoryCount(input.memory?.recent.pillars,input.pillar);

  const profileTypeFit=input.profileType==="PERSONAL_BRAND"
    ? subject!=="GENERIC_PERSON"
    : subject!=="CANONICAL_PERSON";
  if(!profileTypeFit) reasons.push(input.profileType==="PERSONAL_BRAND"?"PERSONAL_BRAND_GENERIC_PERSON_NOT_ALLOWED":"BUSINESS_CANONICAL_PERSON_NOT_ALLOWED");

  const subjectFit=subject!==null;
  if(!subjectFit) reasons.push("SUBJECT_STRATEGY_MISSING");

  let canonicalIdentity=true;
  if(input.profileType==="PERSONAL_BRAND"&&subject==="CANONICAL_PERSON"){
    canonicalIdentity=input.assetProvider==="REAL_ASSET"||input.identityStatus==="PASS";
    if(!canonicalIdentity) reasons.push("CANONICAL_PERSON_IDENTITY_NOT_CERTIFIED");
  }

  let narrativeContinuity=true;
  if(input.seriesId){
    narrativeContinuity=Boolean(input.sequenceNumber&&input.sequenceNumber>=1)
      && (input.sequenceNumber===1||Boolean(input.previousContentId));
    if(!narrativeContinuity) reasons.push("SERIES_CONTINUITY_BROKEN");
  }else if(input.sequenceNumber||input.previousContentId||input.nextTopicIntent){
    narrativeContinuity=false;
    reasons.push("ORPHAN_CONTINUITY_METADATA");
  }

  const editorialVariety=!(pillarRecent>=6||subjectRecent>=5);
  if(pillarRecent>=6) reasons.push("PILLAR_FEED_SATURATION");
  if(subjectRecent>=5) reasons.push("SUBJECT_FEED_SATURATION");

  const visualVariety=visualRecent<4;
  if(!visualVariety) reasons.push("VISUAL_ARCHETYPE_SATURATION");

  return {
    status:reasons.length?"FAIL":"PASS",
    reasons,
    checks:{profileTypeFit,subjectFit,narrativeContinuity,editorialVariety,visualVariety,canonicalIdentity},
  };
}
