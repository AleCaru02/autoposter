import { useEffect, useMemo, useState } from 'react';
import { Badge, Card, EmptyState, MetricCard, PageHeader } from '../components/ui';
import { useLocalE2E } from '../services/local-e2e';

const listText=(value:unknown)=>Array.isArray(value)?value.join(', '):String(value??'');
const splitList=(value:string)=>value.split(',').map((item)=>item.trim()).filter(Boolean);
const pillarText=(strategy:any)=>{
  const manual=strategy?.content_mix?.manualPillars;
  if(Array.isArray(manual))return manual.join(', ');
  const generated=strategy?.content_mix?.pillars;
  if(Array.isArray(generated))return generated.map((item:any)=>String(item?.name??item)).filter(Boolean).join(', ');
  return '';
};

export function PersonalStrategyPage(){
  const local=useLocalE2E();
  const strategy=local.workspace?.strategy as any;
  const onboarding=local.workspace?.onboarding as any;
  const aiReady=Boolean(local.health?.testFixtures||local.health?.capabilities?.openai);
  const [objectives,setObjectives]=useState('');
  const [audience,setAudience]=useState('');
  const [pillars,setPillars]=useState('');
  const [preferredThemes,setPreferredThemes]=useState('');
  const [avoidThemes,setAvoidThemes]=useState('');
  const [days,setDays]=useState('');
  const [times,setTimes]=useState('');
  const [postsPerWeek,setPostsPerWeek]=useState(3);
  const [message,setMessage]=useState<string|null>(null);
  const [working,setWorking]=useState(false);

  useEffect(()=>{
    setObjectives(listText(strategy?.objectives??onboarding?.goals??[]));
    setAudience(listText(strategy?.audience?.segments??onboarding?.target?.manual??[]));
    setPillars(pillarText(strategy));
    setPreferredThemes(listText(strategy?.platform_strategy?.preferredThemes??[]));
    setAvoidThemes(listText(strategy?.platform_strategy?.avoidThemes??[]));
    setDays(listText(strategy?.scheduling_preferences?.days??strategy?.scheduling_preferences?.preferredDays??onboarding?.frequency?.days??[]));
    setTimes(listText(strategy?.scheduling_preferences?.times??strategy?.scheduling_preferences?.preferredTimes??onboarding?.frequency?.times??[]));
    setPostsPerWeek(Number(strategy?.scheduling_preferences?.postsPerWeek??onboarding?.frequency?.postsPerWeek??3));
  },[strategy,onboarding]);

  const save=async()=>{
    if(!local.tenantId)return;
    setMessage(null);
    try{
      await local.api(`/tenants/${local.tenantId}/strategy/preferences`,{method:'PATCH',body:JSON.stringify({
        objectives:splitList(objectives),
        audience:{segments:splitList(audience),source:'manual'},
        contentMix:{manualPillars:splitList(pillars),source:'manual'},
        platformStrategy:{preferredThemes:splitList(preferredThemes),avoidThemes:splitList(avoidThemes),source:'manual'},
        schedulingPreferences:{postsPerWeek,days:splitList(days).map(Number).filter(Number.isFinite),times:splitList(times),source:'manual'},
      })});
      await local.api(`/tenants/${local.tenantId}/onboarding`,{method:'PATCH',body:JSON.stringify({frequency:{postsPerWeek,days:splitList(days).map(Number).filter(Number.isFinite),times:splitList(times)}})}).catch(()=>undefined);
      await local.refresh();setMessage('Strategia e frequenza salvate per questa attività.');
    }catch(error){setMessage(error instanceof Error?error.message:String(error));}
  };
  const regenerate=async()=>{
    if(!local.tenantId||!aiReady)return;
    setWorking(true);setMessage(null);
    try{await local.api(`/tenants/${local.tenantId}/strategy`,{method:'POST'});await local.refresh();setMessage('Strategia rigenerata con OpenAI usando il Brand Profile e le preferenze di questa attività.');}
    catch(error){setMessage(error instanceof Error?error.message:String(error));}
    finally{setWorking(false);}
  };

  return <>
    <PageHeader eyebrow="Strategia" title="Regole editoriali dell’attività" description="Puoi impostare le regole manualmente oppure rigenerare la strategia con OpenAI quando il backend lo conferma disponibile. Le metriche reali restano distinte dagli insight AI." action={<div className="card-actions"><button className="button secondary" data-testid="regenerate-strategy" disabled={!aiReady||!local.tenantId||working} title={aiReady?'Rigenera con OpenAI':'OpenAI non configurato'} onClick={()=>void regenerate()}>{working?'Generazione…':'Rigenera con OpenAI'}</button><button className="button" onClick={()=>void save()}>Salva strategia</button></div>}/>
    {message&&<Card><p role="status">{message}</p></Card>}
    {!aiReady&&<Card><Badge tone="warn">OPENAI DA CONFIGURARE</Badge><p>La modifica manuale resta disponibile; la rigenerazione AI non viene simulata.</p></Card>}
    <div className="two-col">
      <Card><label className="field"><span>Obiettivi</span><input value={objectives} onChange={(e)=>setObjectives(e.target.value)} placeholder="lead, vendite, notorietà"/></label><label className="field"><span>Audience / segmenti</span><textarea value={audience} onChange={(e)=>setAudience(e.target.value)} placeholder="proprietari, clienti locali..."/></label><label className="field"><span>Pillar editoriali</span><textarea value={pillars} onChange={(e)=>setPillars(e.target.value)} placeholder="educazione, servizio, dietro le quinte"/></label></Card>
      <Card><label className="field"><span>Temi da spingere</span><textarea value={preferredThemes} onChange={(e)=>setPreferredThemes(e.target.value)}/></label><label className="field"><span>Temi da evitare</span><textarea value={avoidThemes} onChange={(e)=>setAvoidThemes(e.target.value)}/></label></Card>
    </div>
    <Card><span className="eyebrow">Frequenza per questa attività</span><div className="three-col"><label className="field"><span>Post/settimana</span><input type="number" min="1" max="21" value={postsPerWeek} onChange={(e)=>setPostsPerWeek(Number(e.target.value))}/></label><label className="field"><span>Giorni ISO (1=lunedì)</span><input value={days} onChange={(e)=>setDays(e.target.value)} placeholder="1, 3, 5"/></label><label className="field"><span>Orari</span><input value={times} onChange={(e)=>setTimes(e.target.value)} placeholder="10:00, 18:00"/></label></div><p className="muted">Quando saranno disponibili metriche reali, eventuali suggerimenti di modifica dovranno mostrare evidenza e confidenza prima di cambiare queste regole.</p></Card>
    <Card><div className="row-between"><div><span className="eyebrow">Apprendimento</span><h2>Evidenze disponibili</h2></div><Badge tone={(local.workspace?.insights.length??0)>0?'info':'neutral'}>{local.workspace?.insights.length??0} insight</Badge></div>{(local.workspace?.insights.length??0)===0?<EmptyState title="Nessuna evidenza sufficiente" body="Servono pubblicazioni e metriche reali prima di consigliare cambi di temi, giorni, orari o formati."/>:<div className="stack">{local.workspace?.insights.map((item:any)=><div className="list-row" key={item.id}><Badge tone={Number(item.confidence)>=0.7?'good':'info'}>{Math.round(Number(item.confidence??0)*100)}%</Badge><div className="grow"><strong>{String(item.title??'Insight')}</strong><small>{String(item.body??'')}</small></div></div>)}</div>}</Card>
  </>;
}

export function PersonalAnalyticsPage(){
  const local=useLocalE2E();
  const snapshots=local.workspace?.analytics??[];
  const published=local.workspace?.published??[];
  const metrics=useMemo(()=>snapshots.reduce((acc:Record<string,number>,snapshot:any)=>{for(const [key,value] of Object.entries(snapshot.metrics??{})){if(typeof value==='number')acc[key]=(acc[key]??0)+value;}return acc;},{}),[snapshots]);
  const latest=snapshots[0] as any;
  return <>
    <PageHeader eyebrow="Analytics" title="Performance reali" description="Questa pagina usa soltanto snapshot raccolti dai provider collegati. Se non ci sono dati, resta vuota."/>
    <div className="metric-grid"><MetricCard label="Impressions" value={String(metrics.impressions??0)} hint={snapshots.length?'Dati provider':'Nessun dato'}/><MetricCard label="Reach" value={String(metrics.reach??0)} hint={snapshots.length?'Dati provider':'Nessun dato'}/><MetricCard label="Engagement" value={String(metrics.engagements??metrics.engagement??0)} hint={snapshots.length?'Dati provider':'Nessun dato'}/><MetricCard label="Pubblicazioni tracciate" value={String(published.length)} hint="Con ID provider"/></div>
    {snapshots.length===0?<Card><EmptyState title="Nessuna metrica disponibile" body="Collega almeno un social, pubblica contenuti approvati e abilita la raccolta metriche reale. Non mostriamo numeri dimostrativi."/></Card>:<>
      <Card><div className="row-between"><div><span className="eyebrow">Ultimo snapshot</span><h2>{latest?.platform?String(latest.platform):'Provider'}</h2></div><Badge tone="good">DATI RACCOLTI</Badge></div><p>{latest?.snapshot_at?new Date(String(latest.snapshot_at)).toLocaleString('it-IT'):'—'}</p><div className="signal-list">{Object.entries(latest?.metrics??{}).filter(([,value])=>typeof value==='number').map(([key,value])=><div className="signal-row" key={key}><span>{key}</span><strong>{String(value)}</strong></div>)}</div></Card>
      <Card><span className="eyebrow">Apprendimento</span><h2>Decisioni basate su evidenze</h2><p className="muted">Il sistema può proporre cambi solo quando il campione minimo e la qualità dei dati sono sufficienti. Ogni suggerimento deve restare distinto da un’impostazione manuale.</p></Card>
    </>}
  </>;
}
