import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Badge, Card, PageHeader, Progress } from '../components/ui';
import { localE2EEnabled, useLocalE2E, type ApiPlatform, type ApprovalMode } from '../services/local-e2e';

const goals = ['lead','vendite','prenotazioni','notorietà','traffico','personal brand','community','educazione','visite attività locale'];
const platforms: Array<{ key: ApiPlatform; label: string }> = [
  { key: 'instagram', label: 'Instagram' }, { key: 'facebook', label: 'Facebook' }, { key: 'linkedin', label: 'LinkedIn' }, { key: 'google_business_profile', label: 'Google Business Profile' },
];
const steps = ['business','goals','target','brand','social','frequency','publishing','summary','completed'] as const;
const labels: Record<string,string> = { business:'Attività', goals:'Obiettivi', target:'Target', brand:'Brand', social:'Social', frequency:'Frequenza', publishing:'Pubblicazione', summary:'Riepilogo', completed:'Completato' };

export function OnboardingPage() {
  const local = useLocalE2E();
  const navigate = useNavigate();
  const workspace = local.workspace;
  const persistedStep = String(workspace?.onboarding?.current_step ?? 'business');
  const [step, setStep] = useState(persistedStep);
  const [message, setMessage] = useState<string | null>(null);
  const [business, setBusiness] = useState({ name:'Forno Vesuvio', website:'', industry:'Pizzeria', subIndustry:'Pizzeria napoletana', location:'Milano', language:'it', serviceArea:'Milano e dintorni', services:'pizza napoletana, prenotazioni', differentiator:'ingredienti selezionati e attenzione al servizio' });
  const [selectedGoals, setSelectedGoals] = useState<string[]>(['lead','prenotazioni','notorietà']);
  const [target, setTarget] = useState('residenti, famiglie, gruppi locali');
  const [selectedPlatforms, setSelectedPlatforms] = useState<ApiPlatform[]>(['instagram','facebook','google_business_profile']);
  const [postsPerWeek, setPostsPerWeek] = useState(3);
  const [days, setDays] = useState('1,3,5');
  const [times, setTimes] = useState('10:00,18:00');
  const [modes, setModes] = useState<Record<ApiPlatform,ApprovalMode>>({ instagram:'manual', facebook:'auto', linkedin:'auto', google_business_profile:'manual' });

  useEffect(() => { if (workspace?.onboarding?.current_step) setStep(String(workspace.onboarding.current_step)); }, [workspace?.onboarding?.current_step]);
  useEffect(() => {
    const stored = workspace?.onboarding;
    if (!stored) return;
    if (stored.business && Object.keys(stored.business).length) setBusiness((current) => ({ ...current, ...stored.business }));
    if (Array.isArray(stored.goals) && stored.goals.length) setSelectedGoals(stored.goals.map(String));
    if (stored.target?.manual) setTarget(Array.isArray(stored.target.manual) ? stored.target.manual.join(', ') : String(stored.target.manual));
    if (Array.isArray(stored.social) && stored.social.length) setSelectedPlatforms(stored.social as ApiPlatform[]);
    if (stored.frequency?.postsPerWeek) setPostsPerWeek(Number(stored.frequency.postsPerWeek));
    if (Array.isArray(stored.frequency?.days)) setDays(stored.frequency.days.join(','));
    if (Array.isArray(stored.frequency?.times)) setTimes(stored.frequency.times.join(','));
    if (stored.publishing_modes && Object.keys(stored.publishing_modes).length) setModes((current) => ({ ...current, ...stored.publishing_modes }));
  }, [workspace?.onboarding]);

  const stepIndex = Math.max(0, steps.indexOf(step as typeof steps[number]));
  const coverage = Number(workspace?.onboarding?.scan_summary?.coverage ?? 0);
  const run = async (action: () => Promise<unknown>) => {
    setMessage(null);
    try { await action(); await local.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); throw error; }
  };

  if (!localE2EEnabled) return <LegacyOnboarding />;
  if (!local.token) return <><PageHeader eyebrow="Setup locale" title="Accedi per iniziare" description="L'onboarding E2E usa Supabase Auth e database locale." /><Card><Link className="button" to="/register">Crea account locale</Link> <Link className="button secondary" to="/login">Accedi</Link></Card></>;

  const saveBusiness = async (event: FormEvent) => {
    event.preventDefault();
    let tenantId = local.tenantId;
    if (!tenantId) tenantId = await local.createTenant({ name: business.name, slug: `${business.name}-${Date.now()}`.toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') });
    if (!business.website) setBusiness((current) => ({ ...current, website: `${import.meta.env.VITE_LOCAL_API_URL}/fixture-site/pizza-a/` }));
    const payload = { ...business, website: business.website || `${import.meta.env.VITE_LOCAL_API_URL}/fixture-site/pizza-a/` };
    await run(() => local.api(`/tenants/${tenantId}/onboarding`, { method:'PATCH', body:JSON.stringify({ business: payload, current_step:'goals' }) }));
    setStep('goals');
  };

  const saveStep = async (next: string, patch: Record<string,unknown>) => {
    if (!local.tenantId) throw new Error('tenant_missing');
    await run(() => local.api(`/tenants/${local.tenantId}/onboarding`, { method:'PATCH', body:JSON.stringify({ ...patch, current_step: next }) }));
    setStep(next);
  };

  const scan = async () => {
    if (!local.tenantId) return;
    await run(() => local.api(`/tenants/${local.tenantId}/scan`, { method:'POST' }));
    setStep('brand');
  };

  const configureSocial = async (next = 'frequency') => {
    if (!local.tenantId) return;
    await run(() => local.api(`/tenants/${local.tenantId}/social`, { method:'POST', body:JSON.stringify({ platforms:selectedPlatforms, publishingModes:modes }) }));
    await saveStep(next, { social:selectedPlatforms, publishing_modes:modes });
  };

  const complete = async () => {
    if (!local.tenantId) return;
    await run(() => local.api(`/tenants/${local.tenantId}/onboarding/complete`, { method:'POST' }));
    navigate('/app/strategy');
  };

  return <>
    <PageHeader eyebrow="Setup guidato · database locale" title="Costruiamo il contesto del brand" description="Ogni passaggio salva realmente nel Supabase Docker locale. Scanner, Brand Profile, strategia e social mock usano gli stessi contratti previsti per la produzione." />
    <Card><div className="onboarding-top"><div><strong>Passaggio {Math.min(stepIndex + 1, steps.length)} di {steps.length}</strong><span>{labels[step] ?? step}</span></div><Progress value={stepIndex + 1} max={steps.length} label="Completamento" /></div><div className="step-strip">{steps.map((item,index)=><span className={index < stepIndex ? 'done' : index === stepIndex ? 'current' : ''} key={item}>{index+1}<small>{labels[item]}</small></span>)}</div></Card>
    {message && <Card><p role="alert"><strong>Errore locale:</strong> {message}</p></Card>}

    {step === 'business' && <Card><span className="eyebrow">Attività</span><h2>Dati di base</h2><form onSubmit={saveBusiness} className="stack">
      <TextField testId="business-name" label="Nome attività" value={business.name} onChange={(value)=>setBusiness({...business,name:value})}/>
      <TextField testId="business-website" label="Sito" value={business.website} placeholder={`${import.meta.env.VITE_LOCAL_API_URL}/fixture-site/pizza-a/`} onChange={(value)=>setBusiness({...business,website:value})}/>
      <div className="two-col"><TextField label="Settore" value={business.industry} onChange={(value)=>setBusiness({...business,industry:value})}/><TextField label="Sotto-settore" value={business.subIndustry} onChange={(value)=>setBusiness({...business,subIndustry:value})}/></div>
      <div className="two-col"><TextField label="Località" value={business.location} onChange={(value)=>setBusiness({...business,location:value})}/><TextField label="Lingua" value={business.language} onChange={(value)=>setBusiness({...business,language:value})}/></div>
      <TextField label="Area servita" value={business.serviceArea} onChange={(value)=>setBusiness({...business,serviceArea:value})}/><TextField label="Servizi (separati da virgola)" value={business.services} onChange={(value)=>setBusiness({...business,services:value})}/><TextField label="Differenziatore" value={business.differentiator} onChange={(value)=>setBusiness({...business,differentiator:value})}/>
      <button data-testid="onboarding-business-next" className="button" type="submit">Salva e continua</button>
    </form></Card>}

    {step === 'goals' && <Card><span className="eyebrow">Obiettivi</span><h2>Cosa deve ottenere il piano editoriale?</h2><div className="pillar-grid">{goals.map((goal)=><label className="toggle-row" key={goal}><span><strong>{goal}</strong></span><input data-testid={`goal-${goal}`} type="checkbox" checked={selectedGoals.includes(goal)} onChange={(event)=>setSelectedGoals(event.target.checked ? [...selectedGoals,goal] : selectedGoals.filter((item)=>item!==goal))}/></label>)}</div><button data-testid="onboarding-goals-next" className="button" onClick={()=>void saveStep('target',{goals:selectedGoals})}>Continua</button></Card>}

    {step === 'target' && <Card><span className="eyebrow">Target</span><h2>Pubblico principale</h2><label className="field"><span>Target manuale</span><textarea data-testid="target-input" value={target} onChange={(event)=>setTarget(event.target.value)}/></label><p className="muted">Suggerimento mock: clienti locali con un bisogno concreto e intenzione misurabile. Puoi sostituirlo.</p><button data-testid="onboarding-target-next" className="button" onClick={()=>void saveStep('brand',{target:{manual:target.split(',').map((item)=>item.trim()).filter(Boolean),suggestions:['clienti locali','utenti ad alta intenzione']}})}>Salva target</button></Card>}

    {step === 'brand' && <div className="two-col"><Card><span className="eyebrow">Website scanner</span><h2>Analisi reale locale</h2><p>Il backend segue URL same-origin, salva pagine e copertura, quindi genera una nuova versione Brand Profile.</p><button data-testid="scan-website" className="button" onClick={()=>void scan()}>Avvia / riesegui scansione</button>{workspace?.onboarding?.scan_summary && <div className="stack"><Badge tone={workspace.onboarding.scan_summary.status === 'failed' ? 'warn':'good'}>{String(workspace.onboarding.scan_summary.status)}</Badge><strong>Copertura {coverage}%</strong><small>{String(workspace.onboarding.scan_summary.analyzed ?? 0)} URL analizzati · {String(workspace.onboarding.scan_summary.discovered ?? 0)} trovati</small>{Array.isArray(workspace.onboarding.scan_summary.urls) && <ul className="check-list">{workspace.onboarding.scan_summary.urls.slice(0,8).map((item:any)=><li key={item.url}>{item.url} · {item.status}</li>)}</ul>}</div>}</Card><Card><span className="eyebrow">Brand Profile</span><h2>{workspace?.brand?.brand_name ?? 'Generato dopo la scansione'}</h2>{workspace?.brand ? <><p>{workspace.brand.description}</p><p><strong>Settore:</strong> {workspace.brand.industry}</p><p><strong>Target:</strong> {arrayText(workspace.brand.target)}</p><p><strong>Servizi:</strong> {arrayText(workspace.brand.services)}</p><div className="card-actions"><Link className="button secondary" to="/app/brand">Modifica profilo</Link><button data-testid="confirm-brand" className="button" onClick={()=>void run(()=>local.api(`/tenants/${local.tenantId}/brand/status`,{method:'POST',body:JSON.stringify({status:'confirmed'})})).then(()=>saveStep('social',{}))}>Conferma e continua</button></div></> : <p className="muted">Avvia la scansione per creare la prima versione.</p>}</Card></div>}

    {step === 'social' && <Card><span className="eyebrow">Social</span><h2>Canali iniziali</h2>{platforms.map(({key,label})=><label className="toggle-row" key={key}><span><strong>{label}</strong><small>Connessione MOCK, contratto provider reale</small></span><input data-testid={`platform-${key}`} type="checkbox" checked={selectedPlatforms.includes(key)} onChange={(event)=>setSelectedPlatforms(event.target.checked ? [...selectedPlatforms,key] : selectedPlatforms.filter((item)=>item!==key))}/></label>)}<button data-testid="onboarding-social-next" className="button" onClick={()=>void configureSocial('frequency')}>Salva canali</button></Card>}

    {step === 'frequency' && <Card><span className="eyebrow">Frequenza</span><h2>Ritmo editoriale</h2><label className="field"><span>Post / settimana</span><input data-testid="posts-per-week" type="number" min="1" max="14" value={postsPerWeek} onChange={(event)=>setPostsPerWeek(Number(event.target.value))}/></label><label className="field"><span>Giorni ISO (1=lunedì)</span><input value={days} onChange={(event)=>setDays(event.target.value)}/></label><label className="field"><span>Orari</span><input value={times} onChange={(event)=>setTimes(event.target.value)}/></label><button data-testid="onboarding-frequency-next" className="button" onClick={()=>void saveStep('publishing',{frequency:{postsPerWeek,days:days.split(',').map(Number).filter(Number.isFinite),times:times.split(',').map((item)=>item.trim()).filter(Boolean)}})}>Continua</button></Card>}

    {step === 'publishing' && <Card><span className="eyebrow">AUTO / MANUALE</span><h2>Preferenza per piattaforma</h2>{selectedPlatforms.map((platform)=><label className="field" key={platform}><span>{platformLabel(platform)}</span><select data-testid={`mode-${platform}`} value={modes[platform]} onChange={(event)=>setModes({...modes,[platform]:event.target.value as ApprovalMode})}><option value="manual">MANUALE</option><option value="auto">AUTO</option></select></label>)}<button data-testid="onboarding-publishing-next" className="button" onClick={()=>void configureSocial('summary')}>Salva modalità</button></Card>}

    {step === 'summary' && <Card><span className="eyebrow">Riepilogo</span><h2>Pronto a generare la prima strategia</h2><ul className="check-list"><li>{business.name} · {business.industry}</li><li>Obiettivi: {selectedGoals.join(', ')}</li><li>Target: {target}</li><li>{postsPerWeek} post/settimana</li><li>Canali: {selectedPlatforms.map(platformLabel).join(', ')}</li><li>Modalità: {selectedPlatforms.map((item)=>`${platformLabel(item)}=${modes[item].toUpperCase()}`).join(' · ')}</li></ul><button data-testid="complete-onboarding" className="button" onClick={()=>void complete()}>Completa onboarding e genera strategia</button></Card>}

    {step === 'completed' && <Card><Badge tone="good">Completato</Badge><h2>Onboarding completato</h2><p>Brand Profile, social, frequenza e preferenze sono persistiti nel database locale.</p><Link className="button" to="/app/strategy">Apri strategia</Link></Card>}
  </>;
}

function TextField({label,value,onChange,placeholder,testId}:{label:string;value:string;onChange:(value:string)=>void;placeholder?:string;testId?:string}) { return <label className="field"><span>{label}</span><input data-testid={testId} value={value} placeholder={placeholder} onChange={(event)=>onChange(event.target.value)} required={label === 'Nome attività'}/></label>; }
function arrayText(value: unknown) { return Array.isArray(value) ? value.join(', ') : String(value ?? '—'); }
function platformLabel(platform: ApiPlatform) { return platforms.find((item)=>item.key===platform)?.label ?? platform; }

function LegacyOnboarding() {
  return <><PageHeader eyebrow="Setup guidato" title="Costruiamo il contesto del brand" description="Configura VITE_LOCAL_API_URL per attivare il wizard persistente. In assenza dell'API resta disponibile la shell mock." /><Card><span className="eyebrow">Modalità mock</span><h2>Local E2E non attivo</h2><p>Nessun dato viene scritto a servizi remoti.</p><Progress value={3} max={10} label="Shell dimostrativa" /></Card></>;
}
