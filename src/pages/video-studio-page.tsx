import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useProfiles } from "../features/profiles/profile-context";
import { buildPersonalEditorialCalendar } from "../../api/_lib/video-editorial-calendar";
import { buildVideoPlan, validateVideoForReview } from "../../api/_lib/video-studio";

export function VideoStudioPage() {
  const { selectedProfileId } = useProfiles();
  const [topic,setTopic] = useState("Il tuo sito web porta davvero nuovi clienti?");
  const [problem,setProblem] = useState("Un sito poco chiaro può far perdere richieste di contatto.");
  const [solution,setSolution] = useState("Una pagina semplice, veloce e con una CTA evidente aiuta le persone a contattarti.");
  const [cta,setCta] = useState("Richiedi una bozza gratuita");
  const [planJson,setPlanJson] = useState("");
  const [error,setError] = useState("");
  const calendar=useMemo(()=>selectedProfileId?buildPersonalEditorialCalendar(selectedProfileId):null,[selectedProfileId]);
  function generate() {
    try {
      if(!selectedProfileId) throw new Error("Seleziona prima un'attività.");
      const plan=buildVideoPlan({profileId:selectedProfileId,topic,problem,solution,callToAction:cta});
      const issues=validateVideoForReview(plan,{},0);
      if(issues.length) throw new Error(issues.join(", "));
      setPlanJson(JSON.stringify(plan,null,2));setError("");
    } catch(e) {setError(e instanceof Error?e.message:String(e));}
  }
  function download() {
    const blob=new Blob([planJson],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download="autoposter-video-storyboard.json";a.click();URL.revokeObjectURL(url);
  }
  return <div style={{maxWidth:1100,margin:"0 auto",display:"grid",gap:24,paddingBottom:48}}>
    <header><h1>Video Studio</h1><p>Prepara storyboard verticali per i Reel. Il rendering e la pubblicazione non sono ancora collegati.</p></header>
    <section style={{display:"grid",gap:12}}>
      <h2>Storyboard AI — bozza strutturata</h2>
      <label>Argomento<input style={{width:"100%"}} value={topic} onChange={e=>setTopic(e.target.value)}/></label>
      <label>Problema<textarea style={{width:"100%"}} value={problem} onChange={e=>setProblem(e.target.value)}/></label>
      <label>Soluzione<textarea style={{width:"100%"}} value={solution} onChange={e=>setSolution(e.target.value)}/></label>
      <label>Invito all'azione<input style={{width:"100%"}} value={cta} onChange={e=>setCta(e.target.value)}/></label>
      <div><button type="button" className="primary-button" onClick={generate}>Crea storyboard 30 secondi</button></div>
      {error&&<p role="alert">{error}</p>}
      {planJson&&<><p>Storyboard pronto per la revisione. Non è un video MP4.</p><pre style={{overflowX:"auto",whiteSpace:"pre-wrap",padding:16,border:"1px solid #777",borderRadius:12}}>{planJson}</pre><div><button type="button" onClick={download}>Esporta JSON</button></div></>}
    </section>
    <section><h2>Piano editoriale — 30 giorni</h2><p>Idee iniziali da validare con ricerca e fonti prima della produzione.</p>
      <div style={{display:"grid",gap:10}}>{calendar?.slots.map(slot=><article key={slot.day} style={{padding:12,border:"1px solid #8885",borderRadius:10}}><strong>Giorno {slot.day} · {slot.pillar}</strong><p>{slot.headline}</p><small>{slot.hook}</small></article>)}</div>
    </section>
    <section><h2>Flusso esistente</h2><p>Usa le sezioni già presenti per continuare a gestire contenuti, revisioni, calendario e risultati.</p>
      <p><Link to="/app/contenuti">Contenuti</Link> · <Link to="/app/approvazioni">Revisioni</Link> · <Link to="/app/calendario">Calendario</Link> · <Link to="/app/analytics">Analytics</Link></p>
    </section>
  </div>;
}
