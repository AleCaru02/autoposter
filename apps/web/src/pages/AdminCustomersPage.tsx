import { useEffect, useState } from 'react';
import { Badge, Card, EmptyState, MetricCard, PageHeader } from '../components/ui';
import { internalE2EFixturesEnabled, useLocalE2E } from '../services/local-e2e';

type AdminSnapshot = {
  users:any[]; tenants:any[]; members:any[]; plans:any[]; subscriptions:any[]; overrides:any[];
  usage:any[]; aiUsage:any[]; aiBudgets:any[]; jobs:any[]; connections:any[]; audit:any[]; deletions:any[];
};
type Provider='openai'|'meta'|'linkedin'|'google_business_profile'|'telegram';
type PlatformSetting={
  provider:Provider; configured:boolean; configuredFields:string[]; publicConfig:Record<string,unknown>;
  updatedAt:string|null; runtimeAdapter:'real'|'not_yet_live'; liveCapable:boolean;
};
type ProviderField={key:string;label:string;secret:boolean;placeholder:string;multiline?:boolean};
const labels:Record<Provider,string>={
  openai:'OpenAI',meta:'Meta · Instagram/Facebook',linkedin:'LinkedIn',
  google_business_profile:'Google Business Profile',telegram:'Telegram',
};
const providerOrder:Provider[]=['openai','meta','linkedin','google_business_profile','telegram'];
const tabs=['overview','users','activities','integrations','system'] as const;
type Tab=typeof tabs[number];

export function AdminCustomersPage(){
  const local=useLocalE2E();
  const [data,setData]=useState<AdminSnapshot|null>(null);
  const [settings,setSettings]=useState<PlatformSetting[]>([]);
  const [tab,setTab]=useState<Tab>('overview');
  const [message,setMessage]=useState<string|null>(null);
  const [accessDenied,setAccessDenied]=useState(false);
  const [loading,setLoading]=useState(false);
  const [tenantId,setTenantId]=useState('');

  const load=async()=>{
    setLoading(true);setMessage(null);
    try{
      const snapshot=await local.api<AdminSnapshot>('/admin/customers');
      const platform=internalE2EFixturesEnabled
        ? [] as PlatformSetting[]
        : await local.api<PlatformSetting[]>('/admin/platform-settings').catch(()=>[] as PlatformSetting[]);
      setData(snapshot);setSettings(platform);setAccessDenied(false);
      if(!tenantId&&snapshot.tenants[0])setTenantId(String(snapshot.tenants[0].id));
    }catch(error){
      const text=error instanceof Error?error.message:String(error);
      if(/platform_admin_required|forbidden|amministratore/i.test(text)){setAccessDenied(true);setData(null);}
      else setMessage(text);
    }finally{setLoading(false);}
  };

  useEffect(()=>{if(local.enabled&&local.token)void load();},[local.enabled,local.token]);

  if(!local.enabled)return <><PageHeader eyebrow="Master" title="Control room" description="Backend non collegato."/><Card><EmptyState title="NON DISPONIBILE" body="La console master richiede il backend reale."/></Card></>;
  if(!local.token)return <><PageHeader eyebrow="Master" title="Control room" description="Accedi con l’account master."/><Card><EmptyState title="Sessione richiesta" body="Questa area è protetta lato server."/></Card></>;
  if(accessDenied)return <><PageHeader eyebrow="Master" title="Accesso negato" description="Questo account non ha il ruolo platform admin."/><Card><EmptyState title="Account non master" body="Il server ha rifiutato l’accesso alla console amministrativa."/></Card></>;

  const failedJobs=data?.jobs.filter((job:any)=>job.status==='failed').length??0;
  const connected=data?.connections.filter((item:any)=>item.connection_status==='connected').length??0;
  const activeTenants=data?.tenants.filter((item:any)=>item.status==='active').length??0;
  const verifiedUsers=data?.users.filter((item:any)=>item.emailVerified===true||item.email_confirmed_at).length??0;

  const changeTenantStatus=async(status:'active'|'suspended')=>{
    if(!tenantId)return;
    setMessage(null);
    try{
      await local.api(`/admin/tenants/${tenantId}/status`,{method:'PATCH',body:JSON.stringify({status})});
      setMessage(status==='active'?'Attività riattivata.':'Attività sospesa.');
      await load();
    }catch(error){setMessage(error instanceof Error?error.message:String(error));}
  };

  return <>
    <PageHeader eyebrow="MASTER CONTROL" title="Post Automatici · Control Room" description="Gestisci utenti, attività, API e stato operativo. Le password utenti non sono leggibili dall’amministratore." action={<button className="button" onClick={()=>void load()} disabled={loading}>{loading?'Aggiorno…':'Aggiorna'}</button>}/>
    {message&&<Card><p role="status"><strong>Stato:</strong> {message}</p></Card>}
    <Card><div className="filter-row">{tabs.map((item)=><button key={item} className={`filter ${tab===item?'active':''}`} onClick={()=>setTab(item)}>{tabLabel(item)}</button>)}</div></Card>
    {tab==='overview'&&<Overview data={data} settings={settings} failedJobs={failedJobs} connected={connected} activeTenants={activeTenants}/>} 
    {tab==='users'&&<UsersPanel data={data} verifiedUsers={verifiedUsers}/>} 
    {tab==='activities'&&<ActivitiesPanel data={data} tenantId={tenantId} setTenantId={setTenantId} onStatus={changeTenantStatus}/>} 
    {tab==='integrations'&&<IntegrationsPanel settings={settings} local={local} onChanged={load} setMessage={setMessage}/>} 
    {tab==='system'&&<SystemPanel local={local} data={data}/>} 
  </>;
}

function Overview({data,settings,failedJobs,connected,activeTenants}:{data:AdminSnapshot|null;settings:PlatformSetting[];failedJobs:number;connected:number;activeTenants:number}){
  return <>
    <div className="metric-grid">
      <MetricCard label="Utenti" value={String(data?.users.length??0)} hint="Account Auth reali"/>
      <MetricCard label="Attività attive" value={String(activeTenants)} hint={`${data?.tenants.length??0} totali`}/>
      <MetricCard label="Social connessi" value={String(connected)} hint="Connessioni reali persistite"/>
      <MetricCard label="Job falliti" value={String(failedJobs)} hint={`${data?.jobs.length??0} job registrati`}/>
    </div>
    <div className="two-col">
      <Card><span className="eyebrow">Integrazioni piattaforma</span><h2>Stato configurazione</h2><div className="signal-list">{providerOrder.map((provider)=>{const item=settings.find((row)=>row.provider===provider);return <div className="signal-row" key={provider}><span>{labels[provider]}</span><Badge tone={item?.configured?'good':'warn'}>{item?.configured?'CREDENZIALI SALVATE':'DA CONFIGURARE'}</Badge></div>;})}</div></Card>
      <Card><span className="eyebrow">Sicurezza</span><h2>Regole master</h2><ul className="check-list"><li>Password utenti: mai disponibili in chiaro</li><li>Segreti API: cifrati lato server</li><li>Pubblicazione: approvazione umana obbligatoria</li><li>Provider non collegati: nessun dato inventato</li></ul></Card>
    </div>
  </>;
}

function UsersPanel({data,verifiedUsers}:{data:AdminSnapshot|null;verifiedUsers:number}){
  const memberships=data?.members??[];
  return <>
    <div className="metric-grid"><MetricCard label="Account" value={String(data?.users.length??0)} hint="Neon Auth"/><MetricCard label="Email verificate" value={String(verifiedUsers)} hint="Stato Auth"/><MetricCard label="Membership" value={String(memberships.length)} hint="Accessi alle attività"/><MetricCard label="Password visibili" value="0" hint="Per progettazione"/></div>
    <Card>
      <div className="row-between"><div><span className="eyebrow">Utenti</span><h2>Tutti gli account</h2></div><Badge tone="good">MASTER VIEW</Badge></div>
      {!data?.users.length?<EmptyState title="Nessun utente" body="Non risultano account Auth."/>:<div className="stack">{data.users.map((user:any)=><div className="list-row" key={String(user.id)}><div className="avatar">{initials(String(user.name??user.email??'U'))}</div><div className="grow"><strong>{String(user.name??'Utente')}</strong><small>{String(user.email??'—')}</small></div><div><Badge tone={user.banned?'warn':'good'}>{user.banned?'BLOCCATO':'ATTIVO'}</Badge><small>{memberships.filter((m:any)=>m.user_id===user.id&&m.status==='active').length} attività</small></div></div>)}</div>}
    </Card>
    <Card><span className="eyebrow">Password</span><h2>Perché non le vedi</h2><p>Le password vengono gestite dal provider Auth e non sono recuperabili in chiaro. Il master può vedere utenti, stato, attività e permessi, ma non le loro password.</p></Card>
  </>;
}

function ActivitiesPanel({data,tenantId,setTenantId,onStatus}:{data:AdminSnapshot|null;tenantId:string;setTenantId:(value:string)=>void;onStatus:(status:'active'|'suspended')=>Promise<void>}){
  const selected=data?.tenants.find((item:any)=>String(item.id)===tenantId);
  return <div className="two-col">
    <Card>
      <span className="eyebrow">Attività</span><h2>{data?.tenants.length??0} profili</h2>
      <label className="field"><span>Seleziona attività</span><select value={tenantId} onChange={(event)=>setTenantId(event.target.value)}><option value="" disabled>Seleziona</option>{data?.tenants.map((tenant:any)=><option key={tenant.id} value={tenant.id}>{tenant.name} · {tenant.status}</option>)}</select></label>
      {selected&&<div className="signal-list"><div className="signal-row"><span>Stato</span><Badge tone={selected.status==='active'?'good':'warn'}>{String(selected.status).toUpperCase()}</Badge></div><div className="signal-row"><span>Onboarding</span><strong>{String(selected.onboarding_status??'—')}</strong></div><div className="signal-row"><span>Membri</span><strong>{data?.members.filter((m:any)=>m.tenant_id===tenantId&&m.status==='active').length??0}</strong></div></div>}
    </Card>
    <Card><span className="eyebrow">Controlli</span><h2>Stato attività</h2><p className="muted">Queste azioni modificano realmente lo stato lato server.</p><div className="card-actions"><button className="button secondary" disabled={!tenantId} onClick={()=>void onStatus('suspended')}>Sospendi</button><button className="button" disabled={!tenantId} onClick={()=>void onStatus('active')}>Riattiva</button></div></Card>
  </div>;
}

function IntegrationsPanel({settings,local,onChanged,setMessage}:{settings:PlatformSetting[];local:ReturnType<typeof useLocalE2E>;onChanged:()=>Promise<void>;setMessage:(value:string|null)=>void}){
  return <div className="stack">{providerOrder.map((provider)=><ProviderCard
    key={provider}
    provider={provider}
    setting={settings.find((item)=>item.provider===provider)}
    save={async(input)=>{setMessage(null);try{await local.api(`/admin/platform-settings/${provider}`,{method:'PATCH',body:JSON.stringify(input)});setMessage(`${labels[provider]}: configurazione salvata in modo cifrato.`);await onChanged();}catch(error){setMessage(error instanceof Error?error.message:String(error));}}}
    remove={async()=>{setMessage(null);try{await local.api(`/admin/platform-settings/${provider}`,{method:'DELETE'});setMessage(`${labels[provider]}: configurazione rimossa.`);await onChanged();}catch(error){setMessage(error instanceof Error?error.message:String(error));}}}
  />)}</div>;
}

function ProviderCard({provider,setting,save,remove}:{provider:Provider;setting?:PlatformSetting;save:(input:Record<string,unknown>)=>Promise<void>;remove:()=>Promise<void>}){
  const [fields,setFields]=useState<Record<string,string>>({});
  const schema=providerFields(provider);
  return <Card>
    <div className="row-between"><div><span className="eyebrow">API</span><h2>{labels[provider]}</h2></div><div className="card-actions"><Badge tone={setting?.configured?'good':'warn'}>{setting?.configured?'SALVATA':'DA CONFIGURARE'}</Badge><Badge tone={setting?.runtimeAdapter==='real'?'good':'neutral'}>{setting?.runtimeAdapter==='real'?'RUNTIME REALE':'ADAPTER NON LIVE'}</Badge></div></div>
    {provider!=='openai'&&<p className="muted">Puoi salvare ora le credenziali. Non mostriamo “connesso” finché l’OAuth/provider reale non è implementato e verificato.</p>}
    {provider==='openai'&&<p className="muted">La chiave e il catalogo prezzi vengono usati dal motore reale dopo il salvataggio. Le immagini sono vincolate a gpt-image-2.</p>}
    <div className="two-col">{schema.map((field)=><label className="field" key={field.key}><span>{field.label}{setting?.configuredFields.includes(field.key)?' · già salvato':''}</span>{field.multiline?<textarea value={fields[field.key]??''} placeholder={field.placeholder} onChange={(e)=>setFields({...fields,[field.key]:e.target.value})}/>:<input type={field.secret?'password':'text'} value={fields[field.key]??''} placeholder={maskedPlaceholder(setting,field.key,field.placeholder)} onChange={(e)=>setFields({...fields,[field.key]:e.target.value})}/>}</label>)}</div>
    <div className="card-actions"><button className="button" onClick={()=>void save(fields)}>Salva configurazione</button>{setting?.configured&&<button className="button secondary" onClick={()=>void remove()}>Rimuovi</button>}</div>
  </Card>;
}

function SystemPanel({local,data}:{local:ReturnType<typeof useLocalE2E>;data:AdminSnapshot|null}){
  const health=local.health;
  return <>
    <div className="metric-grid"><MetricCard label="Database" value={health?.capabilities?.database?'OK':'NO'} hint={health?.capabilities?.databaseProvider??'—'}/><MetricCard label="Auth" value={health?.capabilities?.auth?'OK':'NO'} hint="Neon Auth"/><MetricCard label="OpenAI" value={health?.capabilities?.openai?'OK':'NO'} hint={health?.capabilities?.openaiTextModel??'da configurare'}/><MetricCard label="Immagini 2" value={health?.capabilities?.openaiImages2?'OK':'NO'} hint={health?.capabilities?.openaiImageModel??'gpt-image-2'}/></div>
    <Card><span className="eyebrow">Diagnostica</span><h2>Stato operativo</h2><div className="signal-list"><div className="signal-row"><span>Job persistiti</span><strong>{data?.jobs.length??0}</strong></div><div className="signal-row"><span>Audit log</span><strong>{data?.audit.length??0}</strong></div><div className="signal-row"><span>Eventi AI</span><strong>{data?.aiUsage.length??0}</strong></div><div className="signal-row"><span>Connessioni social</span><strong>{data?.connections.length??0}</strong></div></div></Card>
  </>;
}

function providerFields(provider:Provider):ProviderField[]{
  if(provider==='openai')return[
    {key:'apiKey',label:'OpenAI API key',secret:true,placeholder:'sk-…'},
    {key:'pricingJson',label:'Catalogo prezzi JSON',secret:false,multiline:true,placeholder:'{"version":"...","models":{...}}'},
    {key:'economyModel',label:'Modello economy',secret:false,placeholder:'gpt-5.6-luna'},
    {key:'standardModel',label:'Modello standard',secret:false,placeholder:'gpt-5.6-terra'},
    {key:'premiumModel',label:'Modello premium',secret:false,placeholder:'gpt-5.6-sol'},
    {key:'imageModel',label:'Modello immagini',secret:false,placeholder:'gpt-image-2'},
  ];
  if(provider==='meta')return[{key:'appId',label:'Meta App ID',secret:false,placeholder:'App ID'},{key:'appSecret',label:'Meta App Secret',secret:true,placeholder:'••••••'}];
  if(provider==='linkedin')return[{key:'clientId',label:'LinkedIn Client ID',secret:false,placeholder:'Client ID'},{key:'clientSecret',label:'LinkedIn Client Secret',secret:true,placeholder:'••••••'}];
  if(provider==='google_business_profile')return[{key:'clientId',label:'Google Client ID',secret:false,placeholder:'Client ID'},{key:'clientSecret',label:'Google Client Secret',secret:true,placeholder:'••••••'}];
  return[{key:'botToken',label:'Telegram Bot Token',secret:true,placeholder:'••••••'},{key:'webhookSecret',label:'Webhook Secret',secret:true,placeholder:'••••••'}];
}
function maskedPlaceholder(setting:PlatformSetting|undefined,key:string,fallback:string){const value=setting?.publicConfig?.[`${key}Masked`];return typeof value==='string'?value:fallback;}
function tabLabel(tab:Tab){return({overview:'Panoramica',users:'Utenti',activities:'Attività',integrations:'API & integrazioni',system:'Sistema'})[tab];}
function initials(value:string){return value.split(/\s+|@/).filter(Boolean).slice(0,2).map((part)=>part[0]?.toUpperCase()).join('')||'U';}
