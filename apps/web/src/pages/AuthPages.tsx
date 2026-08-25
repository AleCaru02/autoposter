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
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!local.enabled) {
      setMessage('Accesso non disponibile: il backend di produzione non è ancora collegato.');
      return;
    }
    try {
      await local.login({ email, password });
      navigate('/onboarding');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return <AuthLayout path="/login" eyebrow="Accesso" title="Bentornato" description="Accedi al tuo workspace per gestire attività, brand, contenuti, approvazioni e pubblicazioni.">
    <form onSubmit={submit} className="auth-form">
      <label className="auth-field"><span>Email</span><input data-testid="login-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
      <label className="auth-field"><span>Password</span><input data-testid="login-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
      <div className="auth-row"><label><input type="checkbox" /> Ricordami</label><Link to="/reset-password">Password dimenticata?</Link></div>
      <button data-testid="login-submit" className="button full" type="submit" disabled={local.loading || !local.enabled}>Accedi al workspace</button>
      {!local.enabled && <p className="auth-footer">Backend di produzione: da collegare.</p>}
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
  const [accepted, setAccepted] = useState(internalE2EFixturesEnabled);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!local.enabled) {
      setMessage('Registrazione non disponibile: il backend di produzione non è ancora collegato.');
      return;
    }
    if (!accepted) {
      setMessage('Devi accettare termini e privacy per creare l’account.');
      return;
    }
    try {
      await local.register({ name, email, password });
      navigate('/onboarding');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return <AuthLayout path="/register" eyebrow="Registrazione" title="Crea il tuo workspace" description="Crea il tuo account e poi configura la prima attività. Ogni attività manterrà dati, brand, sito, social, contenuti, calendario, metriche e apprendimento separati.">
    <form onSubmit={submit} className="auth-form">
      <label className="auth-field"><span>Nome e cognome</span><input data-testid="register-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></label>
      <label className="auth-field"><span>Email</span><input data-testid="register-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
      <label className="auth-field"><span>Password</span><input data-testid="register-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={12} required /></label>
      <label className="auth-check"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /> <span>Accetto termini e privacy.</span></label>
      <button data-testid="register-submit" className="button full" type="submit" disabled={local.loading || !local.enabled}>Crea account</button>
      {!local.enabled && <p className="auth-footer">Backend di produzione: da collegare.</p>}
      {message && <p role="alert" className="auth-footer">{message}</p>}
    </form>
    <p className="auth-footer">Hai già un account? <Link to="/login">Accedi</Link></p>
  </AuthLayout>;
}

export function ResetPasswordPage() {
  const local = useLocalE2E();
  return <AuthLayout path="/reset-password" eyebrow="Recupero account" title="Reimposta la password" description="Il recupero password sarà disponibile quando il backend di produzione e il servizio email saranno collegati.">
    <label className="auth-field"><span>Email</span><input type="email" placeholder="nome@azienda.it" autoComplete="email" /></label>
    <button className="button full" type="button" disabled={!local.enabled}>Invia link di recupero</button>
    {!local.enabled && <p className="auth-footer">Recupero password: da configurare sul backend di produzione.</p>}
    <p className="auth-footer"><Link to="/login">← Torna all’accesso</Link></p>
  </AuthLayout>;
}

function AuthLayout({ path, eyebrow, title, description, children }: { path: string; eyebrow: string; title: string; description: string; children: ReactNode }) {
  return <div className="auth-page">
    <Seo title={`${title} | Post Automatici`} description={description} path={path} noIndex />
    <section className="auth-story" aria-label="Panoramica prodotto">
      <Link className="public-logo auth-logo" to="/"><span className="logo-glyph">P</span><span>Post Automatici</span></Link>
      <div className="auth-story-copy"><span className="section-label">Una sola control room</span><h2>Dal brand alla pubblicazione, senza rincorrere cinque strumenti.</h2><p>Ogni tua attività ha un profilo indipendente. Strategia, calendario, contenuti, anteprime, approvazioni, pubblicazioni e risultati restano nello stesso workflow.</p><div className="auth-story-points"><div><span>01</span><p><b>Conosci il brand</b><small>Sito analizzato pagina per pagina, tono, servizi e regole verificabili.</small></p></div><div><span>02</span><p><b>Anteprima sempre</b><small>Ogni contenuto richiede la tua decisione prima della pubblicazione.</small></p></div><div><span>03</span><p><b>Impara dai dati reali</b><small>Metriche provider trasformate in decisioni successive.</small></p></div></div></div>
      <div className="auth-story-status"><span className="status-dot"/><span>{internalE2EFixturesEnabled ? 'Test harness interno' : 'Workspace protetto'}</span></div>
    </section>
    <main className="auth-workspace">
      <div className="auth-mobile-logo"><Link className="public-logo" to="/"><span className="logo-glyph">P</span><span>Post Automatici</span></Link></div>
      <section className="auth-card">
        <span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p className="auth-description">{description}</p>
        <div>{children}</div>
        <div className="auth-safety"><span className="status-dot" /> {internalE2EFixturesEnabled ? 'Test automatici interni attivi' : 'Le funzioni non collegate restano esplicitamente non disponibili'}</div>
      </section>
    </main>
  </div>;
}
