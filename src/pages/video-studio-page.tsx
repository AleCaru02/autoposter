import { useEffect, useMemo, useState } from "react";
import { decideEditorialMix } from "../../api/_lib/adaptive-editorial-mix";
import { Link } from "react-router-dom";
import { authenticatedApiToken } from "../lib/auth-token";
import { useProfiles } from "../features/profiles/profile-context";
import { buildPersonalEditorialCalendar } from "../../api/_lib/video-editorial-calendar";
import { buildVideoPlan, validateVideoForReview } from "../../api/_lib/video-studio";
import { saveVideoDraft, loadVideoDrafts, type SavedVideoDraft } from "../features/video-studio/video-drafts";

export function VideoStudioPage() {
  const { selectedProfileId } = useProfiles();
  const [planningBudget,setPlanningBudget] = useState(30);
  const editorialPreview=useMemo(()=>decideEditorialMix({monthlyBudgetEur:planningBudget,unitCostEur:{REEL:8,POST:0.5,CAROUSEL:1.5},maxPublications:30}),[planningBudget]);
  const [topic,setTopic] = useState("Il tuo sito web porta davvero nuovi clienti?");
  const [problem,setProblem] = useState("Un sito poco chiaro può far perdere richieste di contatto.");
  const [solution,setSolution] = useState("Una pagina semplice, veloce e con una CTA evidente aiuta le persone a contattarti.");
  const [cta,setCta] = useState("Richiedi una bozza gratuita");
  const [planJson,setPlanJson] = useState("");
  const [error,setError] = useState("");
  const [drafts,setDrafts] = useState<SavedVideoDraft[]>([]);
  const [saving,setSaving] = useState(false);
  const [checking,setChecking] = useState(false);
  const [productionStatus,setProductionStatus] = useState("");
  const [renderInstructions,setRenderInstructions] = useState(false);
  const [jobId,setJobId] = useState("");
  const [submitting,setSubmitting] = useState(false);
  const [uploadStatus,setUploadStatus] = useState("");
  const [uploading,setUploading] = useState(false);
  async function uploadScene(sceneId:string,file:File|null){
    if(!file||!jobId||!selectedProfileId)return;
    setUploading(true);
    try{
      if(file.type!=="image/png"||file.size>8*1024*1024)throw new Error("Serve un PNG fino a 8 MB");
      const token=await authenticatedApiToken();
      const url=`/api/video-studio/media/${selectedProfileId}/${jobId}/${sceneId}.png`;
      const response=await fetch(url,{method:"PUT",headers:{authorization:"Bearer "+token,"content-type":"image/png"},body:file});
      const result=await response.json() as {error?:string};
      if(!response.ok)throw new Error(result.error||"Caricamento fallito");
      setUploadStatus(sceneId+" caricata");
    }catch(e){setUploadStatus(e instanceof Error?e.message:String(e));}
    finally{setUploading(false);}
  }
  const [jobStatus,setJobStatus] = useState("");
  const [previewUrl,setPreviewUrl] = useState("");
  useEffect(()=>()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);},[previewUrl]);
  async function submitCloudJob(){
    if(!planJson)return;
    setSubmitting(true);
    try{
      const token=await authenticatedApiToken();
      const response=await fetch("/api/video-studio/jobs/create",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},body:JSON.stringify({plan:JSON.parse(planJson),idempotencyKey:crypto.randomUUID()})});
      const result=await response.json() as {jobId?:string;error?:string;state?:string};
      if(!response.ok||!result.jobId)throw new Error(result.error||"Impossibile creare il lavoro");
      setJobId(result.jobId);setJobStatus(result.state||"QUEUED");
    }catch(e){setJobStatus(e instanceof Error?e.message:String(e));}
    finally{setSubmitting(false);}
  }
  async function loadJobStatus(){
    if(!selectedProfileId||!jobId.trim())return;
    try{
      const token=await authenticatedApiToken();
      const params=new URLSearchParams({profileId:selectedProfileId,jobId:jobId.trim()});
      const response=await fetch("/api/video-studio/jobs/status?"+params,{headers:{authorization:"Bearer "+token}});
      const result=await response.json() as {error?:string;job?:{state:string;errorCode?:string;previewPath?:string}};
      if(!response.ok||!result.job)throw new Error(result.error||"Lavoro non trovato");
      setJobStatus(result.job.state+(result.job.errorCode?" · "+result.job.errorCode:""));
      if(result.job.previewPath){
        const media=await fetch(result.job.previewPath,{headers:{authorization:"Bearer "+token}});
        if(!media.ok)throw new Error("Anteprima non disponibile");
        setPreviewUrl(URL.createObjectURL(await media.blob()));
      }else setPreviewUrl("");
    }catch(e){setJobStatus(e instanceof Error?e.message:String(e));setPreviewUrl("");}
  }
  useEffect(()=>{let active=true;setDrafts([]);if(selectedProfileId) void loadVideoDrafts(selectedProfileId).then(rows=>{if(active)setDrafts(rows);}).catch(()=>{if(active)setError("Impossibile caricare le bozze.");});return ()=>{active=false;};},[selectedProfileId]);
  async function persistDraft(){if(!planJson||!selectedProfileId)return;setSaving(true);try{const plan=JSON.parse(planJson);if(plan.profileId!==selectedProfileId)throw new Error("Profilo non valido");await saveVideoDraft(plan);setDrafts(await loadVideoDrafts(selectedProfileId));setError("");}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setSaving(false);}}
  const calendar=useMemo(()=>selectedProfileId?buildPersonalEditorialCalendar(selectedProfileId):null,[selectedProfileId]);
  function generate() {
    try {
      if(!selectedProfileId) throw new Error("Seleziona prima un'attività.");
      const plan=buildVideoPlan({profileId:selectedProfileId,topic,problem,solution,callToAction:cta,cloudEstimateEur:1.5});
      const issues=validateVideoForReview(plan,{},0);
      if(issues.length) throw new Error(issues.join(", "));
      setPlanJson(JSON.stringify(plan,null,2));setError("");
    } catch(e) {setError(e instanceof Error?e.message:String(e));}
  }
  async function checkGenerationReadiness() {
    if (!planJson) return;
    setChecking(true);setProductionStatus("");
    try {
      const token = await authenticatedApiToken();
      const response = await fetch("/api/video-studio/preflight",{
        method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},
        body:JSON.stringify({plan:JSON.parse(planJson)})
      });
      const data = await response.json() as {ready?:boolean;blockers?:string[];error?:string};
      setProductionStatus(data.ready?"Produzione disponibile":("Generazione non disponibile: "+(data.blockers?.join(", ")||data.error||"Errore sconosciuto")));
    } catch(e) {setProductionStatus("Errore verifica: "+(e instanceof Error?e.message:String(e)));}
    finally {setChecking(false);}
  }
  function prepareLocalRender() { setRenderInstructions(true); download(); }
  function download() {
    const blob=new Blob([planJson],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download="autoposter-video-storyboard.json";a.click();URL.revokeObjectURL(url);
  }
  return <div style={{maxWidth:1100,margin:"0 auto",display:"grid",gap:24,paddingBottom:48}}>
    <header><h1>Video Studio</h1><p>Prepara storyboard verticali e invia lavori al renderer cloud quando configurato. La generazione autonoma di riprese realistiche, il montaggio professionale completo e la pubblicazione dei Reel non sono ancora collegati.</p></header>
    <section style={{display:"grid",gap:12,padding:18,border:"1px solid #8885",borderRadius:12}} aria-label="Simulazione piano editoriale adattivo">
      <h2>Strategia editoriale adattiva — simulazione</h2>
      <p>Anteprima della distribuzione automatica dei formati in base al budget. Non crea contenuti, non spende e non modifica il calendario. I costi sono ipotesi, non tariffe dei provider.</p>
      <label>Budget mensile ipotetico (€) <input type="number" min="0" max="10000" step="10" value={planningBudget} onChange={e=>setPlanningBudget(Math.max(0,Math.min(10000,Number(e.target.value)||0)))}/></label>
      <p><strong>{editorialPreview.mix.REEL} Reel · {editorialPreview.mix.POST} post · {editorialPreview.mix.CAROUSEL} caroselli</strong> — {editorialPreview.total} contenuti previsti</p>
      <small>Ipotesi: Reel 8 €, post 0,50 €, carosello 1,50 €. La strategia reale dovrà usare costi misurati, performance e dati sui contatti qualificati. Nessuna pubblicazione automatica viene autorizzata da questa simulazione.</small>
    </section>
    <section style={{display:"grid",gap:12}}>
      <h2>Storyboard AI — bozza strutturata</h2>
      <label>Argomento<input style={{width:"100%"}} value={topic} onChange={e=>setTopic(e.target.value)}/></label>
      <label>Problema<textarea style={{width:"100%"}} value={problem} onChange={e=>setProblem(e.target.value)}/></label>
      <label>Soluzione<textarea style={{width:"100%"}} value={solution} onChange={e=>setSolution(e.target.value)}/></label>
      <label>Invito all'azione<input style={{width:"100%"}} value={cta} onChange={e=>setCta(e.target.value)}/></label>
      <div><button type="button" className="primary-button" onClick={generate}>Crea storyboard 30 secondi</button></div>
      {error&&<p role="alert">{error}</p>}
      {productionStatus&&<p role="status">{productionStatus}</p>}
      {planJson&&<><p>Storyboard pronto per la revisione. Non è un video MP4.</p><pre style={{overflowX:"auto",whiteSpace:"pre-wrap",padding:16,border:"1px solid #777",borderRadius:12}}>{planJson}</pre><div><button type="button" onClick={download}>Esporta JSON</button> <button type="button" onClick={prepareLocalRender}>Prepara rendering locale</button> <button type="button" disabled={submitting} onClick={()=>void submitCloudJob()}>{submitting?"Invio…":"Accoda Reel nel cloud (riserva 1,50 €)"}</button> <button type="button" disabled={checking} onClick={()=>void checkGenerationReadiness()}>{checking?"Verifica…":"Verifica generazione Reel"}</button> <button type="button" disabled={saving} onClick={()=>void persistDraft()}>{saving?"Salvataggio…":"Salva bozza nel database"}</button></div></>}
    </section>
    {renderInstructions&&<section><h2>Rendering locale (senza API a pagamento)</h2><p>Scarica lo storyboard, prepara un file PNG per ogni scena e un manifest JSON che associ gli ID delle scene ai percorsi dei PNG. Sul computer con FFmpeg esegui:</p><pre style={{whiteSpace:"pre-wrap"}}>python scripts/render-video-assets.py storyboard.json scene-images.json reel.mp4</pre><p>Questo comando crea il MP4 sul tuo computer. Il rendering automatico dal browser non è ancora disponibile.</p></section>}
    <section style={{display:"grid",gap:8}}><h2>Stato e anteprima dei lavori cloud</h2><p>Inserisci l’identificativo di un lavoro esistente. La coda registra la richiesta ma non genera il video finché il servizio cloud non viene attivato.</p><label>ID lavoro<input value={jobId} onChange={e=>setJobId(e.target.value)} placeholder="UUID del lavoro"/></label><div><button type="button" onClick={()=>void loadJobStatus()} disabled={!jobId.trim()}>Verifica stato</button></div>{jobStatus&&<p role="status">{jobStatus}</p>}{previewUrl&&<video src={previewUrl} controls playsInline style={{width:"100%",maxWidth:320}}/>}</section>
    {jobId&&planJson&&<section style={{display:"grid",gap:8}}><h2>Immagini delle scene</h2><p>Carica un PNG per ogni scena del lavoro. Questo passaggio è manuale finché il generatore AI non sarà collegato.</p>{(JSON.parse(planJson) as {scenes:Array<{id:string}>}).scenes.map(scene=><label key={scene.id}>{scene.id} <input type="file" accept="image/png" disabled={uploading} onChange={e=>void uploadScene(scene.id,e.target.files?.[0]||null)}/></label>)}{uploadStatus&&<p role="status">{uploadStatus}</p>}</section>}
    <section><h2>Bozze salvate</h2>{drafts.map(d=><article key={d.id}><button type="button" onClick={()=>setPlanJson(JSON.stringify(d.plan,null,2))}>{d.title}</button> · {new Date(d.updated_at).toLocaleDateString("it-IT")}</article>)}</section>
    <section><h2>Piano editoriale — 30 giorni</h2><p>Idee iniziali da validare con ricerca e fonti prima della produzione.</p>
      <div style={{display:"grid",gap:10}}>{calendar?.slots.map(slot=><article key={slot.day} style={{padding:12,border:"1px solid #8885",borderRadius:10}}><strong>Giorno {slot.day} · {slot.pillar}</strong><p>{slot.headline}</p><small>{slot.hook}</small></article>)}</div>
    </section>
    <section><h2>Flusso esistente</h2><p>Usa le sezioni già presenti per continuare a gestire contenuti, revisioni, calendario e risultati.</p>
      <p><Link to="/app/contenuti">Contenuti</Link> · <Link to="/app/approvazioni">Revisioni</Link> · <Link to="/app/calendario">Calendario</Link> · <Link to="/app/analytics">Analytics</Link></p>
    </section>
  </div>;
}
