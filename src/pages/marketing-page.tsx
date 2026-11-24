import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { authenticatedApiToken } from "../lib/auth-token";
import { useProfiles, type Profile } from "../features/profiles/profile-context";
import { buildMarketingBrief, marketingChannels, marketingLabels, type MarketingChannel } from "../features/marketing/marketing-brief";
import "../marketing.css";
type HistoryEntry={id:string;createdAt:string;channel:MarketingChannel;draft:string;estimatedCostUsd:number|null};
function Workspace({profile}: {profile: Profile}) {
  const [channel,setChannel] = useState<MarketingChannel>("META_ADS");
  const [objective,setObjective] = useState("");
  const [audience,setAudience] = useState("");
  const [offer,setOffer] = useState("");
  const [evidence,setEvidence] = useState("");
  const [budget,setBudget] = useState("");
  const [brief,setBrief] = useState("");
  const [status,setStatus] = useState("");
  const [aiDraft,setAiDraft]=useState("");
  const [generating,setGenerating]=useState(false);
  const [operation,setOperation]=useState("");
  const [history,setHistory]=useState<HistoryEntry[]>([]);
  const [historyError,setHistoryError]=useState(false);
  const [historyVersion,setHistoryVersion]=useState(0);
  const [historyLoading,setHistoryLoading]=useState(true);
  useEffect(()=>{
    const controller=new AbortController();
    setHistoryLoading(true);setHistoryError(false);
    void (async()=>{
      try{
        const token=await authenticatedApiToken();
        if(controller.signal.aborted)return;
        const response=await fetch("/api/marketing-draft?profileId="+encodeURIComponent(profile.id),{headers:{authorization:"Bearer "+token},cache:"no-store",signal:controller.signal});
        const data=await response.json() as {drafts?:HistoryEntry[]};
        if(!response.ok||!Array.isArray(data.drafts))throw new Error("history unavailable");
        if(!controller.signal.aborted)setHistory(data.drafts);
      }catch{if(!controller.signal.aborted)setHistoryError(true);}
      finally{if(!controller.signal.aborted)setHistoryLoading(false);}
    })();
    return ()=>controller.abort();
  },[profile.id,historyVersion]);
  function invalidate() { setBrief(""); setStatus(""); setAiDraft(""); setOperation(""); }
  function create() {
    setBrief(""); setStatus("");
    try { setBrief(buildMarketingBrief({channel,brand:profile.name,industry:profile.industry,website:profile.website_url,objective,audience,offer,evidence,budgetEur:budget})); }
    catch (e) { setStatus(e instanceof Error ? e.message : "Brief non disponibile."); }
  }
  async function generate() {
    if(generating||!brief)return;
    const id=operation||"marketing:"+crypto.randomUUID();
    setOperation(id);setGenerating(true);setStatus("");setAiDraft("");
    try {
      const token=await authenticatedApiToken();
      const response=await fetch("/api/marketing-draft",{method:"POST",headers:{authorization:"Bearer "+token,"content-type":"application/json","x-post-automatici-operation-id":id},body:JSON.stringify({profileId:profile.id,channel,objective,audience,offer,evidence,budgetEur:budget})});
      const result=await response.json() as {draft?:string;error?:string};
      if(!response.ok||!result.draft)throw new Error(result.error||"MARKETING_GENERATION_FAILED");
      setAiDraft(result.draft);setHistoryVersion(v=>v+1);setStatus("Bozza AI pronta. Verifica fatti e fonti prima di utilizzarla.");
    }catch(e){setStatus("Generazione non completata: "+(e instanceof Error?e.message:"errore"));}
    finally{setGenerating(false);}
  }
  async function copy() {
    try { await navigator.clipboard.writeText(aiDraft||brief); setStatus("Brief copiato."); }
    catch { setStatus("Seleziona e copia il testo manualmente."); }
  }
  return <section className="marketing-workspace">
    <header><p className="marketing-kicker">WORKSPACE MARKETING</p><h1>Strategia multicanale</h1><p>{profile.name} · Prepara brief di campagna senza pubblicare, inviare email o spendere denaro.</p></header>
    <p className="marketing-note">Prepara il brief gratuitamente. La generazione AI è facoltativa e usa la quota testo e il budget del profilo. Non attiva campagne, invii o pubblicazioni. Il risultato è una bozza da verificare.</p>
    <div className="marketing-channel" aria-label="Canale marketing">{marketingChannels.map(c=><button type="button" key={c} disabled={generating} aria-pressed={channel===c} onClick={()=>{setChannel(c);invalidate();}}>{marketingLabels[c]}</button>)}</div>
    <form className="marketing-form" onSubmit={e=>{e.preventDefault();create();}}><fieldset disabled={generating} style={{display:"grid",gap:14,border:0,padding:0,minWidth:0}}>
      <label>Obiettivo<input required maxLength={300} value={objective} onChange={e=>{setObjective(e.target.value);invalidate();}} placeholder="Es. richieste di preventivo"/></label>
      <label>Pubblico<input required maxLength={500} value={audience} onChange={e=>{setAudience(e.target.value);invalidate();}} placeholder="A chi si rivolge la campagna?"/></label>
      <label>Offerta e messaggio<textarea required maxLength={1000} value={offer} onChange={e=>{setOffer(e.target.value);invalidate();}} rows={3}/></label>
      <label>Prove e fonti (facoltative)<textarea maxLength={1600} value={evidence} onChange={e=>{setEvidence(e.target.value);invalidate();}} rows={3}/></label>
      {channel==="META_ADS"&&<label>Budget totale proposto (€)<input required inputMode="decimal" value={budget} onChange={e=>{setBudget(e.target.value);invalidate();}} placeholder="100"/></label>}
      <button type="submit" className="primary-button">Prepara brief</button></fieldset>
    </form>
    {brief&&<section><h2>Brief pronto per la revisione</h2><textarea className="marketing-output" aria-label="Brief marketing" readOnly value={brief} rows={15}/><button type="button" className="primary-button" onClick={()=>void copy()}>Copia {aiDraft?"bozza AI":"brief"}</button> <button type="button" className="primary-button" disabled={generating||!!aiDraft} onClick={()=>void generate()}>{generating?"Generazione in corso…":"Genera bozza con AI (usa quota)"}</button>{aiDraft&&<><h2>Bozza AI da revisionare</h2><textarea className="marketing-output" readOnly aria-label="Bozza AI" value={aiDraft} rows={18}/></>}</section>}
    <section aria-label="Archivio bozze marketing"><h2>Archivio bozze AI</h2><p>Ultime 30 bozze completate di questa attività. Rileggile senza usare altri crediti.</p>
      {historyLoading?<p>Caricamento archivio…</p>:historyError?<p role="alert">Archivio temporaneamente non disponibile. <button type="button" onClick={()=>setHistoryVersion(v=>v+1)}>Riprova</button></p>:history.length===0?<p>Nessuna bozza AI salvata.</p>:history.map(item=><details key={item.id}><summary>{marketingLabels[item.channel]} · {new Date(item.createdAt).toLocaleString("it-IT")}</summary><textarea className="marketing-output" readOnly aria-label="Bozza archiviata" rows={12} value={item.draft}/><button type="button" className="primary-button" onClick={()=>void navigator.clipboard.writeText(item.draft).then(()=>setStatus("Bozza copiata.")).catch(()=>setStatus("Copia manualmente la bozza."))}>Copia bozza</button>{item.estimatedCostUsd!==null&&<p>Costo AI stimato: {item.estimatedCostUsd.toFixed(4)} USD</p>}</details>)}
    </section>
    <p role="status" aria-live="polite">{status}</p>
    <p>Per i contenuti social usa il <NavLink to="/app/contenuti">piano editoriale AI esistente</NavLink>. I risultati reali sono nella sezione <NavLink to="/app/analytics">Analytics</NavLink>.</p>
  </section>;
}
export function MarketingPage() {
  const {selectedProfile}=useProfiles();
  return selectedProfile ? <Workspace key={selectedProfile.id} profile={selectedProfile}/> : <p>Seleziona un'attività.</p>;
}
