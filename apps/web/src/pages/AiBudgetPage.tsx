import { useEffect, useState } from 'react';
import { Badge, Card, EmptyState, PageHeader } from '../components/ui';
import { useLocalE2E } from '../services/local-e2e';

type Mode='economy'|'balanced'|'quality';
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
const money=(value:number)=>new Intl.NumberFormat('it-IT',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
const optional=(value:number|null)=>value===null?'':String(value);

export function AiBudgetPage(){
  const local=useLocalE2E();
  const [status,setStatus]=useState<BudgetStatus|null>(null);
  const [form,setForm]=useState<FormState|null>(null);
  const [working,setWorking]=useState(false);
  const [message,setMessage]=useState<string|null>(null);

  const load=async()=>{
    if(!local.tenantId){setStatus(null);return;}
    try{
      const next=await local.api<BudgetStatus>(`/tenants/${local.tenantId}/ai-budget`);
      setStatus(next);setForm({monthlyLimitUsd:String(next.policy.monthlyLimitUsd),dailyLimitUsd:optional(next.policy.dailyLimitUsd),perTenantMonthlyLimitUsd:optional(next.policy.perTenantMonthlyLimitUsd),imageMonthlyLimitUsd:optional(next.policy.imageMonthlyLimitUsd),premiumMonthlyLimitUsd:optional(next.policy.premiumMonthlyLimitUsd),maxSingleRequestUsd:optional(next.policy.maxSingleRequestUsd),optimizationMode:next.policy.optimizationMode,allowPremiumModels:next.policy.allowPremiumModels,pauseAllAi:next.policy.pauseAllAi,tenantMonthlyLimitUsd:optional(next.tenantOverride?.monthlyLimitUsd??null),tenantImageMonthlyLimitUsd:optional(next.tenantOverride?.imageMonthlyLimitUsd??null),tenantPriorityWeight:String(next.tenantOverride?.priorityWeight??1),tenantPauseAi:next.tenantOverride?.pauseAi??false});setMessage(null);
    }catch(error){setMessage(error instanceof Error?error.message:String(error));}
  };
  useEffect(()=>{void load();},[local.tenantId]);

  const set=(key:keyof FormState,value:string|boolean)=>setForm((current)=>current?{...current,[key]:value}:current);
  const save=async()=>{
    if(!local.tenantId||!form)return;
    setWorking(true);setMessage(null);
    try{
      const payload={...form,monthlyLimitUsd:numberOrZero(form.monthlyLimitUsd),dailyLimitUsd:numberOrNull(form.dailyLimitUsd),perTenantMonthlyLimitUsd:numberOrNull(form.perTenantMonthlyLimitUsd),imageMonthlyLimitUsd:numberOrNull(form.imageMonthlyLimitUsd),premiumMonthlyLimitUsd:numberOrNull(form.premiumMonthlyLimitUsd),maxSingleRequestUsd:numberOrNull(form.maxSingleRequestUsd),tenantMonthlyLimitUsd:numberOrNull(form.tenantMonthlyLimitUsd),tenantImageMonthlyLimitUsd:numberOrNull(form.tenantImageMonthlyLimitUsd),tenantPriorityWeight:Number(form.tenantPriorityWeight||1)};
      const next=await local.api<BudgetStatus>(`/tenants/${local.tenantId}/ai-budget`,{method:'PATCH',body:JSON.stringify(payload)});setStatus(next);setMessage('Budget AI salvato. I limiti sono applicati dal database prima di ogni chiamata a pagamento.');
    }catch(error){setMessage(error instanceof Error?error.message:String(error));}
    finally{setWorking(false);}
  };

  if(!local.tenantId)return<><PageHeader eyebrow="Controllo costi" title="Budget AI" description="Seleziona un’attività per gestire il budget del portafoglio."/><Card><EmptyState title="Nessuna attività attiva" body="Crea o seleziona un’attività."/></Card></>;
  return<>
    <PageHeader eyebrow="Controllo costi" title="Budget AI" description="Un tetto unico protegge tutto il tuo portafoglio. Ogni chiamata prenota il costo stimato prima di raggiungere OpenAI; se supera un limite viene bloccata." action={<button className="button secondary" onClick={()=>void load()}>Aggiorna</button>}/>
    {message&&<Card><p role="status">{message}</p></Card>}
    {!status||!form?<Card><EmptyState title="Budget non disponibile" body="Il controllo resta fail-closed: senza configurazione valida Post Automatici non può spendere."/></Card>:<>
      <div className="three-col">
        <Card><span className="eyebrow">Mese corrente</span><h2>{money(status.month.committedUsd)}</h2><p>Spesi {money(status.month.spentUsd)} · prenotati {money(status.month.reservedUsd)}</p><Badge tone={status.month.percentUsed>=80?'warn':'good'}>{status.month.percentUsed.toFixed(1)}% del budget</Badge></Card>
        <Card><span className="eyebrow">Residuo protetto</span><h2>{money(status.month.remainingUsd)}</h2><p>Budget massimo {money(status.policy.monthlyLimitUsd)}. A zero, ogni AI a pagamento è bloccata.</p></Card>
        <Card><span className="eyebrow">Immagini</span><h2>{money(status.month.imageUsd)}</h2><p>Le immagini usano esclusivamente <strong>GPT‑Image‑2</strong>. Nessun fallback più economico viene usato di nascosto.</p></Card>
      </div>
      <div className="two-col">
        <Card><span className="eyebrow">Modelli</span><h2>Routing automatico</h2><div className="signal-row"><span>Economy</span><strong>{status.models.economy??'DA CONFIGURARE'}</strong></div><div className="signal-row"><span>Standard</span><strong>{status.models.standard??'DA CONFIGURARE'}</strong></div><div className="signal-row"><span>Premium</span><strong>{status.models.premium??'DISABILITATO'}</strong></div><div className="signal-row"><span>Immagini</span><strong>{status.models.image}</strong></div><Badge tone={status.pricingConfigured?'good':'warn'}>{status.pricingConfigured?'PREZZI SERVER CONFIGURATI':'PREZZI NON CONFIGURATI · SPESA BLOCCATA'}</Badge></Card>
        <Card><span className="eyebrow">Logica</span><h2>Niente modello costoso per abitudine</h2><p><strong>Economy</strong> usa il livello economico per classificazioni, QA, deduplica e lavori semplici. <strong>Balanced</strong> usa il modello standard per strategia e contenuti. <strong>Quality</strong> può salire al premium solo se lo abiliti e solo quando un retry/compito complesso lo giustifica.</p></Card>
      </div>
      <Card><span className="eyebrow">Tetto portafoglio</span><h2>Limiti hard</h2><div className="form-grid"><MoneyInput label="Budget mensile totale USD" value={form.monthlyLimitUsd} onChange={(v)=>set('monthlyLimitUsd',v)}/><MoneyInput label="Limite giornaliero USD" value={form.dailyLimitUsd} onChange={(v)=>set('dailyLimitUsd',v)} optional/><MoneyInput label="Massimo mensile per attività USD" value={form.perTenantMonthlyLimitUsd} onChange={(v)=>set('perTenantMonthlyLimitUsd',v)} optional/><MoneyInput label="Budget immagini mensile USD" value={form.imageMonthlyLimitUsd} onChange={(v)=>set('imageMonthlyLimitUsd',v)} optional/><MoneyInput label="Budget premium mensile USD" value={form.premiumMonthlyLimitUsd} onChange={(v)=>set('premiumMonthlyLimitUsd',v)} optional/><MoneyInput label="Massimo per singola richiesta USD" value={form.maxSingleRequestUsd} onChange={(v)=>set('maxSingleRequestUsd',v)} optional/></div><div className="form-grid"><label>Ottimizzazione<select value={form.optimizationMode} onChange={(e)=>set('optimizationMode',e.target.value as Mode)}><option value="economy">Economy · minimizza costo</option><option value="balanced">Balanced · costo/qualità</option><option value="quality">Quality · qualità quando serve</option></select></label><label className="checkbox-row"><input type="checkbox" checked={form.allowPremiumModels} onChange={(e)=>set('allowPremiumModels',e.target.checked)}/><span>Permetti modello premium quando il router lo giustifica</span></label><label className="checkbox-row"><input type="checkbox" checked={form.pauseAllAi} onChange={(e)=>set('pauseAllAi',e.target.checked)}/><span>Pausa immediatamente tutta l’AI a pagamento</span></label></div></Card>
      <Card><span className="eyebrow">Attività attiva</span><h2>Override opzionale</h2><p>Questi limiti valgono solo per il profilo selezionato e non possono superare il tetto complessivo.</p><div className="form-grid"><MoneyInput label="Budget mensile attività USD" value={form.tenantMonthlyLimitUsd} onChange={(v)=>set('tenantMonthlyLimitUsd',v)} optional/><MoneyInput label="Budget immagini attività USD" value={form.tenantImageMonthlyLimitUsd} onChange={(v)=>set('tenantImageMonthlyLimitUsd',v)} optional/><label>Priorità relativa<input type="number" min="0.1" step="0.1" value={form.tenantPriorityWeight} onChange={(e)=>set('tenantPriorityWeight',e.target.value)}/></label><label className="checkbox-row"><input type="checkbox" checked={form.tenantPauseAi} onChange={(e)=>set('tenantPauseAi',e.target.checked)}/><span>Pausa AI solo per questa attività</span></label></div></Card>
      <Card><div className="row-between"><div><span className="eyebrow">Portafoglio</span><h2>Spesa per attività</h2></div><small>{status.byTenant.length} attività con consumo nel mese</small></div>{status.byTenant.length===0?<EmptyState title="Nessuna spesa AI" body="Non risultano consumi o prenotazioni di costo nel mese corrente."/>:<div className="stack">{status.byTenant.map((item)=><div className="list-row" key={item.tenantId}><div className="grow"><strong>{item.name}</strong><small>Speso {money(item.spentUsd)} · prenotato {money(item.reservedUsd)} · immagini {money(item.imageUsd)}</small></div><strong>{money(item.spentUsd+item.reservedUsd)}</strong></div>)}</div>}</Card>
      <Card><button className="button" disabled={working} onClick={()=>void save()}>{working?'Salvataggio…':'Salva limiti budget'}</button><p className="muted">Il salvataggio non genera alcun costo. Il budget è un tetto massimo, non un obiettivo di spesa.</p></Card>
    </>}
  </>;
}

function MoneyInput({label,value,onChange,optional=false}:{label:string;value:string;onChange:(value:string)=>void;optional?:boolean}){return<label>{label}<input type="number" min="0" step="0.01" placeholder={optional?'Nessun limite aggiuntivo':'0.00'} value={value} onChange={(e)=>onChange(e.target.value)}/></label>}
function numberOrNull(value:string){if(!value.trim())return null;const result=Number(value);if(!Number.isFinite(result)||result<0)throw new Error('Inserisci un importo valido.');return result;}
function numberOrZero(value:string){return numberOrNull(value)??0;}
