import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { Seo } from '../components/Seo';
import { internalE2EFixturesEnabled, useLocalE2E } from '../services/local-e2e';
import './auth-pages.css';

const fixtureEmail = internalE2EFixturesEnabled ? 'e2e@example.test' : '';
const fixturePassword = internalE2EFixturesEnabled ? 'LocalE2E-password-123!' : '';

export function LoginPage() {
  const navigate = useNavigate();
  const local = useLocalE2E();
  const [email, setEmail] = useState(fixtureEmail);
  const [password, setPassword] = useState(fixturePassword);
  const [showPassword,setShowPassword]=useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();setMessage(null);
    if (!local.enabled) { setMessage('Accesso non disponibile: backend non collegato.'); return; }
    try {
      await local.login({ email, password });
      if(internalE2EFixturesEnabled){navigate('/onboarding');return;}
      try{await local.api('/admin/customers');navigate('/admin');}
      catch{await local.refreshTenants().catch(()=>undefined);navigate('/app');}
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  return <AuthLayout path="/login" eyebrow="Accesso" title="Bentornato" description="Accedi al tuo workspace. Gli account master entrano direttamente nella control room amministrativa.">
    <form onSubmit={submit} className="auth-form">
      <label className="auth-field"><span>Email</span><input data-testid="login-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
      <PasswordField testId="login-password" label="Password" value={password} onChange={setPassword} show={showPassword} onToggle={()=>setShowPassword((value)=>!value)} autoComplete="current-password" />
      <div className="auth-row"><span>Sessione protetta</span><Link to="/reset-password">Password dimenticata?</Link></div>
      <button data-testid="login-submit" className="button full" type="submit" disabled={local.loading || !local.enabled}>Accedi</button>
      {message && <p role="alert" className="auth-footer">{message}</p>}
    </form>
    <p className="auth-footer">Non hai un account? <Link to="/register">Crea account</Link></p>
  </AuthLayout>;
}

export function RegisterPage() {
  const navigate = useNavigate();
  const local = useLocalE2E();
  const [name, setName] = useState(internalE2EFixturesEnabled ? 'Utente E2E' : '');
  const [email, setEmail] = useState(internalE2EFixturesEnabled ? `e2e-${Date.now()}@example.test` : '');
  const [password, setPassword] = useState(fixturePassword);
  const [showPassword,setShowPassword]=useState(false);
  const [accepted, setAccepted] = useState(internalE2EFixturesEnabled);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();setMessage(null);
    if (!local.enabled) { setMessage('Registrazione non disponibile: backend non collegato.'); return; }
    if (!accepted) { setMessage('Devi accettare termini e privacy.'); return; }
    try { await local.register({ name, email, password }); navigate('/onboarding?new=1'); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  return <AuthLayout path="/register" eyebrow="Registrazione" title="Crea il workspace" description="Dopo l’accesso configuri la prima attività. Ogni profilo mantiene dati, sito, social, calendario e metriche separati.">
    <form onSubmit={submit} className="auth-form">
      <label className="auth-field"><span>Nome e cognome</span><input data-testid="register-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></label>
      <label className="auth-field"><span>Email</span><input data-testid="register-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
      <PasswordField testId="register-password" label="Password" value={password} onChange={setPassword} show={showPassword} onToggle={()=>setShowPassword((value)=>!value)} autoComplete="new-password" minLength={12}/>
      <p className="auth-hint">Minimo 12 caratteri. Puoi mostrarla solo mentre la stai inserendo; l’admin non può leggere le password degli utenti.</p>
      <label className="auth-check"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /> <span>Accetto termini e privacy.</span></label>
      <button data-testid="register-submit" className="button full" type="submit" disabled={local.loading || !local.enabled}>Crea account</button>
      {message && <p role="alert" className="auth-footer">{message}</p>}
    </form>
    <p className="auth-footer">Hai già un account? <Link to="/login">Accedi</Link></p>
  </AuthLayout>;
}

export function ResetPasswordPage() {
  const local = useLocalE2E();
  return <AuthLayout path="/reset-password" eyebrow="Recupero account" title="Reimposta la password" description="Il recupero via email resta disabilitato finché il servizio email non è configurato realmente.">
    <label className="auth-field"><span>Email</span><input type="email" placeholder="nome@azienda.it" autoComplete="email" /></label>
    <button className="button full" type="button" disabled>Invia link di recupero</button>
    <p className="auth-footer">{local.enabled?'Servizio email da configurare.':'Backend da configurare.'}</p>
    <p className="auth-footer"><Link to="/login">← Torna all’accesso</Link></p>
  </AuthLayout>;
}

function PasswordField({label,value,onChange,show,onToggle,testId,autoComplete,minLength}:{label:string;value:string;onChange:(value:string)=>void;show:boolean;onToggle:()=>void;testId:string;autoComplete:string;minLength?:number}){
  return <label className="auth-field"><span>{label}</span><div className="auth-password-wrap"><input data-testid={testId} type={show?'text':'password'} value={value} onChange={(event)=>onChange(event.target.value)} autoComplete={autoComplete} minLength={minLength} required/><button type="button" className="auth-password-toggle" onClick={onToggle} aria-label={show?'Nascondi password':'Mostra password'}>{show?'Nascondi':'Mostra'}</button></div></label>;
}

function AuthLayout({ path, eyebrow, title, description, children }: { path: string; eyebrow: string; title: string; description: string; children: ReactNode }) {
  return <div className="auth-page">
    <Seo title={`${title} | Post Automatici`} description={description} path={path} noIndex />
    <section className="auth-story" aria-label="Panoramica prodotto">
      <Link className="public-logo auth-logo" to="/"><span className="logo-glyph">P</span><span>Post Automatici</span></Link>
      <div className="auth-story-copy"><span className="section-label">Control room personale</span><h2>Brand, contenuti, social e risultati nello stesso flusso.</h2><p>Le integrazioni esistono solo quando sono realmente configurate. Nessun numero o collegamento viene simulato nell’uso normale.</p><div className="auth-story-points"><div><span>01</span><p><b>Profili separati</b><small>Ogni attività mantiene memoria e dati indipendenti.</small></p></div><div><span>02</span><p><b>Approvazione umana</b><small>Nessuna pubblicazione parte senza il tuo consenso.</small></p></div><div><span>03</span><p><b>Master control</b><small>L’account master gestisce utenti, attività, API e diagnostica.</small></p></div></div></div>
      <div className="auth-story-status"><span className="status-dot"/><span>{internalE2EFixturesEnabled ? 'Test harness interno' : 'Workspace protetto'}</span></div>
    </section>
    <main className="auth-workspace"><div className="auth-mobile-logo"><Link className="public-logo" to="/"><span className="logo-glyph">P</span><span>Post Automatici</span></Link></div><section className="auth-card"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p className="auth-description">{description}</p><div>{children}</div><div className="auth-safety"><span className="status-dot" /> Le password utenti non vengono mai mostrate o salvate in chiaro</div></section></main>
  </div>;
}
