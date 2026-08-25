import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Badge, Card, EmptyState, PageHeader, Progress } from '../components/ui';
import { MediaPicker } from '../components/MediaPicker';
import { useLocalE2E } from '../services/local-e2e';
import './post-editor.css';

export function PostEditorPage() {
  const local = useLocalE2E();
  const params = useParams();
  const post = local.workspace?.posts.find((item:any)=>item.id===(params.id??'')) as any;
  if(!post)return <><PageHeader eyebrow="Contenuto" title="Contenuto non trovato" description="Il contenuto non appartiene all’attività selezionata oppure non esiste."/><Card><EmptyState title="Nessun contenuto" body="Torna all’elenco dei contenuti dell’attività attiva."/><Link className="button" to="/app/contents">Torna ai contenuti</Link></Card></>;
  return <PersonalPostEditor post={post}/>;
}

function PersonalPostEditor({post}:{post:any}) {
  const local = useLocalE2E();
  const variants = post?.variants ?? [];
  const [variantId,setVariantId] = useState<string>('');
  const [draft,setDraft] = useState({hook:'',caption:'',cta:'',hashtags:''});
  const [message,setMessage] = useState<string|null>(null);
  const [visual,setVisual]=useState<any>(null);
  const [showMediaPicker,setShowMediaPicker]=useState(false);
  const variant = variants.find((item:any)=>item.id===variantId) ?? variants[0];

  useEffect(()=>{
    if(!variant)return;
    setVariantId(variant.id);
    setDraft({hook:variant.hook??'',caption:variant.caption??'',cta:variant.cta??'',hashtags:(variant.hashtags??[]).join(', ')});
    setShowMediaPicker(false);
    if(local.tenantId)void local.api(`/tenants/${local.tenantId}/variants/${variant.id}/visual`).then(setVisual).catch(()=>setVisual(null));
  },[variant?.id]);

  const quality = post.quality_score ?? {};
  const status = qualityLabel(quality);
  const run = async(action:()=>Promise<unknown>,success:string)=>{setMessage(null);try{await action();await local.refresh();setMessage(success);}catch(error){setMessage(error instanceof Error?error.message:String(error));}};
  const save=()=>variant&&run(()=>local.api(`/tenants/${local.tenantId}/variants/${variant.id}`,{method:'PATCH',body:JSON.stringify({hook:draft.hook,caption:draft.caption,cta:draft.cta,hashtags:draft.hashtags.split(',').map((item)=>item.trim()).filter(Boolean)})}),'Modifiche salvate. Il contenuto torna in attesa di approvazione.');
  const approve=()=>variant&&run(()=>local.api(`/tenants/${local.tenantId}/variants/${variant.id}/approve`,{method:'POST'}),variant.approval_mode==='auto'?'Approvato: potrà essere pubblicato all’orario programmato.':'Approvato: resta in attesa della tua scelta di pubblicazione.');
  const reject=()=>variant&&run(()=>local.api(`/tenants/${local.tenantId}/variants/${variant.id}/reject`,{method:'POST',body:JSON.stringify({reason:'Non pubblicare · decisione editor'})}),'Contenuto rifiutato: non verrà pubblicato.');
  const concept = post.core_concept ?? {};
  const scores = [
    ['Brand match',quality.brandMatch],['Rilevanza',quality.relevance],['Novelty',quality.novelty],['Chiarezza',quality.clarity],['Platform fit',quality.platformFit],['Visual fit',quality.visualFit],['Fact confidence',quality.factConfidence],['CTA quality',quality.ctaQuality],
  ] as const;

  return <>
    <PageHeader eyebrow="Editor contenuto" title={post.topic} description="Modifica copy e visuale prima dell’approvazione. Nessuna azione di questa pagina può fingere una pubblicazione live." action={<div className="card-actions"><Link className="button secondary" to="/app/calendar">Calendario</Link><Link className="button" to="/app/approvals">Anteprima e approvazione</Link></div>} />
    {message&&<Card><p role="status">{message}</p></Card>}
    <div className="editor-layout"><div className="stack">
      <Card><div className="row-between"><div><span className="eyebrow">Concept</span><h2>{concept.angle??post.topic}</h2></div><Badge tone={status==='Pronto'?'good':status==='Problema rilevato'?'warn':'info'}>{status}</Badge></div><div className="concept-grid"><ConceptField label="Stato" value={String(post.status).toUpperCase()}/><ConceptField label="Obiettivo" value={String(post.objective??concept.objective??'—')}/><ConceptField label="Topic" value={String(concept.topic??post.topic)}/><ConceptField label="Formato" value={String(post.format??'—')}/></div>{variants.length===0&&<div className="stack"><Badge tone="warn">OPENAI DA CONFIGURARE</Badge><p>Non esistono ancora varianti per questo contenuto. La generazione sarà disponibile solo tramite OpenAI lato server.</p><button className="button" disabled>Genera con OpenAI</button></div>}</Card>
      {variants.length>0&&<Card><div className="platform-tabs" role="tablist" aria-label="Varianti per canale">{variants.map((item:any)=><button key={item.id} role="tab" aria-selected={variant?.id===item.id} className={variant?.id===item.id?'active':''} onClick={()=>setVariantId(item.id)}>{platformName(item.platform)}</button>)}</div>{variant&&<><div className="variant-heading"><div><span className="eyebrow">Canale</span><h2>{platformName(variant.platform)}</h2></div><Badge tone={variant.platform_decision==='skip'?'neutral':variant.approval_status==='approved'?'good':'info'}>{variant.platform_decision==='skip'?'NON USATO':String(variant.approval_status).toUpperCase()}</Badge></div><p className="decision-reason">Consegna dopo approvazione: {variant.approval_mode==='auto'?'all’orario programmato':'su comando manuale'}</p><label className="editor-field"><span>Hook</span><textarea data-testid="variant-hook" value={draft.hook} onChange={(e)=>setDraft({...draft,hook:e.target.value})}/></label><label className="editor-field"><span>Caption</span><textarea data-testid="variant-caption" className="large" value={draft.caption} onChange={(e)=>setDraft({...draft,caption:e.target.value})}/></label><label className="editor-field"><span>CTA</span><input value={draft.cta} onChange={(e)=>setDraft({...draft,cta:e.target.value})}/></label><label className="editor-field"><span>Hashtag</span><input value={draft.hashtags} onChange={(e)=>setDraft({...draft,hashtags:e.target.value})}/></label><div className="editor-actions"><button data-testid="save-variant" className="button" onClick={()=>void save()}>Salva modifiche</button></div></>}</Card>}
      {variant&&variant.platform_decision!=='skip'&&<><Card><span className="eyebrow">Visuale</span><div className="row-between"><h2>{String(variant.visual_brief?.angle??variant.visual_brief?.subject??'Preview')}</h2><button data-testid="post-editor-media-picker" className="button secondary" onClick={()=>setShowMediaPicker(!showMediaPicker)}>Scegli asset reale</button></div><div className="visual-brief"><div className="visual-placeholder">{visual?.preview_urls?.[0]?<img loading="lazy" src={visual.preview_urls[0]} alt={String(variant.alt_text??post.topic)}/>:<><strong>Nessuna preview visuale</strong><small>Usa un asset reale oppure configura OpenAI Immagini 2.</small></>}</div><div><p>{String(variant.visual_brief?.description??'')}</p><p className="muted">Le immagini generate da AI saranno consentite esclusivamente tramite OpenAI Immagini 2.</p></div></div></Card>{showMediaPicker&&<MediaPicker variantId={variant.id} topic={post.topic} currentAssetId={visual?.selection?.selectedAssetId??visual?.visual_spec?.selection?.selectedAssetId??null} onClose={()=>setShowMediaPicker(false)} onSelected={(result)=>{setVisual(result);setShowMediaPicker(false);setMessage('Asset reale selezionato e preview aggiornata.')}}/>}</>}
    </div>
    <aside className="stack editor-sidebar"><Card><span className="eyebrow">Quality gate</span><h2>{status}</h2>{scores.map(([label,value])=><Score key={label} label={label} value={Math.round(Number(value??0)*100)}/>) }<Signal label="Duplicate risk" value={Number(quality.duplicateRisk??0).toFixed(2)}/></Card><Card><span className="eyebrow">Decisione umana</span><h2>{variant?String(variant.approval_status).toUpperCase():'Non generato'}</h2>{variant&&variant.platform_decision!=='skip'&&variant.approval_status==='pending'&&<div className="decision-buttons"><button data-testid="reject-variant" className="button secondary" onClick={()=>void reject()}>Non pubblicare</button><button data-testid="approve-variant" className="button" onClick={()=>void approve()}>Approva</button></div>}<p className="muted">Puoi prendere la stessa decisione dalla pagina Anteprime o, quando collegato, da Telegram.</p></Card></aside></div>
  </>;
}

function ConceptField({label,value}:{label:string;value:string}){return <div className="concept-field"><span>{label}</span><strong>{value}</strong></div>}
function Score({label,value}:{label:string;value:number}){return <Progress label={label} value={value} max={100}/>}
function Signal({label,value}:{label:string;value:string}){return <div className="signal-row"><span>{label}</span><strong>{value}</strong></div>}
function platformName(value:unknown){return value==='google_business_profile'?'Google Business Profile':String(value??'').replace(/^./,(c)=>c.toUpperCase())}
function qualityLabel(q:any){if(!q||Object.keys(q).length===0)return 'Da controllare';const fail=Number(q.brandMatch??0)<.8||Number(q.relevance??0)<.8||Number(q.factConfidence??0)<.75||Number(q.duplicateRisk??1)>=.84;return fail?'Problema rilevato':'Pronto'}
