import { useState } from "react";
import { SCENE_MODELS, SCENE_CATALOG_DATE, durationOptions, editorialDraft, sceneEstimate } from "../features/content/personal-brand-editorial";

export function PersonalBrandEditorialPanel(){
 const [modelId,setModelId]=useState("kling4_0");
 const model=SCENE_MODELS.find(m=>m.id===modelId)??SCENE_MODELS[0];
 const durations=durationOptions(model);
 const [seconds,setSeconds]=useState(5);
 const actualSeconds=durations.includes(seconds)?seconds:durations[0];
 const [count,setCount]=useState(1);
 const [resolution,setResolution]=useState("1080p");
 const actualResolution=model.resolutions.includes(resolution)?resolution:model.resolutions[0]??"Da verificare";
 const [rate,setRate]=useState("");
 const quote=rate.trim()===""?null:Number(rate);
 const estimate=sceneEstimate(count,actualSeconds,quote);
 const [day,setDay]=useState(1);
 const plan=editorialDraft([]);
 const item=plan[day-1];
 return <section className="panel" aria-label="Personal Brand AI">
  <p className="eyebrow">Personal Brand AI · anteprima di configurazione</p>
  <h2>Regia video e piano editoriale</h2>
  <p>Un video originale per Instagram, TikTok e Facebook; un post LinkedIn sullo stesso tema. Il video e la voce originali restano tuoi.</p>
  <p role="status">Catalogo rilevato il {SCENE_CATALOG_DATE}. Questa anteprima non salva impostazioni, non genera video e non avvia pubblicazioni. Prezzi e compatibilità operativa da verificare sul server.</p>
  <div className="reel-create-row">
   <label>Modello scene AI<select value={model.id} onChange={e=>{setModelId(e.target.value);setRate("");}}>{SCENE_MODELS.map(m=><option key={m.id} value={m.id}>{m.name} · {m.id}</option>)}</select></label>
   <label>Scene AI per Reel<select value={count} onChange={e=>setCount(Number(e.target.value))}>{Array.from({length:6},(_,i)=><option key={i} value={i}>{i}</option>)}</select></label>
   <label>Secondi per scena<select value={actualSeconds} onChange={e=>setSeconds(Number(e.target.value))}>{durations.map(n=><option key={n} value={n}>{n} s</option>)}</select></label>
   <label>Risoluzione<select value={actualResolution} onChange={e=>{setResolution(e.target.value);setRate("");}}>{(model.resolutions.length?model.resolutions:["Da verificare"]).map(r=><option key={r}>{r}</option>)}</select></label>
   <label>Tariffa indicativa USD/s<input type="number" min="0" step="0.001" value={rate} onChange={e=>setRate(e.target.value)} placeholder="Inserisci tariffa verificata"/></label>
  </div>
  <p>{model.description} · {model.tags.join(", ")}</p>
  <p>Stima scene AI su 30 Reel: {estimate===null?"tariffa da verificare":estimate.toFixed(2)+" USD"} (esclusi rigenerazioni, imposte e altri servizi).</p>
  <details><summary>Confronta i modelli disponibili nel catalogo rilevato</summary><div style={{overflowX:"auto"}}><table><thead><tr><th>Modello</th><th>Durate (s)</th><th>Risoluzione</th><th>Caratteristiche dichiarate</th></tr></thead><tbody>{SCENE_MODELS.map(m=><tr key={m.id}><td>{m.name} · {m.id}</td><td>{m.durations?.length?m.durations.join(", "):m.min+"–"+m.max}</td><td>{m.resolutions.join(", ")||"Da verificare"}</td><td>{m.description}</td></tr>)}</tbody></table></div></details>
  <h3>Piano editoriale iniziale · 30 giorni</h3>
  <label>Giorno<select value={day} onChange={e=>setDay(Number(e.target.value))}>{plan.map(p=><option key={p.day} value={p.day}>{p.day} · {p.topic}</option>)}</select></label>
  {item&&<article><h4>{item.topic}</h4><p><strong>Reel:</strong> {item.reel}</p><p><strong>LinkedIn:</strong> {item.linkedin}</p><p><strong>Materiale da verificare:</strong> {item.proof}</p><p>Bozza editoriale: non pubblicabile prima della verifica dei fatti.</p></article>}
 </section>;
}
