import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Badge, Card, EmptyState, PageHeader } from '../components/ui';
import { useLocalE2E, type ApiPlatform } from '../services/local-e2e';

const platformLabel=(value:ApiPlatform|string)=>value==='google_business_profile'?'Google Business Profile':String(value).replace(/^./,(char)=>char.toUpperCase());

type QueueItem={post:any;variant:any};
type TelegramStatus={configured:boolean;status:string};

export function PersonalApprovalsPage(){
  const local=useLocalE2E();
  const [visuals,setVisuals]=useState<Record<string,any>>({});
  const [message,setMessage]=useState<string|null>(null);
  const [telegram,setTelegram]=useState<TelegramStatus|null>(null);
  const queue=useMemo<QueueItem[]>(()=>local.workspace?.posts.flatMap((post:any)=>post.variants.map((variant:any)=>({post,variant}))).filter(({variant}:QueueItem)=>variant.platform_decision!=='skip'&&(variant.approval_status==='pending'||(variant.approval_status==='approved'&&variant.status==='approved')))??[],[local.workspace]);

  useEffect(()=>{
    if(!local.tenantId)return;
    void local.api<TelegramStatus>(`/tenants/${local.tenantId}/telegram`).then(setTelegram).catch(()=>setTelegram(null));
  },[local.tenantId]);

  useEffect(()=>{
    if(!local.tenantId)return;
    for(const {variant} of queue){
      if(visuals[variant.id]!==undefined)continue;
      void local.api<any>(`/tenants/${local.tenantId}/variants/${variant.id}/visual`).then((value)=>setVisuals((current)=>({...current,[variant.id]:value??null}))).catch(()=>setVisuals((current)=>({...current,[variant.id]:null})));
    }
  },[local.tenantId,queue.length]);

  const action=async(kind:'approve'|'reject'|'publish'|'telegram',variant:any)=>{
    if(!local.tenantId)return;
    setMessage(null);
    try{
      if(kind==='approve')await local.api(`/tenants/${local.tenantId}/variants/${variant.id}/approve`,{method:'POST'});
      if(kind==='reject')await local.api(`/tenants/${local.tenantId}/variants/${variant.id}/reject`,{method:'POST',body:JSON.stringify({reason:'Non pubblicare · decisione Approval Center'})});
      if(kind==='publish')await local.api(`/tenants/${local.tenantId}/variants/${variant.id}/publish`,{method:'POST'});
      if(kind==='telegram')await local.api(`/tenants/${local.tenantId}/variants/${variant.id}/telegram-preview`,{method:'POST'});
      await local.refresh();
      setMessage(kind==='approve'?(variant.approval_mode==='auto'?'Approvato: sarà pubblicato all’orario programmato.':'Approvato. Ora puoi scegliere quando pubblicarlo.'):kind==='reject'?'Contenuto rifiutato: non verrà pubblicato.':kind==='publish'?'Pubblicazione messa in coda dopo la tua approvazione.':'Anteprima inviata a Telegram. La decisione presa lì verrà registrata.');
    }catch(e){setMessage(e instanceof Error?e.message:String(e));}
  };

  return <>
    <PageHeader eyebrow="Controllo umano" title="Anteprime da approvare" description="Vedi il contenuto prima che esca. Nessun post può essere pubblicato senza una tua decisione dal sito o da Telegram." action={<Badge tone={queue.length?'warn':'good'}>{queue.length} da decidere</Badge>}/>
    {message&&<Card><p role="status">{message}</p></Card>}
    {queue.length===0?<Card><EmptyState title="Nessuna decisione in attesa" body="Quando un contenuto sarà pronto, comparirà qui con copy, visuale, piattaforma e orario prima della pubblicazione."/></Card>:<div className="stack">{queue.map(({post,variant})=>{
      const visual=visuals[variant.id];
      const previewUrls=Array.isArray(visual?.preview_urls)?visual.preview_urls:[];
      const approved=variant.approval_status==='approved';
      return <Card key={variant.id} className="approval-visual-card">
        <div className="approval-preview">{previewUrls.length?previewUrls.map((src:string,index:number)=><img key={src} loading="lazy" src={src} alt={`${String(post.topic)} preview ${index+1}`}/>):<div className="visual-placeholder"><strong>Anteprima visuale non disponibile</strong><small>Usa un asset reale o configura OpenAI Immagini 2. Non viene generata un’immagine finta.</small></div>}</div>
        <div className="approval-copy">
          <div className="row-between"><div><strong>{String(post.topic??'Contenuto')}</strong><small>{platformLabel(variant.platform)} · {variant.format??'formato da definire'}</small></div><Badge tone={approved?'good':'info'}>{approved?'APPROVATO':'IN APPROVAZIONE'}</Badge></div>
          <small>{variant.scheduled_at?new Date(String(variant.scheduled_at)).toLocaleString('it-IT'):'Orario non impostato'}</small>
          {variant.hook&&<p><strong>{String(variant.hook)}</strong></p>}
          <p>{String(variant.caption??'')}</p>
          {Array.isArray(variant.hashtags)&&variant.hashtags.length>0&&<small>{variant.hashtags.join(' ')}</small>}
          <div className="approval-actions">
            {!approved&&<button data-testid={`approve-${variant.id}`} className="button" onClick={()=>void action('approve',variant)}>APPROVA</button>}
            {approved&&variant.approval_mode==='manual'&&<button className="button" onClick={()=>void action('publish',variant)}>PUBBLICA ORA</button>}
            {!approved&&<button className="button secondary" disabled={telegram?.status!=='connected'} title={telegram?.status==='connected'?'Invia la stessa anteprima a Telegram':'Collega Telegram in Social'} onClick={()=>void action('telegram',variant)}>INVIA A TELEGRAM</button>}
            <Link className="button secondary" to={`/app/posts/${post.id}`}>MODIFICA</Link>
            {!approved&&<button className="danger-text" onClick={()=>void action('reject',variant)}>NON PUBBLICARE</button>}
          </div>
          {telegram?.status!=='connected'&&<small>Telegram: {telegram?.configured?'non collegato':'da configurare'} · puoi comunque approvare dal sito.</small>}
        </div>
      </Card>;
    })}</div>}
  </>;
}
