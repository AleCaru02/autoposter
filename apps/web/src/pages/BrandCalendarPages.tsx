import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Badge, Card, PageHeader } from '../components/ui';
import { useSaasSnapshot } from '../services/SaasServicesProvider';
import { useLocalE2E } from '../services/local-e2e';

const brandFields = [
  ['brand_name','Brand name','text'],['description','Description','textarea'],['industry','Settore','text'],['target','Target','list'],['personas','Personas','list'],['services','Servizi','list'],['products','Prodotti','list'],['usp','USP','text'],['differentiators','Differenziatori','list'],['value_propositions','Value proposition','list'],['brand_colors','Colori','list'],['fonts','Font','list'],['visual_style','Stile visivo','object'],['tone_of_voice','Tone of voice','object'],['vocabulary','Parole preferite','list'],['banned_words','Parole da evitare','list'],['cta_preferences','CTA','list'],['topics','Topics','list'],['goals','Goals','list'],
] as const;

export function BrandPage() {
  const local = useLocalE2E();
  const fallback = useSaasSnapshot();
  const profile = local.workspace?.brand;
  const [draft, setDraft] = useState<Record<string,unknown>>({});
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { if (profile) setDraft(profile); }, [profile]);

  if (!local.enabled || !profile || !local.tenantId) return <><PageHeader eyebrow="Brand intelligence" title="Brand Profile" description="Fonte compatta di verità per strategia, generazione e QA. I lock impediscono all’AI di reinterpretare fatti critici." /><div className="brand-grid">{fallback.brandFields.map((field) => <Card key={field.key}><div className="row-between"><span className="eyebrow">{field.label}</span><Badge tone={field.status === 'Inferito' ? 'warn' : field.status === 'Bloccato' ? 'neutral' : 'good'}>{field.status}</Badge></div><p className="brand-value">{field.value}</p></Card>)}</div></>;

  const locks = new Set(local.workspace?.locks.map((lock)=>String(lock.field_path)) ?? []);
  const source = profile.source_summary ?? {};
  const save = async () => {
    setMessage(null);
    try { await local.api(`/tenants/${local.tenantId}/brand`, { method:'PATCH', body:JSON.stringify(normalizeBrandPatch(draft)) }); await local.refresh(); setMessage('Nuova versione DRAFT salvata.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const setStatus = async (status:'review'|'confirmed') => { await local.api(`/tenants/${local.tenantId}/brand/status`,{method:'POST',body:JSON.stringify({status})}); await local.refresh(); };
  const toggleLock = async (key:string) => { await local.api(`/tenants/${local.tenantId}/brand/lock`,{method:'POST',body:JSON.stringify({fieldPath:key,locked:!locks.has(key)})}); await local.refresh(); };

  return <>
    <PageHeader eyebrow="Brand intelligence · locale" title="Brand Profile versionato" description="DRAFT → REVIEWED → CONFIRMED. I campi bloccati non vengono sovrascritti dalle scansioni successive." action={<div className="card-actions"><button className="button secondary" onClick={()=>void setStatus('review')}>Segna REVIEWED</button><button className="button" data-testid="brand-confirm" onClick={()=>void setStatus('confirmed')}>Conferma</button></div>} />
    <div className="three-col"><Card><span className="eyebrow">Versione corrente</span><h2>v{String(profile.version ?? 1)}</h2></Card><Card><span className="eyebrow">Stato</span><h2>{String(profile.status).toUpperCase()}</h2></Card><Card><span className="eyebrow">Origine / aggiornamento</span><p>{String(source.source ?? 'onboarding')}</p><small>{new Date(String(profile.updated_at)).toLocaleString('it-IT')}</small></Card></div>
    {message && <Card><p role="status">{message}</p></Card>}
    <div className="brand-grid">{brandFields.map(([key,label,type]) => <Card key={key}><div className="row-between"><span className="eyebrow">{label}</span><Badge tone={locks.has(key)?'neutral':profile.status==='confirmed'?'good':'warn'}>{locks.has(key)?'Bloccato':String(profile.status).toUpperCase()}</Badge></div><BrandInput testId={`brand-${key}`} type={type} value={draft[key]} onChange={(value)=>setDraft({...draft,[key]:value})} disabled={locks.has(key)}/><div className="card-actions"><button type="button" onClick={()=>void toggleLock(key)}>{locks.has(key)?'Sblocca':'Blocca'}</button></div></Card>)}</div>
    <Card><button data-testid="brand-save" className="button" onClick={()=>void save()}>Salva nuova versione DRAFT</button><p className="muted">Storico versioni: {local.workspace?.brandVersions.length ?? 0}. Fonte ultima versione: {String(source.source ?? 'non indicata')}.</p></Card>
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
  const fallback = useSaasSnapshot();
  const [view,setView] = useState<'week'|'month'|'list'>('week');
  const [message,setMessage] = useState<string|null>(null);
  const realPosts = local.workspace?.posts ?? [];
  const visible = useMemo(()=>{
    if (!local.enabled) return [];
    const sorted=[...realPosts].sort((a,b)=>String(a.planned_at??'').localeCompare(String(b.planned_at??'')));
    if(view==='list'||view==='month') return sorted;
    const first=sorted.find((post)=>post.planned_at)?.planned_at;
    if(!first) return sorted;
    const start=new Date(first).getTime(); return sorted.filter((post)=>new Date(String(post.planned_at)).getTime()<start+7*86400000);
  },[local.enabled,realPosts,view]);

  if (!local.enabled || !local.tenantId) return <><PageHeader eyebrow="Piano editoriale" title="Calendario" description="Un concept può diventare una variante nativa, un concept separato o essere saltato su ogni canale." /><Card><div className="calendar-list">{fallback.posts.map((post)=><article className="calendar-row" key={post.id}><div className="date-chip large">{post.date}</div><div className="grow"><strong>{post.title}</strong><div className="meta-line">{post.platform} · {post.state}</div></div><Link className="ghost-button" to={`/app/posts/${post.id}`}>Apri</Link></article>)}</div></Card></>;

  const generateCalendar=async()=>{setMessage(null);try{await local.api(`/tenants/${local.tenantId}/calendar`,{method:'POST',body:JSON.stringify({weeks:4})});await local.refresh();setMessage('Calendario di 4 settimane generato nel database locale.');}catch(error){setMessage(error instanceof Error?error.message:String(error));}};
  const generateContent=async()=>{setMessage(null);try{await local.api(`/tenants/${local.tenantId}/posts/generate-all`,{method:'POST',body:JSON.stringify({limit:50})});await local.refresh();setMessage('Contenuti generati e passati nel quality gate.');}catch(error){setMessage(error instanceof Error?error.message:String(error));}};

  return <><PageHeader eyebrow="Piano editoriale · database locale" title="Calendario" description="Date, piattaforme, pillar, topic, formato e stato provengono dal database locale." action={<div className="card-actions"><button data-testid="generate-calendar" className="button secondary" onClick={()=>void generateCalendar()}>Genera 4 settimane</button><button data-testid="generate-content" className="button" onClick={()=>void generateContent()}>Genera contenuti</button></div>} />{message&&<Card><p role="status">{message}</p></Card>}<Card><div className="filter-row">{(['week','month','list'] as const).map((item)=><button key={item} data-testid={`calendar-view-${item}`} className={`filter ${view===item?'active':''}`} onClick={()=>setView(item)}>{item==='week'?'Settimana':item==='month'?'Mese':'Lista'}</button>)}<span className="grow"/><Badge>{realPosts.length} contenuti reali locali</Badge></div><div className="calendar-list">{visible.map((post:any)=><article className="calendar-row" key={post.id}><div className="date-chip large">{post.planned_at?new Date(post.planned_at).toLocaleDateString('it-IT',{day:'2-digit',month:'short'}):'—'}</div><div className="grow"><div className="row-between"><strong>{post.topic}</strong><Badge tone={post.status==='published'?'good':post.status==='failed'||post.status==='rejected'?'warn':'info'}>{String(post.status).toUpperCase()}</Badge></div><div className="meta-line">{platformName(post.primary_platform)} · {post.format??'—'} · {post.objective??'—'} · {post.variants?.length??0} varianti</div></div><Link className="ghost-button" to={`/app/posts/${post.id}`}>Apri</Link></article>)}{visible.length===0&&<p className="muted">Nessun contenuto: genera il calendario dalla strategia confermata.</p>}</div></Card></>;
}

function platformName(value:unknown){return value==='google_business_profile'?'Google Business Profile':String(value??'').replace(/^./,(c)=>c.toUpperCase());}
