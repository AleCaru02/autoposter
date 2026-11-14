export type CompetitorCandidate = { name: string; website: string; positioning: string; editorialOpportunity: string };
export type VerifiedCompetitor = CompetitorCandidate & { verifiedSource: string };
export type CompetitorEvidence = {
  status: "VERIFIED_PUBLIC_SOURCES" | "NO_VERIFIED_SOURCES" | "NOT_SEARCHED";
  competitors: VerifiedCompetitor[];
  sourceCount: number;
};

/** Public website research only. Never claim social insights or competitor
 * performance metrics without an authorized platform API. Exclude unsupported
 * model assertions unless the search provider actually returned that site.
 */
export function verifyCompetitorResearch(input: {
  candidates: unknown; providerSources: string[]; ownWebsite: string | null;
  searched: boolean;
}): CompetitorEvidence {
  if (!input.searched) return { status: "NOT_SEARCHED", competitors: [], sourceCount: 0 };
  function host(value: string | null | undefined) {
    if(!value)return null;
    try {
      const url=new URL(value);
      if(url.protocol!=="https:"&&url.protocol!=="http:")return null;
      return url.hostname.toLowerCase().replace(/^www\./,"");
    } catch {return null;}
  }
  const ownHost=host(input.ownWebsite);
  const sources=input.providerSources.filter(s=>Boolean(host(s)));
  const found=new Set<string>();
  const competitors: VerifiedCompetitor[]=[];
  for(const item of Array.isArray(input.candidates)?input.candidates:[]) {
    if(!item||typeof item!=="object")continue;
    const candidate=item as Record<string,unknown>;
    const name=typeof candidate.name==="string"?candidate.name.trim().slice(0,140):"";
    const website=typeof candidate.website==="string"?candidate.website.trim():"";
    const candidateHost=host(website);
    if(!name||!candidateHost||candidateHost===ownHost||found.has(candidateHost))continue;
    const source=sources.find(s=>host(s)===candidateHost);
    if(!source)continue;
    found.add(candidateHost);
    competitors.push({
      name, website, positioning:typeof candidate.positioning==="string"?candidate.positioning.trim().slice(0,280):"",
      editorialOpportunity:typeof candidate.editorialOpportunity==="string"?candidate.editorialOpportunity.trim().slice(0,280):"",
      verifiedSource:source,
    });
    if(competitors.length>=4)break;
  }
  return {
    status:competitors.length?"VERIFIED_PUBLIC_SOURCES":"NO_VERIFIED_SOURCES",
    competitors,
    sourceCount:sources.length,
  };
}
