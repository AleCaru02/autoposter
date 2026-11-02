/** Adaptive editorial mix: deterministic guardrails for the future autonomous scheduler.
 * No AI calls, publishing, or spending occur in this module.
 */
export type Format = "REEL" | "POST" | "CAROUSEL";
export type Performance = { format: Format; qualifiedLeads: number; published: number; attributedRevenueEur?: number };
export type EditorialDecision = { mix: Record<Format,number>; total: number; rationale: string[]; requiresApproval: boolean };
const formats: Format[]=["REEL","POST","CAROUSEL"];
export function decideEditorialMix(input:{
  monthlyBudgetEur:number;
  unitCostEur:Record<Format,number>;
  maxPublications:number;
  minimumPublications?:number;
  history?:Performance[];
  autopublishAuthorized?:boolean;
}):EditorialDecision {
  const {monthlyBudgetEur,unitCostEur,maxPublications}=input;
  if(!Number.isFinite(monthlyBudgetEur)||monthlyBudgetEur<0||!Number.isInteger(maxPublications)||maxPublications<0||maxPublications>90||
    formats.some(f=>!Number.isFinite(unitCostEur[f])||unitCostEur[f]<0.01)) throw new Error("INVALID_EDITORIAL_LIMITS");
  const minimum=input.minimumPublications??0;
  if(!Number.isInteger(minimum)||minimum<0||minimum>maxPublications)throw new Error("INVALID_MINIMUM");
  const mix:Record<Format,number>={REEL:0,POST:0,CAROUSEL:0};
  const history=input.history??[];
  if(history.some(h=>!formats.includes(h.format)||!Number.isInteger(h.qualifiedLeads)||h.qualifiedLeads<0||!Number.isInteger(h.published)||h.published<0))
    throw new Error("INVALID_PERFORMANCE_DATA");
  const published=history.reduce((sum,h)=>sum+h.published,0);
  const enoughEvidence=published>=20;
  const totals=Object.fromEntries(formats.map(f=>[f,{leads:history.filter(h=>h.format===f).reduce((s,h)=>s+h.qualifiedLeads,0),count:history.filter(h=>h.format===f).reduce((s,h)=>s+h.published,0)}])) as Record<Format,{leads:number;count:number}>;
  const weights:Record<Format,number>={REEL:0.4,POST:0.3,CAROUSEL:0.3};
  if(enoughEvidence){
    const scores=formats.map(f=>({f,score:(totals[f].leads+1)/(totals[f].count+5)}));
    const sum=scores.reduce((s,x)=>s+x.score,0);
    for(const {f,score} of scores) weights[f]=0.15+0.55*score/sum;
  }
  let remaining=monthlyBudgetEur;
  for(let i=0;i<maxPublications;i++){
    const candidates=formats.filter(f=>remaining+1e-8>=unitCostEur[f]);
    if(!candidates.length)break;
    candidates.sort((a,b)=>(weights[b]/(mix[b]+1)/unitCostEur[b])-(weights[a]/(mix[a]+1)/unitCostEur[a]));
    const chosen=candidates[0];mix[chosen]++;remaining-=unitCostEur[chosen];
  }
  const total=formats.reduce((s,f)=>s+mix[f],0);
  return {mix,total,rationale:[
    enoughEvidence?"Mix orientato ai lead qualificati osservati, con esplorazione minima per formato":"Dati insufficienti: distribuzione prudente, senza attribuire conversioni inventate",
    total<minimum?"Budget insufficiente per il volume minimo richiesto":"Volume entro il budget",
    "La pubblicazione richiede controlli di qualità, licenze e autorizzazione separati"
  ],requiresApproval:!input.autopublishAuthorized};
}
