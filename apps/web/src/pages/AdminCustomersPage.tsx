import { useEffect, useMemo, useState } from 'react';
import { Badge, Card, EmptyState, MetricCard, PageHeader } from '../components/ui';
import { internalE2EFixturesEnabled, useLocalE2E } from '../services/local-e2e';

type AdminSnapshot={users:any[];tenants:any[];members:any[];plans:any[];subscriptions:any[];overrides:any[];usage:any[];aiUsage:any[];aiBudgets:any[];jobs:any[];connections:any[];audit:any[];deletions:any[]};
const money=(microunits:number)=>`$${(microunits/1_000_000).toFixed(4)}`;

export function AdminCustomersPage(){
  const local=useLocalE2E();
  const [data,setData]=useState<AdminSnapshot|null>(null);
  const [tenantId,setTenantId]=useState('');
  const [planCode,setPlanCode]=useState('');
  const [message,setMessage]=useState<string|null>(null);
  const [accessDenied,setAccessDenied]=useState(false);
  const [checkingAccess,setCheckingAccess]=useState(false);
  const [soft,setSoft]=useState('5000000');
  const [hard,setHard]=useState('10000000');
  const [overridePosts,setOverridePosts]=useState('');
  const [overridePages,setOverridePages]=useState('');
  const selected=useMemo(()=>data?.tenants.find((item)=>item.id===tenantId)??null,[data,tenantId]);
  const tenantUsage=useMemo(()=>data?.usage.filter((item)=>item.tenant_id===tenantId)??[],[data,tenantId]);
  const tenantAi=useMemo(()=>data?.aiUsage.filter((item)=>item.tenant_id===tenantId)??[],[data,tenantId]);
  const tenantFailures=useMemo(()=>data?.jobs.filter((item)=>item.tenant_id===tenantId&&item.status==='failed')??[],[data,tenantId]);

  const load=async()=>{
    setCheckingAccess(true);
    try{
      const next=await local.api<AdminSnapshot>('/admin/customers');
      setData(next);
      setAccessDenied(false);
      if(!tenantId&&next.tenants[0])setTenantId(String(next.tenants[0].id));
      if(!planCode&&next.plans[0])setPlanCode(String(next.plans[0].code));
      setMessage(null);
    }catch(e){
      const error=e instanceof Error?e.message:String(e);
      if(/platform_admin_required|accesso.*admin|forbidden|amministratore/i.test(error)){
        setAccessDenied(true);
        setData(null);
        setMessage(null);
      }else{
        setMessage(error);
      }
    }finally{
      setCheckingAccess(false);
    }
  };
  const claim=async()=>{await local.api('/dev/grant-platform-admin',{method:'POST'});await load();};
  const act=async(path:string,method:'POST'|'PATCH',body:unknown)=>{try{await local.api(path,{method,body:JSON.stringify(body)});setMessage('Modifica salvata lato server.');await load();}catch(e){setMessage(e instanceof Error?e.message:String(e));}};

  useEffect(()=>{
    if(local.enabled&&local.token)void load();
    // Re-check only when the authenticated session changes. Manual refreshes remain explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[local.enabled,local.token]);

  if(!local.enabled)return <><PageHeader eyebrow="Admin" title="Clienti e piani" description="Backend non collegato."/><Card><EmptyState title="NON COLLEGATO" body="La console admin richiede Supabase/API."/></Card></>;
  if(!local.token)return <><PageHeader eyebrow="Admin" title="Accesso amministratore richiesto" description="Accedi prima di verificare i permessi della console."/><Card><EmptyState title="Accesso amministratore richiesto" body="Questa area non è disponibile senza una sessione autenticata."/></Card></>;
  if(accessDenied)return <><PageHeader eyebrow="Admin" title="Accesso amministratore richiesto" description="Il server ha verificato la sessione: questo account non possiede il ruolo platform admin."/><Card><EmptyState title="Accesso amministratore richiesto" body="La console clienti, piani e diagnostica è protetta da RBAC server-side."/>{internalE2EFixturesEnabled?<button className="button secondary" onClick={()=>void claim()}>Claim admin locale</button>:null}</Card></>;
  if(checkingAccess&&!data)return <><PageHeader eyebrow="Admin" title="Verifica permessi amministratore" description="Controllo del ruolo sul server in corso."/><Card><p className="muted">Verifica accesso amministratore…</p></Card></>;

  const failedJobs=data?.jobs.filter((job)=>job.status==='failed').length??0;
  const estimated=(data?.aiUsage??[]).reduce((sum,event)=>sum+Number(event.actual_cost_microunits??event.estimated_cost_microunits??0),0);

  return <>
    <PageHeader eyebrow="Platform admin" title="Clienti, piani e operazioni" description="Il prodotto ha un unico stato operativo. Qui si gestiscono accessi, limiti e diagnostica; non esistono modalità demo/reale." action={<div className="card-actions">{internalE2EFixturesEnabled?<button className="button secondary" onClick={()=>void claim()}>Claim admin locale</button>:null}<button data-testid="load-admin" className="button" onClick={()=>void load()}>Aggiorna</button></div>}/>
    {message&&<Card><p role="status">{message}</p></Card>}
    {!data?<Card><EmptyState title="Console amministratore" body="I dati vengono mostrati soltanto dopo una verifica RBAC server-side riuscita."/></Card>:<>
      <div className="metric-grid"><MetricCard label="Utenti Auth" value={String(data.users.length)} hint="Supabase Auth"/><MetricCard label="Attività" value={String(data.tenants.length)} hint={`${data.tenants.filter((t)=>t.status==='suspended').length} sospese`}/><MetricCard label="AI ledger" value={money(estimated)} hint={`${data.aiUsage.length} eventi`}/><MetricCard label="Scheduler failures" value={String(failedJobs)} hint={`${data.jobs.length} job persistiti`}/></div>
      <div className="two-col">
        <Card><h2>Attività</h2><label>Seleziona<select value={tenantId} onChange={(e)=>setTenantId(e.target.value)}>{data.tenants.map((tenant)=><option key={tenant.id} value={tenant.id}>{tenant.name} · {tenant.status}</option>)}</select></label>{selected&&<div className="signal-list"><div className="signal-row"><span>Stato</span><Badge tone={selected.status==='active'?'good':'warn'}>{selected.status}</Badge></div><div className="signal-row"><span>Membership</span><strong>{data.members.filter((m)=>m.tenant_id===tenantId&&m.status==='active').length}</strong></div><div className="signal-row"><span>Connessioni social</span><strong>{data.connections.filter((c)=>c.tenant_id===tenantId).length}</strong></div></div>}</Card>
        <Card><h2>Piano manuale</h2><label>Piano<select value={planCode} onChange={(e)=>setPlanCode(e.target.value)}>{data.plans.map((plan)=><option key={plan.id} value={plan.code}>{plan.name} · {plan.code}</option>)}</select></label><button className="button" disabled={!tenantId||!planCode} onClick={()=>void act(`/admin/tenants/${tenantId}/plan`,'POST',{planCode})}>Assegna / modifica piano</button></Card>
      </div>
      <div className="three-col">
        <Card><h2>Accesso attività</h2><div className="card-actions"><button className="button secondary" disabled={!tenantId} onClick={()=>void act(`/admin/tenants/${tenantId}/status`,'PATCH',{status:'suspended'})}>Sospendi</button><button className="button" disabled={!tenantId} onClick={()=>void act(`/admin/tenants/${tenantId}/status`,'PATCH',{status:'active'})}>Riattiva</button></div></Card>
        <Card><h2>Override quote</h2><label>Post/settimana<input value={overridePosts} onChange={(e)=>setOverridePosts(e.target.value)} placeholder="es. 7" inputMode="numeric"/></label><label>Pagine website scan<input value={overridePages} onChange={(e)=>setOverridePages(e.target.value)} placeholder="es. 25" inputMode="numeric"/></label><button className="button secondary" disabled={!tenantId||(!overridePosts&&!overridePages)} onClick={()=>{const overrides:Record<string,number>={};if(overridePosts)overrides.posts_per_week=Number(overridePosts);if(overridePages)overrides.website_page_limit=Number(overridePages);void act(`/admin/tenants/${tenantId}/overrides`,'PATCH',{overrides,reason:'Manual admin quota'});}}>Salva override</button></Card>
        <Card><h2>Stato integrazioni</h2><p>Le integrazioni sono operative soltanto quando le rispettive API risultano realmente configurate.</p><Badge tone="warn">VERIFICA PROVIDER SEPARATA</Badge></Card>
      </div>
      <div className="two-col">
        <Card><h2>Budget AI attività</h2><label>Soft limit microunits<input value={soft} onChange={(e)=>setSoft(e.target.value)}/></label><label>Hard limit microunits<input value={hard} onChange={(e)=>setHard(e.target.value)}/></label><button className="button" disabled={!tenantId} onClick={()=>void act(`/admin/tenants/${tenantId}/ai-budget`,'PATCH',{currency:'USD',softLimitMicrounits:Number(soft),hardLimitMicrounits:Number(hard),enabled:true})}>Imposta budget</button></Card>
        <Card><h2>Diagnostica</h2><div className="signal-row"><span>Usage counters</span><strong>{tenantUsage.length}</strong></div><div className="signal-row"><span>AI events</span><strong>{tenantAi.length}</strong></div><div className="signal-row"><span>Job falliti</span><strong>{tenantFailures.length}</strong></div><div className="signal-row"><span>Audit entries</span><strong>{data.audit.filter((x)=>x.tenant_id===tenantId).length}</strong></div></Card>
      </div>
      <Card><h2>Richieste cancellazione</h2>{data.deletions.length===0?<p className="muted">Nessuna richiesta.</p>:data.deletions.map((item)=><div className="signal-row" key={item.id}><span>{item.scope} · {item.status}</span><strong>{item.requesting_user_id}</strong></div>)}</Card>
    </>}
  </>;
}