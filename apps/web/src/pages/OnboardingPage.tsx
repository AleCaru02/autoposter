import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { Badge } from '../components/ui';
import { localE2EEnabled, useLocalE2E, type ApiPlatform, type ApprovalMode } from '../services/local-e2e';
import './onboarding-modern.css';

const goals = ['lead','vendite','prenotazioni','notorietà','traffico','personal brand','community','educazione','visite attività locale'];
const platforms: Array<{ key: ApiPlatform; label: string; short:string }> = [
  { key: 'instagram', label: 'Instagram', short:'IG' },
  { key: 'facebook', label: 'Facebook', short:'FB' },
  { key: 'linkedin', label: 'LinkedIn', short:'IN' },
  { key: 'google_business_profile', label: 'Google Business Profile', short:'GB' },
];
const internalSteps = ['business','goals','target','brand','social','frequency','publishing','summary','completed'] as const;
const phaseMap:Record<string,number>={business:1,goals:2,target:2,brand:2,social:3,frequency:3,publishing:3,summary:4,completed:4};
const phases=[
  {n:1,label:'Attività',hint:'Identità di base'},
  {n:2,label:'Brand & obiettivi',hint:'Chi sei e a chi parli'},
  {n:3,label:'Canali & ritmo',hint:'Dove e quanto pubblicare'},
  {n:4,label:'Conferma',hint:'Rivedi e attiva il profilo'},
];
const emptyBusiness = { name:'', website:'', industry:'', subIndustry:'', location:'', language:'it', serviceArea:'', services:'', differentiator:'' };
const e2eFixtures = import.meta.env.VITE_E2E_FIXTURES === 'true';

export function OnboardingPage() {
  const local = useLocalE2E();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const createNew = searchParams.get('new') === '1';
  const workspace = local.workspace;
  const persistedStep = createNew ? 'business' : String(workspace?.onboarding?.current_step ?? 'business');
  const [step, setStep] = useState(persistedStep);
  const [message, setMessage] = useState<string | null>(null);
  const [business, setBusiness] = useState(() => ({ ...emptyBusiness }));
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<ApiPlatform[]>([]);
  const [postsPerWeek, setPostsPerWeek] = useState(3);
  const [days, setDays] = useState('1,3,5');
  const [times, setTimes] = useState('10:00,18:00');
  const [modes, setModes] = useState<Record<ApiPlatform,ApprovalMode>>({ instagram:'manual', facebook:'manual', linkedin:'manual', google_business_profile:'manual' });
  const [working,setWorking]=useState(false);
  const [showAdvanced,setShowAdvanced]=useState(false);

  useEffect(() => {
    if (createNew) {
      setStep('business');setBusiness({ ...emptyBusiness });setSelectedGoals([]);setTarget('');setSelectedPlatforms([]);return;
    }
    if (workspace?.onboarding?.current_step) setStep(String(workspace.onboarding.current_step));
  }, [createNew, workspace?.onboarding?.current_step]);

  useEffect(() => {
    if (createNew) return;
    const stored = workspace?.onboarding;
    if (!stored) return;
    if (stored.business && Object.keys(stored.business).length) setBusiness((current) => ({ ...current, ...stored.business }));
    if (Array.isArray(stored.goals)) setSelectedGoals(stored.goals.map(String));
    if (stored.target?.manual) setTarget(Array.isArray(stored.target.manual) ? stored.target.manual.join(', ') : String(stored.target.manual));
    if (Array.isArray(stored.social)) setSelectedPlatforms(stored.social as ApiPlatform[]);
    if (stored.frequency?.postsPerWeek) setPostsPerWeek(Number(stored.frequency.postsPerWeek));
    if (Array.isArray(stored.frequency?.days)) setDays(stored.frequency.days.join(','));
    if (Array.isArray(stored.frequency?.times)) setTimes(stored.frequency.times.join(','));
    if (stored.publishing_modes && Object.keys(stored.publishing_modes).length) setModes((current) => ({ ...current, ...stored.publishing_modes }));
  }, [createNew, workspace?.onboarding]);

  const aiReady=Boolean(local.health?.testFixtures||local.health?.capabilities?.openai);
  const currentPhase=phaseMap[step]??1;
  const internalIndex=Math.max(0,internalSteps.indexOf(step as typeof internalSteps[number]));
  const coverage = Number(workspace?.onboarding?.scan_summary?.coverage ?? 0);
  const scanSummary=workspace?.onboarding?.scan_summary;
  const brand=workspace?.brand;
  const completion=Math.round(((currentPhase-1)/3)*100);
  const summary=useMemo(()=>({
    activity:business.name||'Attività senza nome',
    goals:selectedGoals.length?selectedGoals.join(', '):'Da definire',
    target:target||'Da definire',
    channels:selectedPlatforms.length?selectedPlatforms.map(platformLabel).join(', '):'Nessuno',
    rhythm:`${postsPerWeek} post/settimana`,
  }),[business.name,selectedGoals,target,selectedPlatforms,postsPerWeek]);

  if (!localE2EEnabled) return <FocusedState title="Backend da configurare" body="Il setup richiede il backend persistente. Nessun dato viene simulato nel browser." />;
  if (!local.token) return <Navigate to="/login" replace/>;

  const run = async (action: () => Promise<unknown>) => {
    setMessage(null);setWorking(true);
    try { await action(); await local.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); throw error; }
    finally{setWorking(false);}
  };
  const saveBusiness = async (event: FormEvent) => {
    event.preventDefault();if (!business.name.trim()) { setMessage('Inserisci il nome dell’attività.'); return; }
    setWorking(true);setMessage(null);
    try {
      let tenantId = createNew ? null : local.tenantId;
      if (!tenantId) tenantId = await local.createTenant({ name: business.name.trim(), slug: `${slugify(business.name)}-${Date.now()}` });
      const payload = { ...business, name: business.name.trim(), website: business.website.trim() };
      await local.api(`/tenants/${tenantId}/onboarding`, { method:'PATCH', body:JSON.stringify({ business: payload, current_step:'goals' }) });
      await local.refresh(tenantId);setStep('goals');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally{setWorking(false);}
  };
  const saveStep = async (next: string, patch: Record<string,unknown>) => {
    if (!local.tenantId) throw new Error('tenant_missing');
    await run(() => local.api(`/tenants/${local.tenantId}/onboarding`, { method:'PATCH', body:JSON.stringify({ ...patch, current_step: next }) }));setStep(next);
  };
  const scan = async () => {
    if (!local.tenantId) return;if (!business.website.trim()) { setMessage('Aggiungi un URL prima di avviare la scansione.'); return; }
    if(!aiReady&&!e2eFixtures){setMessage('La scansione assistita è pronta, ma OpenAI deve essere configurato nella Control Room Master. Puoi continuare con il profilo manuale.');return;}
    await run(() => local.api(`/tenants/${local.tenantId}/scan`, { method:'POST' }));setStep('brand');
  };
  const saveSocialPreferences = async (next = 'frequency') => {
    if (!local.tenantId) return;
    if (e2eFixtures) await run(() => local.api(`/tenants/${local.tenantId}/social`, { method:'POST', body:JSON.stringify({ platforms:selectedPlatforms, publishingModes:modes }) }));
    await saveStep(next, { social:selectedPlatforms, publishing_modes:modes });
  };
  const complete = async () => {
    if (!local.tenantId) return;
    setWorking(true);setMessage(null);
    try{
      const result=await local.api<{completed?:boolean;strategyGenerated?:boolean;reason?:string}>(`/tenants/${local.tenantId}/onboarding/complete`, { method:'POST' });
      await local.refresh();
      if(result.strategyGenerated===false&&result.reason==='OPENAI_NOT_CONFIGURED')setMessage('Profilo completato. OpenAI è ancora da configurare nella Control Room Master.');
      navigate('/app');
    }catch(error){setMessage(error instanceof Error?friendlyError(error.message):String(error));}
    finally{setWorking(false);}
  };

  return <div className="ob-shell">
    <header className="ob-topbar"><Link className="ob-brand" to="/app"><span>P</span><strong>Post Automatici</strong></Link><div className="ob-top-actions"><Badge tone={local.health?.capabilities?.database?'good':'warn'}>{local.health?.capabilities?.database?'DATI PERSISTENTI':'BACKEND'}</Badge><Link className="ob-exit" to="/app">Esci dal setup</Link></div></header>
    <main className="ob-main">
      <section className="ob-intro"><div><span className="ob-kicker">NUOVO PROFILO · SETUP RAPIDO</span><h1>{createNew?'Aggiungi un’attività':'Mettiamo a fuoco il profilo'}</h1><p>Quattro fasi essenziali. Le informazioni restano modificabili in qualsiasi momento dalla dashboard.</p></div><div className="ob-progress-copy"><strong>{completion}%</strong><small>configurato</small></div></section>
      <div className="ob-phasebar" aria-label="Avanzamento setup">{phases.map((phase)=><div className={`ob-phase ${phase.n<currentPhase?'done':phase.n===currentPhase?'active':''}`} key={phase.n}><span>{phase.n<currentPhase?'✓':phase.n}</span><div><strong>{phase.label}</strong><small>{phase.hint}</small></div></div>)}</div>
      {message&&<div className="ob-alert" role="alert"><span>!</span><p>{friendlyError(message)}</p></div>}
      <div className="ob-layout">
        <section className="ob-workspace">
          {step==='business'&&<section className="ob-panel"><PanelHead index="01" title="La tua attività" body="Partiamo dalle informazioni che rendono il profilo riconoscibile. Il resto può essere arricchito dopo."/><form onSubmit={saveBusiness} className="ob-form">
            <div className="ob-field primary"><label>Nome attività</label><input data-testid="business-name" value={business.name} onChange={(e)=>setBusiness({...business,name:e.target.value})} placeholder="Es. Il Tuo Property Manager" required/></div>
            <div className="ob-field primary"><label>Sito web <em>facoltativo</em></label><input data-testid="business-website" value={business.website} onChange={(e)=>setBusiness({...business,website:e.target.value})} placeholder="https://www.tuosito.it" inputMode="url"/></div>
            <div className="ob-grid-2"><div className="ob-field"><label>Settore</label><input value={business.industry} onChange={(e)=>setBusiness({...business,industry:e.target.value})} placeholder="Es. Affitti brevi"/></div><div className="ob-field"><label>Località</label><input value={business.location} onChange={(e)=>setBusiness({...business,location:e.target.value})} placeholder="Es. Milano"/></div></div>
            <button type="button" className="ob-text-button" onClick={()=>setShowAdvanced((value)=>!value)}>{showAdvanced?'− Nascondi dettagli':'+ Aggiungi dettagli facoltativi'}</button>
            {showAdvanced&&<div className="ob-advanced"><div className="ob-grid-2"><div className="ob-field"><label>Sotto-settore</label><input value={business.subIndustry} onChange={(e)=>setBusiness({...business,subIndustry:e.target.value})}/></div><div className="ob-field"><label>Area servita</label><input value={business.serviceArea} onChange={(e)=>setBusiness({...business,serviceArea:e.target.value})}/></div></div><div className="ob-field"><label>Servizi</label><textarea value={business.services} onChange={(e)=>setBusiness({...business,services:e.target.value})} placeholder="Separali con una virgola"/></div><div className="ob-field"><label>Cosa ti differenzia?</label><textarea value={business.differentiator} onChange={(e)=>setBusiness({...business,differentiator:e.target.value})}/></div></div>}
            <button data-testid="onboarding-business-next" className="ob-primary" disabled={working} type="submit">{working?'Salvataggio…':'Continua →'}</button>
          </form></section>}

          {step==='goals'&&<section className="ob-panel"><PanelHead index="02" title="Cosa deve ottenere il sistema?" body="Scegli gli obiettivi. Puoi selezionarne più di uno e modificarli in Strategia."/><div className="ob-chip-grid">{goals.map((goal)=><label className={`ob-choice-chip ${selectedGoals.includes(goal)?'selected':''}`} key={goal}><input data-testid={`goal-${goal}`} type="checkbox" checked={selectedGoals.includes(goal)} onChange={(event)=>setSelectedGoals(event.target.checked?[...selectedGoals,goal]:selectedGoals.filter((item)=>item!==goal))}/><span>{goal}</span></label>)}</div><div className="ob-actions"><button data-testid="onboarding-goals-next" className="ob-primary" disabled={working} onClick={()=>void saveStep('target',{goals:selectedGoals})}>Continua →</button></div></section>}

          {step==='target'&&<section className="ob-panel"><PanelHead index="02" title="A chi vuoi parlare?" body="Descrivilo come lo diresti a una persona, senza formule da marketing."/><div className="ob-field primary"><label>Cliente / pubblico ideale</label><textarea data-testid="target-input" value={target} onChange={(e)=>setTarget(e.target.value)} placeholder="Es. Proprietari con una seconda casa a Milano che vogliono affittarla senza gestire operatività e ospiti." rows={6}/></div><div className="ob-actions"><button className="ob-secondary" onClick={()=>setStep('goals')}>← Indietro</button><button data-testid="onboarding-target-next" className="ob-primary" disabled={working} onClick={()=>void saveStep('brand',{target:{manual:target.split(',').map((item)=>item.trim()).filter(Boolean),suggestions:[]}})}>Continua →</button></div></section>}

          {step==='brand'&&<section className="ob-panel"><PanelHead index="02" title="Brand e sito" body="Se hai un sito, lo analizziamo pagina per pagina. Se OpenAI non è ancora configurato puoi completare il profilo manualmente e tornare qui dopo."/>
            <div className="ob-status-grid"><div className="ob-status-card"><span>SITO</span><strong>{business.website||'Nessun URL'}</strong><small>{scanSummary?`${String(scanSummary.analyzed??0)} pagine analizzate · copertura ${coverage}%`:business.website?'Pronto per l’analisi':'Facoltativo'}</small></div><div className="ob-status-card"><span>OPENAI</span><strong>{aiReady?'Pronto':'Da configurare'}</strong><small>{aiReady?'Può creare il Brand Profile da evidenze reali':'Configurabile dall’account Master'}</small></div></div>
            {business.website&&<button data-testid="scan-website" className="ob-primary" disabled={working||(!aiReady&&!e2eFixtures)} onClick={()=>void scan()}>{working?'Analisi in corso…':scanSummary?'Riesegui analisi pagina per pagina':'Analizza il sito pagina per pagina'}</button>}
            {scanSummary&&Array.isArray(scanSummary.urls)&&<div className="ob-scan-list">{scanSummary.urls.slice(0,6).map((item:any)=><div key={String(item.url)}><span>{Number(item.status)>=200&&Number(item.status)<400?'✓':'!'}</span><p><strong>{String(item.title??'Pagina')}</strong><small>{String(item.url)}</small></p></div>)}</div>}
            {brand&&<div className="ob-brand-result"><Badge tone={brand.status==='confirmed'?'good':'info'}>{String(brand.status).toUpperCase()}</Badge><h3>{String(brand.brand_name??business.name)}</h3><p>{String(brand.description??'Brand Profile creato. Puoi perfezionarlo nella sezione Brand.')}</p><div className="ob-actions"><Link className="ob-secondary" to="/app/brand">Apri Brand</Link><button data-testid="confirm-brand" className="ob-primary" onClick={()=>void run(()=>local.api(`/tenants/${local.tenantId}/brand/status`,{method:'POST',body:JSON.stringify({status:'confirmed'})})).then(()=>saveStep('social',{}))}>Conferma e continua →</button></div></div>}
            {!brand&&<div className="ob-actions"><button className="ob-secondary" onClick={()=>setStep('target')}>← Indietro</button><button className="ob-primary" onClick={()=>void saveStep('social',{})}>Continua con dati manuali →</button></div>}
          </section>}

          {step==='social'&&<section className="ob-panel"><PanelHead index="03" title="Dove vuoi pubblicare?" body="Qui scegli i canali. La connessione vera avviene in seguito tramite le API ufficiali."/><div className="ob-platform-grid">{platforms.map(({key,label,short})=><label className={`ob-platform-card ${selectedPlatforms.includes(key)?'selected':''}`} key={key}><input data-testid={`platform-${key}`} type="checkbox" checked={selectedPlatforms.includes(key)} onChange={(event)=>setSelectedPlatforms(event.target.checked?[...selectedPlatforms,key]:selectedPlatforms.filter((item)=>item!==key))}/><span className="ob-platform-icon">{short}</span><strong>{label}</strong><small>{providerReady(local,key)?'Provider configurato':'Da collegare'}</small></label>)}</div><div className="ob-actions"><button data-testid="onboarding-social-next" className="ob-primary" disabled={working} onClick={()=>void saveSocialPreferences('frequency')}>Continua →</button></div></section>}

          {step==='frequency'&&<section className="ob-panel"><PanelHead index="03" title="Quanto vuoi essere presente?" body="Scegli un ritmo iniziale. Il sistema potrà suggerire modifiche solo quando avrà metriche reali sufficienti."/><div className="ob-frequency-preset">{[3,5,7].map((value)=><button type="button" className={postsPerWeek===value?'active':''} key={value} onClick={()=>setPostsPerWeek(value)}><strong>{value}</strong><span>post / settimana</span></button>)}</div><div className="ob-grid-2"><div className="ob-field"><label>Post / settimana</label><input data-testid="posts-per-week" type="number" min="1" max="14" value={postsPerWeek} onChange={(e)=>setPostsPerWeek(Number(e.target.value))}/></div><div className="ob-field"><label>Orari preferiti</label><input value={times} onChange={(e)=>setTimes(e.target.value)} placeholder="10:00, 18:00"/></div></div><div className="ob-field"><label>Giorni ISO <em>1 = lunedì</em></label><input value={days} onChange={(e)=>setDays(e.target.value)} placeholder="1,3,5"/></div><div className="ob-actions"><button className="ob-secondary" onClick={()=>setStep('social')}>← Indietro</button><button data-testid="onboarding-frequency-next" className="ob-primary" disabled={working} onClick={()=>void saveStep('publishing',{frequency:{postsPerWeek,days:days.split(',').map(Number).filter(Number.isFinite),times:times.split(',').map((item)=>item.trim()).filter(Boolean)}})}>Continua →</button></div></section>}

          {step==='publishing'&&<section className="ob-panel"><PanelHead index="03" title="Dopo la tua approvazione" body="L’anteprima è sempre obbligatoria. Decidi solo cosa deve succedere dopo il tuo OK."/>{selectedPlatforms.length===0?<div className="ob-empty">Nessun canale selezionato. Puoi continuare e collegarli dopo.</div>:<div className="ob-publish-list">{selectedPlatforms.map((platform)=><div className="ob-publish-row" key={platform}><div><strong>{platformLabel(platform)}</strong><small>Anteprima + tua approvazione sempre richieste</small></div><select data-testid={`mode-${platform}`} value={modes[platform]} onChange={(e)=>setModes({...modes,[platform]:e.target.value as ApprovalMode})}><option value="manual">Poi pubblico io manualmente</option><option value="auto">Poi pubblica all’orario programmato</option></select></div>)}</div>}<div className="ob-actions"><button className="ob-secondary" onClick={()=>setStep('frequency')}>← Indietro</button><button data-testid="onboarding-publishing-next" className="ob-primary" disabled={working} onClick={()=>void saveSocialPreferences('summary')}>Rivedi profilo →</button></div></section>}

          {step==='summary'&&<section className="ob-panel"><PanelHead index="04" title="Pronto per partire" body="Controlla le scelte essenziali. Non serve avere già collegato OpenAI o i social per salvare il profilo."/><div className="ob-review"><Review label="Attività" value={`${summary.activity}${business.industry?` · ${business.industry}`:''}`}/><Review label="Obiettivi" value={summary.goals}/><Review label="Target" value={summary.target}/><Review label="Ritmo" value={summary.rhythm}/><Review label="Canali" value={summary.channels}/><Review label="Regola" value="Anteprima e approvazione umana obbligatorie"/></div><div className="ob-readiness"><div><span className={local.health?.capabilities?.database?'ok':'off'}/><p><strong>Database</strong><small>{local.health?.capabilities?.database?'Pronto':'Da configurare'}</small></p></div><div><span className={aiReady?'ok':'off'}/><p><strong>OpenAI</strong><small>{aiReady?'Pronto':'Potrai configurarlo dal Master'}</small></p></div><div><span className="off"/><p><strong>Social</strong><small>Collegamento API successivo</small></p></div></div><div className="ob-actions"><button className="ob-secondary" onClick={()=>setStep('publishing')}>← Modifica</button><button data-testid="complete-onboarding" className="ob-primary final" disabled={working} onClick={()=>void complete()}>{working?'Attivazione…':'Attiva questo profilo'}</button></div></section>}

          {step==='completed'&&<section className="ob-panel"><PanelHead index="✓" title="Profilo attivo" body="Le impostazioni sono salvate. Ora puoi gestire il lavoro quotidiano dalla dashboard."/><div className="ob-success"><span>✓</span><div><strong>{business.name||'Attività'}</strong><small>Configurazione completata</small></div></div><Link className="ob-primary link" to="/app">Apri dashboard →</Link></section>}
        </section>
        <aside className="ob-summary"><span className="ob-kicker">ANTEPRIMA PROFILO</span><h2>{summary.activity}</h2><dl><div><dt>Obiettivi</dt><dd>{summary.goals}</dd></div><div><dt>Target</dt><dd>{summary.target}</dd></div><div><dt>Canali</dt><dd>{summary.channels}</dd></div><div><dt>Ritmo</dt><dd>{summary.rhythm}</dd></div></dl><div className="ob-summary-foot"><span className="status-dot"/><p><strong>Dati separati</strong><small>Questo profilo avrà memoria, contenuti, calendario e metriche indipendenti.</small></p></div></aside>
      </div>
    </main>
  </div>;
}

function PanelHead({index,title,body}:{index:string;title:string;body:string}){return <div className="ob-panel-head"><span>{index}</span><div><h2>{title}</h2><p>{body}</p></div></div>;}
function Review({label,value}:{label:string;value:string}){return <div><span>{label}</span><strong>{value||'—'}</strong></div>;}
function FocusedState({title,body}:{title:string;body:string}){return <main className="ob-focus-state"><span className="ob-kicker">POST AUTOMATICI</span><h1>{title}</h1><p>{body}</p><Link className="ob-primary link" to="/login">Vai all’accesso</Link></main>;}
function platformLabel(platform: ApiPlatform) { return platforms.find((item)=>item.key===platform)?.label ?? platform; }
function slugify(value: string) { return value.toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'attivita'; }
function providerReady(local:ReturnType<typeof useLocalE2E>,platform:ApiPlatform){if(platform==='instagram'||platform==='facebook')return Boolean(local.health?.capabilities?.instagram||local.health?.capabilities?.facebook);if(platform==='linkedin')return Boolean(local.health?.capabilities?.linkedin);return Boolean(local.health?.capabilities?.googleBusinessProfile);}
function friendlyError(value:string){if(value==='internal_error')return 'Si è verificato un errore interno. La modifica non è stata considerata completata.';if(/OPENAI_NOT_CONFIGURED/i.test(value))return 'OpenAI non è ancora configurato. Puoi comunque salvare il profilo e configurarlo in seguito dalla Control Room Master.';if(/PROVIDER_NOT_CONFIGURED/i.test(value))return 'Il provider non è ancora collegato. La preferenza è stata salvata senza simulare una connessione.';return value.replace(/^neon_data_\d+:/,'');}
