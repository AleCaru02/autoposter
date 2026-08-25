import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Badge, Card, EmptyState, PageHeader } from '../components/ui';
import { useLocalE2E } from '../services/local-e2e';

type Mode='economy'|'balanced'|'quality';
type Scope='tenant'|'portfolio';
interface BudgetStatus {
  policy:{monthlyLimitUsd:number;dailyLimitUsd:number|null;perTenantMonthlyLimitUsd:number|null;imageMonthlyLimitUsd:number|null;premiumMonthlyLimitUsd:number|null;maxSingleRequestUsd:number|null;warningThreshold:number;optimizationMode:Mode;allowPremiumModels:boolean;pauseAllAi:boolean};
  tenantOverride:{monthlyLimitUsd:number|null;imageMonthlyLimitUsd:number|null;priorityWeight:number;pauseAi:boolean}|null;
  month:{spentUsd:number;reservedUsd:number;committedUsd:number;remainingUsd:number;imageUsd:number;premiumUsd:number;percentUsed:number};
  byTenant:Array<{tenantId:string;name:string;spentUsd:number;reservedUsd:number;imageUsd:number;premiumUsd:number}>;
  pricingConfigured:boolean;
  models:{economy:string|null;standard:string|null;premium:string|null;image:string};
}
interface FormState {
  monthlyLimitUsd:string;dailyLimitUsd:string;perTenantMonthlyLimitUsd:string;imageMonthlyLimitUsd:string;premiumMonthlyLimitUsd:string;maxSingleRequestUsd:string;optimizationMode:Mode;allowPremiumModels:boolean;pauseAllAi:boolean;
  tenantMonthlyLimitUsd:string;tenantImageMonthlyLimitUsd:string;tenantPriorityWeight:string;tenantPauseAi:boolean;
}
interface CostBucket {costMicros:number|string;calls:number;date?:string;weekStart?:string;monthStart?:string;}
interface CostReport {
  scope:Scope;from:string;to:string;timezone:string;totalSpentMicros:number|string;reservedMicros:number|string;calls:number;
  daily:CostBucket[];weekly:CostBucket[];monthly:CostBucket[];
  byTenant:Array<{tenantId:string;tenantName:string;costMicros:number|string;calls:number}>;
  byPost:Array<{postId:string;tenantId:string;tenantName:string;topic:string|null;format:string;contentMode:string;costMicros:number|string;textCostMicros:number|string;imageCostMicros:number|string;calls:number}>;
  byFormat:Array<{format:string;costMicros:number|string;calls:number}>;
  byContentMode:Array<{contentMode:string;costMicros:number|string;calls:number}>;
  byTask:Array<{task:string;costMicros:number|string;calls:number}>;
  byModel:Array<{model:string;modelTier:string;costMicros:number|string;calls:number}>;
}
const money=(value:number)=>new Intl.NumberFormat('it-IT',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:4}).format(value);
const moneyMicros=(value:number|string)=>money(Number(value??0)/1_000_000);
const optional=(value:number|null)=>value===null?'':String(value);
const ymd=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const monthRange=()=>{const now=new Date();return{from:ymd(new Date(now.getFullYear(),now.getMonth(),1)),to:ymd(now)}};
const labelDate=(value:string|undefined)=>value?new Date(`${value}T12:00:00`).toLocaleDateString('it-IT',{day:'2-digit',month:'short',year:'numeric'}):'—';
const modeLabel=(value:string)=>({educational:'Educativo',storytelling:'Storytelling',promotional:'Promozionale',social_proof:'Social proof',behind_scenes:'Dietro le quinte',faq:'FAQ',comparison:'Confronto',listicle:'Lista',local:'Locale',community:'Community',newsjacking:'Attualità'}[value]??value);

export function AiBudgetPage(){
  const local=useLocalE2E();
  const initial=monthRange();
  const [status,setStatus]=useState<BudgetStatus|null>(null);
  const [form,setForm]=useState<FormState|null>(null);
  const [working,setWorking]=useState(false);
  const [message,setMessage]=useState<string|null>(null);
  const [from,setFrom]=useState(initial.from);
  const [to,setTo]=useState(initial.to);
  const [scope,setScope]=useState<Scope>('tenant');
  const [report,setReport]=useState<CostReport|null>(null);
  const [reportWorking,setReportWorking]=useState(false);

  const load=async()=>{
    if(!local.tenantId){setStatus(null);return;}
    try{
      const next=await local.api<BudgetStatus>(`/tenants/${local.tenantId}/ai-budget`);
      setStatus(next);setForm({monthlyLimitUsd:String(next.policy.monthlyLimitUsd),dailyLimitUsd:optional(next.policy.dailyLimitUsd),perTenantMonthlyLimitUsd:optional(next.policy.perTenantMonthlyLimitUsd),imageMonthlyLimitUsd:optional(next.policy.imageMonthlyLimitUsd),premiumMonthlyLimitUsd:optional(next.policy.premiumMonthlyLimitUsd),maxSingleRequestUsd:optional(next.policy.maxSingleRequestUsd),optimizationMode:next.policy.optimizationMode,allowPremiumModels:next.policy.allowPremiumModels,pauseAllAi:next.policy.pauseAllAi,tenantMonthlyLimitUsd:optional(next.tenantOverride?.monthlyLimitUsd??null),tenantImageMonthlyLimitUsd:optional(next.tenantOverride?.imageMonthlyLimitUsd??null),tenantPriorityWeight:String(next.tenantOverride?.priorityWeight??1),tenantPauseAi:next.tenantOverride?.pauseAi??false});setMessage(null);
    }catch(error){setMessage(error instanceof Error?error.message:String(error));}
  };
  const loadReport=async(nextFrom=from,nextTo=to,nextScope=scope)=>{
    if(!local.tenantId)return;
    setReportWorking(true);
    try{setReport(await local.api<CostReport>(`/tenants/${local.tenantId}/ai-cost-report?from=${encodeURIComponent(nextFrom)}&to=${encodeURIComponent(nextTo)}&scope=${nextScope}`));setMessage(null);}
    catch(error){setReport(null);setMessage(error instanceof Error?error.message:String(error));}
    finally{setReportWorking(false);}
  };
  useEffect(()=>{void load();},[local.tenantId]);
  useEffect(()=>{if(local.tenantId)void loadReport(from,to,scope);},[local.tenantId]);

  const preset=(kind:'today'|'week'|'month')=>{
    const now=new Date();let nextFrom=ymd(now);const nextTo=ymd(now);
    if(kind==='week'){const start=new Date(now);start.setDate(now.getDate()-6);nextFrom=ymd(start);}
    if(kind==='month')nextFrom=ymd(new Date(now.getFullYear(),now.getMonth(),1));
    setFrom(nextFrom);setTo(nextTo);void loadReport(nextFrom,nextTo,scope);
  };
  const changeScope=(value:Scope)=>{setScope(value);void loadReport(from,to,value);};
  const set=(key:keyof FormState,value:string|boolean)=>setForm((current)=>current?{...current,[key]:value}:current);
  const save=async()=>{
    if(!local.tenantId||!form)return;
    setWorking(true);setMessage(null);
    try{
      const payload={...form,monthlyLimitUsd:numberOrZero(form.monthlyLimitUsd),dailyLimitUsd:numberOrNull(form.dailyLimitUsd),perTenantMonthlyLimitUsd:numberOrNull(form.perTenantMonthlyLimitUsd),imageMonthlyLimitUsd:numberOrNull(form.imageMonthlyLimitUsd),premiumMonthlyLimitUsd:numberOrNull(form.premiumMonthlyLimitUsd),maxSingleRequestUsd:numberOrNull(form.maxSingleRequestUsd),tenantMonthlyLimitUsd:numberOrNull(form.tenantMonthlyLimitUsd),tenantImageMonthlyLimitUsd:numberOrNull(form.tenantImageMonthlyLimitUsd),tenantPriorityWeight:Number(form.tenantPriorityWeight||1)};
      const next=await local.api<BudgetStatus>(`/tenants/${local.tenantId}/ai-budget`,{method:'PATCH',body:JSON.stringify(payload)});setStatus(next);setMessage('Budget AI salvato. I limiti vengono applicati prima di ogni chiamata a pagamento.');
    }catch(error){setMessage(error instanceof Error?error.message:String(error));}
    finally{setWorking(false);}
  };

  if(!local.tenantId)return<><PageHeader eyebrow="Controllo costi" title="Budget AI" description="Seleziona un’attività per gestire il budget del portafoglio."/><Card><EmptyState title="Nessuna attività attiva" body="Crea o seleziona un’attività."/></Card></>;
  return<>
    <PageHeader eyebrow="Controllo costi" title="Budget AI" description="Ogni costo è attribuito al profilo e, quando nasce dalla produzione editoriale, al singolo post e alla sua variante. Puoi analizzarlo per qualsiasi intervallo di date." action={<button className="button secondary" onClick={()=>{void load();void loadReport();}}>Aggiorna</button>}/>
    {message&&<Card><p role="status">{message}</p></Card>}

    <Card>
      <div className="row-between"><div><span className="eyebrow">Calendario costi</span><h2>Scegli il periodo</h2></div><Badge tone={scope==='portfolio'?'info':'good'}>{scope==='portfolio'?'INTERO PORTAFOGLIO':'ATTIVITÀ ATTIVA'}</Badge></div>
      <div className="form-grid">
        <label>Da<input type="date" value={from} max={to} onChange={(e)=>setFrom(e.target.value)}/></label>
        <label>A<input type="date" value={to} min={from} onChange={(e)=>setTo(e.target.value)}/></label>
        <label>Ambito<select value={scope} onChange={(e)=>changeScope(e.target.value as Scope)}><option value="tenant">Solo attività attiva</option><option value="portfolio">Tutte le mie attività</option></select></label>
        <div><span className="eyebrow">Scorciatoie</span><div className="row"><button className="button secondary small" type="button" onClick={()=>preset('today')}>Oggi</button><button className="button secondary small" type="button" onClick={()=>preset('week')}>7 giorni</button><button className="button secondary small" type="button" onClick={()=>preset('month')}>Mese</button></div></div>
      </div>
      <button className="button" type="button" disabled={reportWorking||!from||!to} onClick={()=>void loadReport()}>{reportWorking?'Calcolo…':'Analizza spesa'}</button>
    </Card>

    {report&&<>
      <div className="three-col">
        <Card><span className="eyebrow">Spesa nel periodo</span><h2>{moneyMicros(report.totalSpentMicros)}</h2><p>{report.calls} chiamate AI contabilizzate · fuso {report.timezone}</p></Card>
        <Card><span className="eyebrow">Costo prenotato</span><h2>{moneyMicros(report.reservedMicros)}</h2><p>Richieste in corso già conteggiate nei limiti per evitare sforamenti.</p></Card>
        <Card><span className="eyebrow">Post più costoso</span><h2>{report.byPost[0]?moneyMicros(report.byPost[0].costMicros):money(0)}</h2><p>{report.byPost[0]?.topic??'Nessun post con costo attribuito nel periodo.'}</p></Card>
      </div>

      <div className="three-col">
        <SpendBuckets title="Giorno per giorno" rows={report.daily} dateKey="date"/>
        <SpendBuckets title="Settimane" rows={report.weekly} dateKey="weekStart"/>
        <SpendBuckets title="Mesi" rows={report.monthly} dateKey="monthStart"/>
      </div>

      <Card>
        <div className="row-between"><div><span className="eyebrow">Analisi per contenuto</span><h2>Post che hanno speso di più</h2></div><small>testo + OpenAI Immagini 2</small></div>
        {report.byPost.length===0?<EmptyState title="Nessun costo attribuito a post" body="I nuovi contenuti vengono tracciati per post e variante. Le chiamate generali come strategia o scansione restano correttamente separate."/>:<div className="stack">{report.byPost.slice(0,30).map((item,index)=><div className="list-row" key={item.postId}><Badge>{index+1}</Badge><div className="grow"><strong>{item.topic||'Contenuto senza titolo'}</strong><small>{scope==='portfolio'?`${item.tenantName} · `:''}{item.format} · {modeLabel(item.contentMode)} · testo {moneyMicros(item.textCostMicros)} · immagini {moneyMicros(item.imageCostMicros)}</small></div><div><strong>{moneyMicros(item.costMicros)}</strong><br/><Link className="button secondary small" to={`/app/posts/${item.postId}`}>Apri</Link></div></div>)}</div>}
      </Card>

      <div className="two-col">
        <Breakdown title="Costo per formato" rows={report.byFormat.map((row)=>({label:row.format,cost:row.costMicros,calls:row.calls}))}/>
        <Breakdown title="Costo per stile creativo" rows={report.byContentMode.map((row)=>({label:modeLabel(row.contentMode),cost:row.costMicros,calls:row.calls}))}/>
      </div>
      {scope==='portfolio'&&<Card><span className="eyebrow">Portafoglio</span><h2>Costo per attività nel periodo</h2>{report.byTenant.length===0?<EmptyState title="Nessuna spesa" body="Non risultano consumi nel periodo selezionato."/>:<div className="stack">{report.byTenant.map((item)=><div className="signal-row" key={item.tenantId}><span>{item.tenantName}<small>{item.calls} chiamate</small></span><strong>{moneyMicros(item.costMicros)}</strong></div>)}</div>}</Card>}
      <div className="two-col">
        <Breakdown title="Costo per operazione" rows={report.byTask.map((row)=>({label:row.task,cost:row.costMicros,calls:row.calls}))}/>
        <Breakdown title="Costo per modello" rows={report.byModel.map((row)=>({label:`${row.model} · ${row.modelTier}`,cost:row.costMicros,calls:row.calls}))}/>
      </div>
    </>}

    {!status||!form?<Card><EmptyState title="Budget non disponibile" body="Il controllo resta fail-closed: senza configurazione valida Post Automatici non può spendere."/></Card>:<>
      <div className="three-col">
        <Card><span className="eyebrow">Mese corrente</span><h2>{money(status.month.committedUsd)}</h2><p>Spesi {money(status.month.spentUsd)} · prenotati {money(status.month.reservedUsd)}</p><Badge tone={status.month.percentUsed>=80?'warn':'good'}>{status.month.percentUsed.toFixed(1)}% del budget</Badge></Card>
        <Card><span className="eyebrow">Residuo protetto</span><h2>{money(status.month.remainingUsd)}</h2><p>Budget massimo {money(status.policy.monthlyLimitUsd)}. A zero, ogni AI a pagamento è bloccata.</p></Card>
        <Card><span className="eyebrow">Immagini</span><h2>{money(status.month.imageUsd)}</h2><p>Le immagini usano esclusivamente <strong>GPT‑Image‑2</strong>.</p></Card>
      </div>
      <div className="two-col">
        <Card><span className="eyebrow">Modelli</span><h2>Routing automatico</h2><div className="signal-row"><span>Economy</span><strong>{status.models.economy??'DA CONFIGURARE'}</strong></div><div className="signal-row"><span>Standard</span><strong>{status.models.standard??'DA CONFIGURARE'}</strong></div><div className="signal-row"><span>Premium</span><strong>{status.models.premium??'DISABILITATO'}</strong></div><div className="signal-row"><span>Immagini</span><strong>{status.models.image}</strong></div><Badge tone={status.pricingConfigured?'good':'warn'}>{status.pricingConfigured?'PREZZI SERVER CONFIGURATI':'PREZZI NON CONFIGURATI · SPESA BLOCCATA'}</Badge></Card>
        <Card><span className="eyebrow">Logica</span><h2>Niente modello costoso per abitudine</h2><p>Economy per lavori semplici, standard per la maggior parte della strategia e dei contenuti, premium solo se autorizzato e giustificato.</p></Card>
      </div>
      <Card><span className="eyebrow">Tetto portafoglio</span><h2>Limiti hard</h2><div className="form-grid"><MoneyInput label="Budget mensile totale USD" value={form.monthlyLimitUsd} onChange={(v)=>set('monthlyLimitUsd',v)}/><MoneyInput label="Limite giornaliero USD" value={form.dailyLimitUsd} onChange={(v)=>set('dailyLimitUsd',v)} optional/><MoneyInput label="Massimo mensile per attività USD" value={form.perTenantMonthlyLimitUsd} onChange={(v)=>set('perTenantMonthlyLimitUsd',v)} optional/><MoneyInput label="Budget immagini mensile USD" value={form.imageMonthlyLimitUsd} onChange={(v)=>set('imageMonthlyLimitUsd',v)} optional/><MoneyInput label="Budget premium mensile USD" value={form.premiumMonthlyLimitUsd} onChange={(v)=>set('premiumMonthlyLimitUsd',v)} optional/><MoneyInput label="Massimo per singola richiesta USD" value={form.maxSingleRequestUsd} onChange={(v)=>set('maxSingleRequestUsd',v)} optional/></div><div className="form-grid"><label>Ottimizzazione<select value={form.optimizationMode} onChange={(e)=>set('optimizationMode',e.target.value as Mode)}><option value="economy">Economy · minimizza costo</option><option value="balanced">Balanced · costo/qualità</option><option value="quality">Quality · qualità quando serve</option></select></label><label className="checkbox-row"><input type="checkbox" checked={form.allowPremiumModels} onChange={(e)=>set('allowPremiumModels',e.target.checked)}/><span>Permetti modello premium quando il router lo giustifica</span></label><label className="checkbox-row"><input type="checkbox" checked={form.pauseAllAi} onChange={(e)=>set('pauseAllAi',e.target.checked)}/><span>Pausa immediatamente tutta l’AI a pagamento</span></label></div></Card>
      <Card><span className="eyebrow">Attività attiva</span><h2>Override opzionale</h2><p>Questi limiti valgono solo per il profilo selezionato e non possono superare il tetto complessivo.</p><div className="form-grid"><MoneyInput label="Budget mensile attività USD" value={form.tenantMonthlyLimitUsd} onChange={(v)=>set('tenantMonthlyLimitUsd',v)} optional/><MoneyInput label="Budget immagini attività USD" value={form.tenantImageMonthlyLimitUsd} onChange={(v)=>set('tenantImageMonthlyLimitUsd',v)} optional/><label>Priorità relativa<input type="number" min="0.1" step="0.1" value={form.tenantPriorityWeight} onChange={(e)=>set('tenantPriorityWeight',e.target.value)}/></label><label className="checkbox-row"><input type="checkbox" checked={form.tenantPauseAi} onChange={(e)=>set('tenantPauseAi',e.target.checked)}/><span>Pausa AI solo per questa attività</span></label></div></Card>
      <Card><button className="button" disabled={working} onClick={()=>void save()}>{working?'Salvataggio…':'Salva limiti budget'}</button><p className="muted">Il budget è un tetto massimo, non un obiettivo di spesa.</p></Card>
    </>}
  </>;
}

function SpendBuckets({title,rows,dateKey}:{title:string;rows:CostBucket[];dateKey:'date'|'weekStart'|'monthStart'}){return<Card><span className="eyebrow">Storico</span><h2>{title}</h2>{rows.length===0?<p className="muted">Nessuna spesa.</p>:<div className="stack">{rows.slice(-14).map((row)=><div className="signal-row" key={String(row[dateKey])}><span>{labelDate(row[dateKey])}<small>{row.calls} chiamate</small></span><strong>{moneyMicros(row.costMicros)}</strong></div>)}</div>}</Card>}
function Breakdown({title,rows}:{title:string;rows:Array<{label:string;cost:number|string;calls:number}>}){return<Card><span className="eyebrow">Ripartizione</span><h2>{title}</h2>{rows.length===0?<p className="muted">Nessun dato.</p>:<div className="stack">{rows.slice(0,15).map((row)=><div className="signal-row" key={row.label}><span>{row.label}<small>{row.calls} chiamate</small></span><strong>{moneyMicros(row.cost)}</strong></div>)}</div>}</Card>}
function MoneyInput({label,value,onChange,optional=false}:{label:string;value:string;onChange:(value:string)=>void;optional?:boolean}){return<label>{label}<input type="number" min="0" step="0.01" placeholder={optional?'Nessun limite aggiuntivo':'0.00'} value={value} onChange={(e)=>onChange(e.target.value)}/></label>}
function numberOrNull(value:string){if(!value.trim())return null;const result=Number(value);if(!Number.isFinite(result)||result<0)throw new Error('Inserisci un importo valido.');return result;}
function numberOrZero(value:string){return numberOrNull(value)??0;}
