import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Badge, Card, EmptyState, PageHeader } from '../components/ui';
import { generateContentIncrementally } from '../services/content-generation-queue';
import { useLocalE2E } from '../services/local-e2e';

const brandFields = [
  ['brand_name','Nome brand','text'],['description','Descrizione','textarea'],['industry','Settore','text'],['target','Target','list'],['personas','Personas','list'],['services','Servizi','list'],['products','Prodotti','list'],['usp','USP','text'],['differentiators','Differenziatori','list'],['value_propositions','Value proposition','list'],['brand_colors','Colori','list'],['fonts','Font','list'],['visual_style','Stile visivo','object'],['tone_of_voice','Tone of voice','object'],['vocabulary','Parole preferite','list'],['banned_words','Parole da evitare','list'],['cta_preferences','CTA','list'],['topics','Temi','list'],['goals','Obiettivi','list'],
] as const;

export function BrandPage() {
  const local = useLocalE2E();
  const profile = local.workspace?.brand;
  const [draft, setDraft] = useState<Record<string,unknown>>({});
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { if (profile) setDraft(profile); }, [profile]);

  const createManual=async()=>{
    if(!local.tenantId)return;
    setMessage(null);
    try{await local.api(`/tenants/${local.tenantId}/brand/manual-init`,{method:'POST',body:JSON.stringify({})});await local.refresh();setMessage('Brand Profile creato dai dati dell’attività. Completa e conferma i campi.');}
    catch(error){setMessage(error instanceof Error?error.message:String(error));}
  };

  if (!local.tenantId) return <><PageHeader eyebrow="Brand" title="Brand Profile" description="Seleziona un’attività per gestire il brand."/><Card><EmptyState title="Nessuna attività attiva" body="Crea o seleziona un’attività."/></Card></>;
  if (!profile) return <><PageHeader eyebrow="Brand" title="Brand Profile" description="Il profilo può essere creato dalla scansione del sito oppure manualmente dai dati dell’attività."/>{message&&<Card><p role="status">{message}</p></Card>}<Card><EmptyState title="Brand Profile non ancora creato" body="Se hai un sito, esegui prima la scansione pagina per pagina. In alternativa crea il profilo manuale e completalo tu."/><div className="card-actions"><button className="button" onClick={()=>void createManual()}>Crea Brand Profile manuale</button></div></Card></>;

  const locks = new Set(local.workspace?.locks.map((lock)=>String(lock.field_path)) ?? []);
  const source = profile.source_summary ?? {};
  const save = async () => {
    setMessage(null);
    try { await local.api(`/tenants/${local.tenantId}/brand`, { method:'PATCH', body:JSON.stringify(normalizeBrandPatch(draft)) }); await local.refresh(); setMessage('Modifiche salvate in una nuova versione del Brand Profile.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const setStatus = async (status:'review'|'confirmed') => { try{await local.api(`/tenants/${local.tenantId}/brand/status`,{method:'POST',body:JSON.stringify({status})});await local.refresh();setMessage(status==='confirmed'?'Brand Profile confermato.':'Brand Profile segnato per revisione.');}catch(error){setMessage(error instanceof Error?error.message:String(error));} };
  const toggleLock = async (key:string) => { try{await local.api(`/tenants/${local.tenantId}/brand/lock`,{method:'POST',body:JSON.stringify({fieldPath:key,locked:!locks.has(key)})});await local.refresh();}catch(error){setMessage(error instanceof Error?error.message:String(error));} };

  return <>
    <PageHeader eyebrow="Brand" title="Brand Profile versionato" description="È la fonte di verità per strategia, contenuti e QA. I campi bloccati non possono essere riscritti automaticamente." action={<div className="card-actions"><button className="button secondary" onClick={()=>void setStatus('review')}>Da rivedere</button><button className="button" data-testid="brand-confirm" onClick={()=>void setStatus('confirmed')}>Conferma brand</button></div>} />
    <div className="three-col"><Card><span className="eyebrow">Versione</span><h2>v{String(profile.version ?? 1)}</h2></Card><Card><span className="eyebrow">Stato</span><h2>{String(profile.status).toUpperCase()}</h2></Card><Card><span className="eyebrow">Origine</span><p>{String(source.source ?? 'manuale')}</p><small>{profile.updated_at?new Date(String(profile.updated_at)).toLocaleString('it-IT'):'—'}</small></Card></div>
    {message && <Card><p role="status">{message}</p></Card>}
    <div className="brand-grid">{brandFields.map(([key,label,type]) => <Card key={key}><div className="row-between"><span className="eyebrow">{label}</span><Badge tone={locks.has(key)?'neutral':profile.status==='confirmed'?'good':'warn'}>{locks.has(key)?'BLOCCATO':String(profile.status).toUpperCase()}</Badge></div><BrandInput testId={`brand-${key}`} type={type} value={draft[key]} onChange={(value)=>setDraft({...draft,[key]:value})} disabled={locks.has(key)}/><div className="card-actions"><button type="button" onClick={()=>void toggleLock(key)}>{locks.has(key)?'Sblocca':'Blocca campo'}</button></div></Card>)}</div>
    <Card><button data-testid="brand-save" className="button" onClick={()=>void save()}>Salva modifiche</button><p className="muted">Versioni archiviate: {local.workspace?.brandVersions.length ?? 0}.</p></Card>
  </>;
}

function BrandInput({type,value,onChange,disabled,testId}:{type:string;value:unknown;onChange:(value:unknown)=>void;disabled:boolean;testId:string}) {
  const text = type === 'list' ? (Array.isArray(value)?value.join(', '):String(value ?? '')) : type === 'object' ? String((value as any)?.description ?? '') : String(value ?? '');
  const change = (next:string) => onChange(type === 'list' ? next.split(',').map((item)=>item.trim()).filter(Boolean) : type === 'object' ? {description:next} : next);
  return type === 'textarea' ? <textarea data-testid={testId} value={text} disabled={disabled} onChange={(event)=>change(event.target.value)}/> : <input data-testid={testId} value={text} disabled={disabled} onChange={(event)=>change(event.target.value)}/>;
}

function normalizeBrandPatch(draft:Record<string,unknown>) { return Object.fromEntries(brandFields.map(([key])=>[key,draft[key]])); }

export function CalendarPage() {
  const local = useLocalE2E();
  const [view,setView] = useState<'week'|'month'|'list'>('list');
  const [message,setMessage] = useState<string|null>(null);
  const [editing,setEditing]=useState<string|null>(null);
  const [dateTime,setDateTime]=useState('');
  const [working,setWorking]=useState<'calendar'|'content'|null>(null);
  const [progress,setProgress]=useState('');
  const posts = local.workspace?.posts ?? [];
  const aiReady=Boolean(local.health?.testFixtures||local.health?.capabilities?.openai);
  const imagesReady=Boolean(local.health?.testFixtures||local.health?.capabilities?.openaiImages2);
  const variants=useMemo(()=>posts.flatMap((post:any)=>(post.variants??[]).filter((variant:any)=>variant.platform_decision!=='skip').map((variant:any)=>({post,variant}))).sort((a:any,b:any)=>String(a.variant.scheduled_at??a.post.planned_at??'').localeCompare(String(b.variant.scheduled_at??b.post.planned_at??''))),[posts]);
  const visible=useMemo(()=>{
    if(view==='list'||variants.length===0)return variants;
    const first=variants.find((item:any)=>item.variant.scheduled_at||item.post.planned_at);
    if(!first)return variants;
    const start=new Date(String(first.variant.scheduled_at??first.post.planned_at)).getTime();
    const windowMs=view==='week'?7*86400000:31*86400000;
    return variants.filter((item:any)=>{const value=item.variant.scheduled_at??item.post.planned_at;if(!value)return true;const time=new Date(String(value)).getTime();return time>=start&&time<start+windowMs;});
  },[variants,view]);

  const generateCalendar=async()=>{
    if(!local.tenantId||!aiReady)return;
    setWorking('calendar');setMessage(null);setProgress('');
    try{await local.api(`/tenants/${local.tenantId}/calendar`,{method:'POST',body:JSON.stringify({weeks:4})});await local.refresh();setMessage('Calendario generato e salvato per questa attività.');}
    catch(error){setMessage(error instanceof Error?error.message:String(error));}
    finally{setWorking(null);}
  };
  const generateContent=async()=>{
    if(!local.tenantId||!aiReady)return;
    setWorking('content');setMessage(null);setProgress('Preparazione coda…');
    try{
      if(local.health?.testFixtures){await local.api(`/tenants/${local.tenantId}/posts/generate-all`,{method:'POST',body:JSON.stringify({limit:50})});}
      else{
        await generateContentIncrementally({api:local.api,tenantId:local.tenantId,posts,imagesReady,onProgress:(item)=>setProgress(`${item.currentLabel} · ${item.completedPosts}/${item.totalPosts} contenuti · ${item.completedVisuals} visuali verificate`)});
      }
      await local.refresh();setProgress('');setMessage('Contenuti generati progressivamente. Ogni variante resta ferma finché non la approvi nelle Anteprime.');
    }
    catch(error){setProgress('');setMessage(error instanceof Error?error.message:String(error));}
    finally{setWorking(null);}
  };
  const beginEdit=(variant:any)=>{setEditing(String(variant.id));setDateTime(toLocalInput(variant.scheduled_at));};
  const saveSchedule=async(variantId:string)=>{
    if(!local.tenantId||!dateTime)return;
    setMessage(null);
    try{await local.api(`/tenants/${local.tenantId}/variants/${variantId}/schedule`,{method:'PATCH',body:JSON.stringify({scheduledAt:new Date(dateTime).toISOString()})});await local.refresh();setEditing(null);setMessage('Data e ora aggiornate. L’approvazione resta invariata.');}
    catch(error){setMessage(error instanceof Error?error.message:String(error));}
  };

  return <>
    <PageHeader eyebrow="Piano editoriale" title="Calendario" description="Programmazione persistente per singola variante e piattaforma. Nessun contenuto viene pubblicato senza la tua approvazione." action={<div className="card-actions"><button data-testid="generate-calendar" className="button" disabled={!local.tenantId||!aiReady||working!==null} title={aiReady?'Genera 4 settimane':'OpenAI non configurato'} onClick={()=>void generateCalendar()}>{working==='calendar'?'Generazione…':'Genera piano con OpenAI'}</button><button data-testid="generate-content" className="button secondary" disabled={!local.tenantId||!aiReady||working!==null||posts.length===0} title={aiReady?'Genera i contenuti del piano':'OpenAI non configurato'} onClick={()=>void generateContent()}>{working==='content'?'Generazione progressiva…':'Genera contenuti'}</button></div>} />
    {progress&&<Card><p role="status">{progress}</p></Card>}
    {message&&<Card><p role="status">{message}</p></Card>}
    {!aiReady&&<Card><Badge tone="warn">OPENAI DA CONFIGURARE</Badge><p>La generazione resta non disponibile finché il backend non conferma OpenAI. Non viene usato alcun generatore sostitutivo.</p></Card>}
    <Card><div className="filter-row">{(['week','month','list'] as const).map((item)=><button key={item} data-testid={`calendar-view-${item}`} className={`filter ${view===item?'active':''}`} onClick={()=>setView(item)}>{item==='week'?'Settimana':item==='month'?'Mese':'Lista'}</button>)}<span className="grow"/><Badge>{variants.length} uscite</Badge></div></Card>
    {visible.length===0?<Card><EmptyState title="Calendario vuoto" body={aiReady?'Genera il piano editoriale per creare le prime uscite.':'Configura OpenAI nel backend per poter generare il piano editoriale.'}/></Card>:<div className="stack">{visible.map(({post,variant}:any)=>{
      const scheduled=variant.scheduled_at??post.planned_at;
      return <Card key={variant.id}><div className="row-between"><div><strong>{post.topic}</strong><small>{platformName(variant.platform)} · {variant.format??post.format??'formato da definire'}</small></div><Badge tone={variant.status==='published'?'good':variant.status==='rejected'||variant.status==='failed'?'warn':'info'}>{String(variant.status??post.status).toUpperCase()}</Badge></div>
        <div className="signal-row"><span>Data e ora</span><strong>{scheduled?new Date(String(scheduled)).toLocaleString('it-IT'):'Non impostata'}</strong></div>
        <div className="signal-row"><span>Approvazione</span><Badge tone={variant.approval_status==='approved'?'good':variant.approval_status==='rejected'?'warn':'info'}>{String(variant.approval_status??'pending').toUpperCase()}</Badge></div>
        {editing===String(variant.id)?<div className="card-actions"><input aria-label="Nuova data e ora" type="datetime-local" value={dateTime} onChange={(event)=>setDateTime(event.target.value)}/><button className="button" disabled={!dateTime} onClick={()=>void saveSchedule(String(variant.id))}>Salva</button><button className="button secondary" onClick={()=>setEditing(null)}>Annulla</button></div>:<div className="card-actions"><button className="button secondary" disabled={['publishing','published'].includes(String(variant.status))} onClick={()=>beginEdit(variant)}>Modifica data/ora</button><Link className="button secondary" to={`/app/posts/${post.id}`}>Apri contenuto</Link></div>}
      </Card>;
    })}</div>}
  </>;
}

function platformName(value:unknown){return value==='google_business_profile'?'Google Business Profile':String(value??'').replace(/^./,(c)=>c.toUpperCase());}
function toLocalInput(value:unknown){if(!value)return'';const date=new Date(String(value));if(Number.isNaN(date.getTime()))return'';const offset=date.getTimezoneOffset()*60000;return new Date(date.getTime()-offset).toISOString().slice(0,16);}
