import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Badge, Card, PageHeader, Progress } from '../components/ui';
import { MediaPicker } from '../components/MediaPicker';
import type { Platform } from '../services/domain';
import { useSaasRepository, useSaasSnapshot } from '../services/SaasServicesProvider';
import { useLocalE2E } from '../services/local-e2e';
import './post-editor.css';

const mockPlatforms: Platform[] = ['Instagram', 'Facebook', 'LinkedIn', 'Google Business Profile'];

export function PostEditorPage() {
  const local = useLocalE2E();
  const params = useParams();
  if (local.enabled && local.workspace && local.tenantId) return <LocalPostEditor id={params.id ?? ''} />;
  return <MockPostEditor id={params.id ?? 'p1'} />;
}

function LocalPostEditor({ id }: { id: string }) {
  const local = useLocalE2E();
  const post = local.workspace?.posts.find((item:any)=>item.id===id) as any;
  const variants = post?.variants ?? [];
  const [variantId,setVariantId] = useState<string>('');
  const [draft,setDraft] = useState({hook:'',caption:'',cta:'',hashtags:''});
  const [message,setMessage] = useState<string|null>(null);
  const [failureMode,setFailureMode] = useState('');
  const [visual,setVisual]=useState<any>(null);
  const [showMediaPicker,setShowMediaPicker]=useState(false);
  const variant = variants.find((item:any)=>item.id===variantId) ?? variants[0];
  useEffect(()=>{if(variant){setVariantId(variant.id);setDraft({hook:variant.hook??'',caption:variant.caption??'',cta:variant.cta??'',hashtags:(variant.hashtags??[]).join(', ')});setShowMediaPicker(false);if(local.tenantId)void local.api(`/tenants/${local.tenantId}/variants/${variant.id}/visual`).then(setVisual).catch(()=>setVisual(null))}},[variant?.id]);
  if(!post) return <Card><strong>Post non trovato nel tenant corrente.</strong></Card>;

  const quality = post.quality_score ?? {};
  const status = qualityLabel(quality);
  const run = async(action:()=>Promise<unknown>)=>{setMessage(null);try{await action();await local.refresh();setMessage('Operazione salvata nel database locale.')}catch(error){setMessage(error instanceof Error?error.message:String(error));}};
  const generate=()=>run(()=>local.api(`/tenants/${local.tenantId}/posts/${post.id}/generate`,{method:'POST'}));
  const save=()=>variant&&run(()=>local.api(`/tenants/${local.tenantId}/variants/${variant.id}`,{method:'PATCH',body:JSON.stringify({hook:draft.hook,caption:draft.caption,cta:draft.cta,hashtags:draft.hashtags.split(',').map((item)=>item.trim()).filter(Boolean)})}));
  const approve=()=>variant&&run(()=>local.api(`/tenants/${local.tenantId}/variants/${variant.id}/approve`,{method:'POST'}));
  const reject=()=>variant&&run(()=>local.api(`/tenants/${local.tenantId}/variants/${variant.id}/reject`,{method:'POST',body:JSON.stringify({reason:'Rifiutato dalla UI locale'})}));
  const schedule=()=>run(()=>local.api(`/tenants/${local.tenantId}/posts/${post.id}/schedule`,{method:'POST'}));
  const publish=()=>run(async()=>{
    const existingJobs = local.workspace?.jobs?.filter((job:any)=>job.post_id===post.id||variants.some((item:any)=>item.id===job.post_variant_id)) ?? [];
    if(existingJobs.length===0) await local.api(`/tenants/${local.tenantId}/posts/${post.id}/schedule`,{method:'POST'});
    return local.api(`/tenants/${local.tenantId}/publish-now`,{method:'POST',body:JSON.stringify({postId:post.id,...(failureMode?{failureMode}:{})})});
  });
  const concept = post.core_concept ?? {};
  const scores = [
    ['Brand match',quality.brandMatch],['Rilevanza',quality.relevance],['Novelty',quality.novelty],['Chiarezza',quality.clarity],['Platform fit',quality.platformFit],['Visual fit',quality.visualFit],['Fact confidence',quality.factConfidence],['CTA quality',quality.ctaQuality],
  ] as const;

  return <><PageHeader eyebrow="Post editor · E2E locale" title={post.topic} description="Concept, varianti, quality gate, media selection, approval, scheduler e publish mock sono persistiti nel database locale." action={<Link className="button secondary" to="/app/calendar">← Calendario</Link>}/>{message&&<Card><p role="status">{message}</p></Card>}
  <div className="editor-layout"><div className="stack"><Card><div className="row-between"><div><span className="eyebrow">Core concept</span><h2>{concept.angle??post.topic}</h2></div><Badge tone={status==='Pronto'?'good':status==='Problema rilevato'?'warn':'info'}>{status}</Badge></div><div className="concept-grid"><ConceptField label="Stato" value={String(post.status).toUpperCase()}/><ConceptField label="Obiettivo" value={String(post.objective??concept.objective??'—')}/><ConceptField label="Topic" value={String(concept.topic??post.topic)}/><ConceptField label="Hook intent" value={String(concept.hookIntent??'—')}/><ConceptField label="CTA intent" value={String(concept.ctaIntent??'—')}/></div>{variants.length===0&&<button data-testid="generate-single-post" className="button" onClick={()=>void generate()}>Genera contenuto</button>}</Card>
  {variants.length>0&&<Card><div className="platform-tabs" role="tablist" aria-label="Varianti per canale">{variants.map((item:any)=><button key={item.id} role="tab" aria-selected={variant?.id===item.id} className={variant?.id===item.id?'active':''} onClick={()=>setVariantId(item.id)}>{platformName(item.platform)}</button>)}</div>{variant&&<><div className="variant-heading"><div><span className="eyebrow">Decisione canale</span><h2>{platformName(variant.platform)}</h2></div><Badge tone={variant.platform_decision==='skip'?'neutral':variant.platform_decision==='separate_concept'?'warn':'info'}>{variant.platform_decision}</Badge></div><p className="decision-reason">Approval: {String(variant.approval_mode).toUpperCase()} · {String(variant.approval_status).toUpperCase()} · stato {String(variant.status).toUpperCase()}</p><label className="editor-field"><span>Hook</span><textarea data-testid="variant-hook" value={draft.hook} onChange={(e)=>setDraft({...draft,hook:e.target.value})}/></label><label className="editor-field"><span>Caption</span><textarea data-testid="variant-caption" className="large" value={draft.caption} onChange={(e)=>setDraft({...draft,caption:e.target.value})}/></label><label className="editor-field"><span>CTA</span><input value={draft.cta} onChange={(e)=>setDraft({...draft,cta:e.target.value})}/></label><label className="editor-field"><span>Hashtag</span><input value={draft.hashtags} onChange={(e)=>setDraft({...draft,hashtags:e.target.value})}/></label><div className="editor-actions"><button className="button secondary" onClick={()=>void generate()}>Rigenera con quality gate</button><button data-testid="save-variant" className="button secondary" onClick={()=>void save()}>Salva User version + diff</button></div></>}</Card>}
  {variant&&<><Card><span className="eyebrow">Visual brief</span><div className="row-between"><h2>{String(variant.visual_brief?.angle??variant.visual_brief?.subject??'Direzione visual')}</h2><button data-testid="post-editor-media-picker" className="button secondary" onClick={()=>setShowMediaPicker(!showMediaPicker)}>Scegli foto dalla libreria</button></div><div className="visual-brief"><div className="visual-placeholder">{visual?.preview_urls?.[0]?<img loading="lazy" src={visual.preview_urls[0]} alt={post.topic}/>:<>MOCK<br/>VISUAL</>}</div><pre className="muted">{JSON.stringify(variant.visual_brief,null,2)}</pre></div><p className="muted">La selezione manuale cambia solo visual selection/render/QA. Hook, caption, hashtag e CTA restano invariati.</p></Card>{showMediaPicker&&<MediaPicker variantId={variant.id} topic={post.topic} currentAssetId={visual?.selection?.selectedAssetId??visual?.visual_spec?.selection?.selectedAssetId??null} onClose={()=>setShowMediaPicker(false)} onSelected={(result)=>{setVisual(result);setShowMediaPicker(false);setMessage('Asset sostituito senza rigenerare il copy. Nuova visual version e QA completati.')}}/>}</>}</div>
  <aside className="stack editor-sidebar"><Card><span className="eyebrow">Quality gate interno</span><h2>{status}</h2>{scores.map(([label,value])=><Score key={label} label={label} value={Math.round(Number(value??0)*100)}/>) }<Signal label="Duplicate risk" value={Number(quality.duplicateRisk??0).toFixed(2)}/></Card><Card><span className="eyebrow">Anti-duplicate</span><h2>Server-side</h2><p>Rischio {Number(quality.duplicateRisk??0).toFixed(2)}</p><p className="muted">Il client riceve solo score/segnali del proprio post. Nessun contenuto di altri tenant viene esposto.</p></Card><Card><span className="eyebrow">Decisione</span><h2>{variant?String(variant.approval_mode).toUpperCase():'Non generato'}</h2>{variant&&variant.platform_decision!=='skip'&&<div className="decision-buttons"><button data-testid="reject-variant" className="button secondary" onClick={()=>void reject()}>Rifiuta</button><button data-testid="approve-variant" className="button" onClick={()=>void approve()}>Approva</button></div>}<button data-testid="schedule-post" className="button full" onClick={()=>void schedule()}>Programma</button><label className="field"><span>Simula errore provider</span><select data-testid="failure-mode" value={failureMode} onChange={(e)=>setFailureMode(e.target.value)}><option value="">Successo</option><option value="provider_timeout">Provider timeout</option><option value="rate_limit">Rate limit</option><option value="auth_expired">Auth expired</option><option value="validation_error">Validation error</option><option value="platform_rejection">Platform rejection</option><option value="success_after_timeout">Success + timeout response</option></select></label><button data-testid="publish-now" className="button full" onClick={()=>void publish()}>Publish now · MOCK</button><p className="muted">Nessuna azione raggiunge un provider reale.</p></Card></aside></div></>;
}

function MockPostEditor({id}:{id:string}) {
  const {posts}=useSaasSnapshot(); const repository=useSaasRepository(); const post=posts.find((item)=>item.id===id)??posts[0]; const [platform,setPlatform]=useState<Platform>('Instagram');
  if(!post)return <Card>Nessun post mock.</Card>;
  return <><PageHeader eyebrow="Post editor · mock" title={post.title} description="Configura VITE_LOCAL_API_URL per il flusso DB-backed."/><Card><div className="platform-tabs">{mockPlatforms.map((item)=><button key={item} className={platform===item?'active':''} onClick={()=>setPlatform(item)}>{item}</button>)}</div><p>Shell mock per {platform}.</p><button onClick={()=>repository.approvePost(post.id)}>Approva mock</button></Card></>;
}

function ConceptField({label,value}:{label:string;value:string}){return <div className="concept-field"><span>{label}</span><strong>{value}</strong></div>}
function Score({label,value}:{label:string;value:number}){return <Progress label={label} value={value} max={100}/>}
function Signal({label,value}:{label:string;value:string}){return <div className="signal-row"><span>{label}</span><strong>{value}</strong></div>}
function platformName(value:unknown){return value==='google_business_profile'?'Google Business Profile':String(value??'').replace(/^./,(c)=>c.toUpperCase())}
function qualityLabel(q:any){if(!q||Object.keys(q).length===0)return 'Da controllare';const fail=Number(q.brandMatch??0)<.8||Number(q.relevance??0)<.8||Number(q.factConfidence??0)<.75||Number(q.duplicateRisk??1)>=.84;return fail?'Problema rilevato':'Pronto'}
