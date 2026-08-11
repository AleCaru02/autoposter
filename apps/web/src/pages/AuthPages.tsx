import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { Seo } from '../components/Seo';
import { localE2EEnabled, useLocalE2E } from '../services/local-e2e';
import './auth-pages.css';

export function LoginPage() {
  const navigate = useNavigate();
  const local = useLocalE2E();
  const [email, setEmail] = useState('e2e@example.test');
  const [password, setPassword] = useState('LocalE2E-password-123!');
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!local.enabled) { setMessage('Modalità mock: configura VITE_LOCAL_API_URL per usare Auth locale.'); return; }
    try { await local.login({ email, password }); navigate('/onboarding'); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  return <AuthLayout path="/login" eyebrow="Accesso" title="Bentornato" description={localE2EEnabled ? 'Accedi al workspace locale. Nessuna credenziale reale di provider viene usata in questa fase.' : 'Accedi al tuo workspace per gestire brand, contenuti e pubblicazioni.'}>
    <form onSubmit={submit} className="auth-form">
      <label className="auth-field"><span>Email</span><input data-testid="login-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
      <label className="auth-field"><span>Password</span><input data-testid="login-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
      <div className="auth-row"><label><input type="checkbox" /> Ricordami</label><Link to="/reset-password">Password dimenticata?</Link></div>
      <button data-testid="login-submit" className="button full" type="submit" disabled={local.loading}>{local.enabled ? 'Accedi al workspace' : 'Accedi · mock'}</button>
      {message && <p role="alert" className="auth-footer">{message}</p>}
    </form>
    <p className="auth-footer">Non hai un account? <Link to="/register">Crea account</Link></p>
  </AuthLayout>;
}

export function RegisterPage() {
  const navigate = useNavigate();
  const local = useLocalE2E();
  const [name, setName] = useState('Utente E2E');
  const [email, setEmail] = useState(`e2e-${Date.now()}@example.test`);
  const [password, setPassword] = useState('LocalE2E-password-123!');
  const [accepted, setAccepted] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!local.enabled) { setMessage('Modalità mock: configura VITE_LOCAL_API_URL per registrare un utente locale.'); return; }
    if (!accepted) { setMessage('Accetta termini e privacy della fixture locale.'); return; }
    try { await local.register({ name, email, password }); navigate('/onboarding'); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };

  return <AuthLayout path="/register" eyebrow="Registrazione" title="Crea il tuo workspace" description={local.enabled ? 'Crea l’utente locale e poi configura brand, sito, canali e livello di automazione nell’onboarding.' : 'Configura il workspace senza pagamenti o collegamenti live in questa fase.'}>
    <form onSubmit={submit} className="auth-form">
      <label className="auth-field"><span>Nome e cognome</span><input data-testid="register-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></label>
      <label className="auth-field"><span>Email di lavoro</span><input data-testid="register-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
      <label className="auth-field"><span>Password</span><input data-testid="register-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={12} required /></label>
      <label className="auth-check"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /> <span>Accetto termini e privacy della fixture di sviluppo locale.</span></label>
      <button data-testid="register-submit" className="button full" type="submit" disabled={local.loading}>{local.enabled ? 'Crea workspace locale' : 'Crea account · mock'}</button>
      {message && <p role="alert" className="auth-footer">{message}</p>}
    </form>
    <p className="auth-footer">Hai già un account? <Link to="/login">Accedi</Link></p>
  </AuthLayout>;
}

export function ResetPasswordPage() {
  return <AuthLayout path="/reset-password" eyebrow="Recupero account" title="Reimposta la password" description="Il recupero password remoto resta intenzionalmente posticipato; l’E2E locale usa credenziali temporanee.">
    <label className="auth-field"><span>Email</span><input type="email" placeholder="nome@azienda.it" autoComplete="email" /></label>
    <button className="button full" type="button" disabled>Invio disattivato in locale</button>
    <p className="auth-footer"><Link to="/login">← Torna all’accesso</Link></p>
  </AuthLayout>;
}

function AuthLayout({ path, eyebrow, title, description, children }: { path: string; eyebrow: string; title: string; description: string; children: ReactNode }) {
  return <div className="auth-page">
    <Seo title={`${title} | SocialPilot AI`} description={description} path={path} noIndex />
    <section className="auth-story" aria-label="Panoramica prodotto">
      <Link className="public-logo auth-logo" to="/"><span className="logo-glyph">S</span><span>SocialPilot AI</span></Link>
      <div className="auth-story-copy"><span className="section-label">Una sola control room</span><h2>Dal brand alla pubblicazione, senza rincorrere cinque strumenti.</h2><p>Configura l’identità una volta. Poi strategia, calendario, contenuti, approvazioni e risultati restano nello stesso workflow.</p><div className="auth-story-points"><div><span>01</span><p><b>Conosci il brand</b><small>Sito, tono, servizi e regole confermate.</small></p></div><div><span>02</span><p><b>Controlla quando serve</b><small>Manuale o automatico, canale per canale.</small></p></div><div><span>03</span><p><b>Capisci cosa fare dopo</b><small>Analytics trasformati in insight leggibili.</small></p></div></div></div>
      <div className="auth-story-status"><span className="status-dot"/><span>{localE2EEnabled ? 'Ambiente locale · provider mock' : 'Workspace protetto'}</span></div>
    </section>
    <main className="auth-workspace">
      <div className="auth-mobile-logo"><Link className="public-logo" to="/"><span className="logo-glyph">S</span><span>SocialPilot AI</span></Link></div>
      <section className="auth-card">
        <span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p className="auth-description">{description}</p>
        <div>{children}</div>
        <div className="auth-safety"><span className="status-dot" /> {localE2EEnabled ? 'Local E2E · nessun provider reale' : 'Nessun collegamento live durante la demo'}</div>
      </section>
    </main>
  </div>;
}
