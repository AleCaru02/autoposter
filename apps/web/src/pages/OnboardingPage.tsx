import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Badge, Card, PageHeader, Progress } from '../components/ui';
import { localE2EEnabled, useLocalE2E, type ApiPlatform, type ApprovalMode } from '../services/local-e2e';

const goals = ['lead','vendite','prenotazioni','notorietà','traffico','personal brand','community','educazione','visite attività locale'];
const platforms: Array<{ key: ApiPlatform; label: string }> = [
  { key: 'instagram', label: 'Instagram' }, { key: 'facebook', label: 'Facebook' }, { key: 'linkedin', label: 'LinkedIn' }, { key: 'google_business_profile', label: 'Google Business Profile' },
];
const steps = ['business','goals','target','brand','social','frequency','publishing','summary','completed'] as const;
const labels: Record<string,string> = { business:'Attività', goals:'Obiettivi', target:'Target', brand:'Brand', social:'Social', frequency:'Frequenza', publishing:'Pubblicazione', summary:'Riepilogo', completed:'Completato' };
const isDemoMode = import.meta.env.VITE_APP_DATA_MODE === 'DEMO';
const emptyBusiness = { name:'', website:'', industry:'', subIndustry:'', location:'', language:'it', serviceArea:'', services:'', differentiator:'' };
const demoBusiness = { name:'Forno Vesuvio', website:'', industry:'Pizzeria', subIndustry:'Pizzeria napoletana', location:'Milano', language:'it', serviceArea:'Milano e dintorni', services:'pizza napoletana, prenotazioni', differentiator:'ingredienti selezionati e attenzione al servizio' };

export function OnboardingPage() {
  const local = useLocalE2E();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const createNew = searchParams.get('new') === '1';
  const workspace = local.workspace;
  const persistedStep = createNew ? 'business' : String(workspace?.onboarding?.current_step ?? 'business');
  const [step, setStep] = useState(persistedStep);
  const [message, setMessage] = useState<string | null>(null);
  const [business, setBusiness] = useState(() => ({ ...(isDemoMode ? demoBusiness : emptyBusiness) }));
  const [selectedGoals, setSelectedGoals] = useState<string[]>(() => isDemoMode ? ['lead','prenotazioni','notorietà'] : []);
  const [target, setTarget] = useState(() => isDemoMode ? 'residenti, famiglie, gruppi locali' : '');
  const [selectedPlatforms, setSelectedPlatforms] = useState<ApiPlatform[]>(() => isDemoMode ? ['instagram','facebook','google_business_profile'] : []);
  const [postsPerWeek, setPostsPerWeek] = useState(3);
  const [days, setDays] = useState('1,3,5');
  const [times, setTimes] = useState('10:00,18:00');
  const [modes, setModes] = useState<Record<ApiPlatform,ApprovalMode>>({ instagram:'manual', facebook:'manual', linkedin:'manual', google_business_profile:'manual' });

  useEffect(() => {
    if (createNew) {
      setStep('business');
      setBusiness({ ...(isDemoMode ? demoBusiness : emptyBusiness) });
      setSelectedGoals(isDemoMode ? ['lead','prenotazioni','notorietà'] : []);
      setTarget(isDemoMode ? 'residenti, famiglie, gruppi locali' : '');
      setSelectedPlatforms(isDemoMode ? ['instagram','facebook','google_business_profile'] : []);
      return;
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

  const stepIndex = Math.max(0, steps.indexOf(step as typeof steps[number]));
  const coverage = Number(workspace?.onboarding?.scan_summary?.coverage ?? 0);
  const run = async (action: () => Promise<unknown>) => {
    setMessage(null);
    try { await action(); await local.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); throw error; }
  };

  if (!localE2EEnabled) return <LegacyOnboarding />;
  if (!local.token) return <><PageHeader eyebrow="Post Automatici" title="Accedi per iniziare" description="L’onboarding persistente richiede il backend configurato. Nessun account cloud viene simulato." /><Card><Link className="button" to="/register">Crea account</Link> <Link className="button secondary" to="/login">Accedi</Link></Card></>;

  const saveBusiness = async (event: FormEvent) => {
    event.preventDefault();
    if (!business.name.trim()) { setMessage('Inserisci il nome dell’attività.'); return; }
    setMessage(null);
    try {
      let tenantId = createNew ? null : local.tenantId;
      if (!tenantId) tenantId = await local.createTenant({ name: business.name.trim(), slug: `${slugify(business.name)}-${Date.now()}` });
      const demoWebsite = `${import.meta.env.VITE_LOCAL_API_URL}/fixture-site/pizza-a/`;
      const payload = { ...business, name: business.name.trim(), website: business.website.trim() || (isDemoMode ? demoWebsite : '') };
      if (isDemoMode && !business.website) setBusiness(payload);
      await local.api(`/tenants/${tenantId}/onboarding`, { method:'PATCH', body:JSON.stringify({ business: payload, current_step:'goals' }) });
      await local.refresh(tenantId);
      setStep('goals');
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  const saveStep = async (next: string, patch: Record<string,unknown>) => {
    if (!local.tenantId) throw new Error('tenant_missing');
    await run(() => local.api(`/tenants/${local.tenantId}/onboarding`, { method:'PATCH', body:JSON.stringify({ ...patch, current_step: next }) }));
    setStep(next);
  };

  const scan = async () => {
    if (!local.tenantId) return;
    if (!business.website.trim()) { setMessage('Nessun sito configurato: aggiungi un URL reale oppure continua senza scansione.'); return; }
    await run(() => local.api(`/tenants/${local.tenantId}/scan`, { method:'POST' }));
    setStep('brand');
  };

  const configureSocial = async (next = 'frequency') => {
    if (!local.tenantId) return;
    if (isDemoMode) await run(() => local.api(`/tenants/${local.tenantId}/social`, { method:'POST', body:JSON.stringify({ platforms:selectedPlatforms, publishingModes:modes }) }));
    await saveStep(next, { social:selectedPlatforms, publishing_modes:modes });
  };

  const complete = async () => {
    if (!local.tenantId) return;
    if (isDemoMode) {
      await run(() => local.api(`/tenants/${local.tenantId}/onboarding/complete`, { method:'POST' }));
      navigate('/app/strategy');
      return;
    }
    await run(() => local.api(`/tenants/${local.tenantId}/onboarding`, { method:'PATCH', body:JSON.stringify({ current_step:'completed' }) }));
    setStep('completed');
  };

  return <>
    <PageHeader eyebrow={createNew ? 'Nuova attività' : 'Setup guidato'} title={createNew ? 'Crea un profilo indipendente' : 'Costruiamo il contesto del brand'} description={isDemoMode ? 'Modalità DEMO esplicita per test automatici: le fixture restano separate dai dati personali.' : 'Ogni passaggio salva dati reali del profilo attivo. Integrazioni esterne non configurate restano bloccate e visibili come tali.'} />
    <Card><div className="onboarding-top"><div><strong>Passaggio {Math.min(stepIndex + 1, steps.length)} di {steps.length}</strong><span>{labels[step] ?? step}</span></div><Progress value={stepIndex + 1} max={steps.length} label="Completamento" /></div><div className="step-strip">{steps.map((item,index)=><span className={index < stepIndex ? 'done' : index === stepIndex ? 'current' : ''} key={item}>{index+1}<small>{labels[item]}</small></span>)}</div></Card>
    {message && <Card><p role="alert"><strong>Stato:</strong> {message}</p></Card>}

    {step === 'business' && <Card><span className="eyebrow">Attività</span><h2>Dati di base</h2><form onSubmit={saveBusiness} className="stack">
      <TextField testId="business-name" label="Nome attività" value={business.name} onChange={(value)=>setBusiness({...business,name:value})}/>
      <TextField testId="business-website" label="Sito" value={business.website} placeholder="https://www.tua-attivita.it" onChange={(value)=>setBusiness({...business,website:value})}/>
      <div className="two-col"><TextField label="Settore" value={business.industry} onChange={(value)=>setBusiness({...business,industry:value})}/><TextField label="Sotto-settore" value={business.subIndustry} onChange={(value)=>setBusiness({...business,subIndustry:value})}/></div>
      <div className="two-col"><TextField label="Località" value={business.location} onChange={(value)=>setBusiness({...business,location:value})}/><TextField label="Lingua" value={business.language} onChange={(value)=>setBusiness({...business,language:value})}/></div>
      <TextField label="Area servita" value={business.serviceArea} onChange={(value)=>setBusiness({...business,serviceArea:value})}/><TextField label="Servizi (separati da virgola)" value={business.services} onChange={(value)=>setBusiness({...business,services:value})}/><TextField label="Differenziatore" value={business.differentiator} onChange={(value)=>setBusiness({...business,differentiator:value})}/>
      <button data-testid="onboarding-business-next" className="button" type="submit">Salva e continua</button>
    </form></Card>}

    {step === 'goals' && <Card><span className="eyebrow">Obiettivi</span><h2>Cosa deve ottenere il piano editoriale?</h2><div className="pillar-grid">{goals.map((goal)=><label className="toggle-row" key={goal}><span><strong>{goal}</strong></span><input data-testid={`goal-${goal}`} type="checkbox" checked={selectedGoals.includes(goal)} onChange={(event)=>setSelectedGoals(event.target.checked ? [...selectedGoals,goal] : selectedGoals.filter((item)=>item!==goal))}/></label>)}</div><button data-testid="onboarding-goals-next" className="button" onClick={()=>void saveStep('target',{goals:selectedGoals})}>Continua</button></Card>}

    {step === 'target' && <Card><span className="eyebrow">Target</span><h2>Pubblico principale</h2><label className="field"><span>Target manuale</span><textarea data-testid="target-input" value={target} onChange={(event)=>setTarget(event.target.value)}/></label><p className="muted">Descrivi il pubblico reale. Nessun target viene inventato in modalità personale.</p><button data-testid="onboarding-target-next" className="button" onClick={()=>void saveStep('brand',{target:{manual:target.split(',').map((item)=>item.trim()).filter(Boolean),suggestions:isDemoMode ? ['clienti locali','utenti ad alta intenzione'] : []}})}>Salva target</button></Card>}

    {step === 'brand' && <div className="two-col"><Card><span className="eyebrow">Website scanner</span><h2>Analisi pagina per pagina</h2><p>{business.website ? 'Il backend segue URL same-origin, sitemap e link interni; salva pagine e copertura verificata.' : 'Nessun sito configurato. Puoi continuare e completare il brand manualmente.'}</p><button data-testid="scan-website" className="button" disabled={!business.website.trim()} onClick={()=>void scan()}>Avvia / riesegui scansione</button>{!business.website.trim() && <button className="button secondary" type="button" onClick={()=>void saveStep('social',{})}>Continua senza sito</button>}{workspace?.onboarding?.scan_summary && <div className="stack"><Badge tone={workspace.onboarding.scan_summary.status === 'failed' ? 'warn':'good'}>{String(workspace.onboarding.scan_summary.status)}</Badge><strong>Copertura {coverage}%</strong><small>{String(workspace.onboarding.scan_summary.analyzed ?? 0)} URL analizzati · {String(workspace.onboarding.scan_summary.discovered ?? 0)} trovati</small>{Array.isArray(workspace.onboarding.scan_summary.urls) && <ul className="check-list">{workspace.onboarding.scan_summary.urls.slice(0,8).map((item:any)=><li key={item.url}>{item.url} · {item.status}</li>)}</ul>}</div>}</Card><Card><span className="eyebrow">Brand Profile</span><h2>{workspace?.brand?.brand_name ?? 'Da completare'}</h2>{workspace?.brand ? <><p>{workspace.brand.description}</p><p><strong>Settore:</strong> {workspace.brand.industry}</p><p><strong>Target:</strong> {arrayText(workspace.brand.target)}</p><p><strong>Servizi:</strong> {arrayText(workspace.brand.services)}</p><div className="card-actions"><Link className="button secondary" to="/app/brand">Modifica profilo</Link><button data-testid="confirm-brand" className="button" onClick={()=>void run(()=>local.api(`/tenants/${local.tenantId}/brand/status`,{method:'POST',body:JSON.stringify({status:'confirmed'})})).then(()=>saveStep('social',{}))}>Conferma e continua</button></div></> : <><p className="muted">La scansione reale può creare una prima versione; senza sito il brand resta da compilare manualmente.</p>{business.website.trim() && <button className="button secondary" type="button" onClick={()=>void saveStep('social',{})}>Continua senza Brand Profile</button>}</>}</Card></div>}

    {step === 'social' && <Card><span className="eyebrow">Social</span><h2>Canali iniziali</h2>{platforms.map(({key,label})=><label className="toggle-row" key={key}><span><strong>{label}</strong><small>{isDemoMode ? 'Fixture DEMO esplicita' : 'Provider/API da configurare: qui salvi solo la preferenza'}</small></span><input data-testid={`platform-${key}`} type="checkbox" checked={selectedPlatforms.includes(key)} onChange={(event)=>setSelectedPlatforms(event.target.checked ? [...selectedPlatforms,key] : selectedPlatforms.filter((item)=>item!==key))}/></label>)}<button data-testid="onboarding-social-next" className="button" onClick={()=>void configureSocial('frequency')}>Salva canali</button></Card>}

    {step === 'frequency' && <Card><span className="eyebrow">Frequenza</span><h2>Ritmo editoriale</h2><label className="field"><span>Post / settimana</span><input data-testid="posts-per-week" type="number" min="1" max="14" value={postsPerWeek} onChange={(event)=>setPostsPerWeek(Number(event.target.value))}/></label><label className="field"><span>Giorni ISO (1=lunedì)</span><input value={days} onChange={(event)=>setDays(event.target.value)}/></label><label className="field"><span>Orari</span><input value={times} onChange={(event)=>setTimes(event.target.value)}/></label><button data-testid="onboarding-frequency-next" className="button" onClick={()=>void saveStep('publishing',{frequency:{postsPerWeek,days:days.split(',').map(Number).filter(Number.isFinite),times:times.split(',').map((item)=>item.trim()).filter(Boolean)}})}>Continua</button></Card>}

    {step === 'publishing' && <Card><span className="eyebrow">Preferenze future</span><h2>Approvazione per piattaforma</h2><p className="muted">AUTO è solo una preferenza salvata. Non abilita pubblicazioni finché l’adapter del provider non è realmente collegato.</p>{selectedPlatforms.map((platform)=><label className="field" key={platform}><span>{platformLabel(platform)}</span><select data-testid={`mode-${platform}`} value={modes[platform]} onChange={(event)=>setModes({...modes,[platform]:event.target.value as ApprovalMode})}><option value="manual">MANUALE</option><option value="auto">AUTO (quando supportato)</option></select></label>)}<button data-testid="onboarding-publishing-next" className="button" onClick={()=>void configureSocial('summary')}>Salva modalità</button></Card>}

    {step === 'summary' && <Card><span className="eyebrow">Riepilogo</span><h2>Profilo pronto</h2><ul className="check-list"><li>{business.name} · {business.industry || 'settore da completare'}</li><li>Obiettivi: {selectedGoals.join(', ') || 'da definire'}</li><li>Target: {target || 'da definire'}</li><li>{postsPerWeek} post/settimana</li><li>Canali: {selectedPlatforms.map(platformLabel).join(', ') || 'nessuno selezionato'}</li><li>Modalità: {selectedPlatforms.map((item)=>`${platformLabel(item)}=${modes[item].toUpperCase()}`).join(' · ') || '—'}</li></ul><button data-testid="complete-onboarding" className="button" onClick={()=>void complete()}>{isDemoMode ? 'Completa DEMO e genera strategia fixture' : 'Completa onboarding'}</button></Card>}

    {step === 'completed' && <Card><Badge tone="good">Completato</Badge><h2>Onboarding completato</h2><p>Dati attività, frequenza e preferenze sono persistiti per questo profilo. OpenAI e provider social restano da configurare prima di generare o pubblicare contenuti live.</p><Link className="button" to="/app">Apri dashboard</Link></Card>}
  </>;
}

function TextField({label,value,onChange,placeholder,testId}:{label:string;value:string;onChange:(value:string)=>void;placeholder?:string;testId?:string}) { return <label className="field"><span>{label}</span><input data-testid={testId} value={value} placeholder={placeholder} onChange={(event)=>onChange(event.target.value)} required={label === 'Nome attività'}/></label>; }
function arrayText(value: unknown) { return Array.isArray(value) ? value.join(', ') : String(value ?? '—'); }
function platformLabel(platform: ApiPlatform) { return platforms.find((item)=>item.key===platform)?.label ?? platform; }
function slugify(value: string) { return value.toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'attivita'; }

function LegacyOnboarding() {
  return <><PageHeader eyebrow="Post Automatici" title="Backend da configurare" description="L’onboarding persistente non viene simulato senza API/database. Collega il backend per creare e salvare attività reali." /><Card><Badge tone="warn">NON DISPONIBILE</Badge><h2>Nessun database collegato</h2><p>Le funzioni pubbliche restano visibili, ma i dati personali non vengono inventati né salvati in una falsa sessione cloud.</p><Progress value={0} max={1} label="Backend personale" /></Card></>;
}
