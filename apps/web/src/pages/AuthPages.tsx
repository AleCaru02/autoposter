import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
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

  return <AuthLayout eyebrow="Accesso" title="Bentornato" description={localE2EEnabled ? 'Accedi al Supabase Auth locale. Nessuna credenziale lascia il computer/runner di sviluppo.' : 'Shell mock: nessuna credenziale viene inviata.'}>
    <form onSubmit={submit} className="auth-form">
      <label className="auth-field"><span>Email</span><input data-testid="login-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
      <label className="auth-field"><span>Password</span><input data-testid="login-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
      <div className="auth-row"><label><input type="checkbox" /> Ricordami</label><Link to="/reset-password">Password dimenticata?</Link></div>
      <button data-testid="login-submit" className="button full" type="submit" disabled={local.loading}>{local.enabled ? 'Accedi in locale' : 'Accedi · mock'}</button>
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

  return <AuthLayout eyebrow="Registrazione" title="Crea il tuo workspace" description={local.enabled ? 'Crea un utente Auth locale; il tenant verrà creato nel primo step di onboarding.' : 'Nessun pagamento o account cloud viene creato dalla demo.'}>
    <form onSubmit={submit} className="auth-form">
      <label className="auth-field"><span>Nome e cognome</span><input data-testid="register-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></label>
      <label className="auth-field"><span>Email di lavoro</span><input data-testid="register-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
      <label className="auth-field"><span>Password</span><input data-testid="register-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={12} required /></label>
      <label className="auth-check"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /> <span>Accetto termini e privacy della fixture di sviluppo locale.</span></label>
      <button data-testid="register-submit" className="button full" type="submit" disabled={local.loading}>{local.enabled ? 'Crea account locale' : 'Crea account · mock'}</button>
      {message && <p role="alert" className="auth-footer">{message}</p>}
    </form>
    <p className="auth-footer">Hai già un account? <Link to="/login">Accedi</Link></p>
  </AuthLayout>;
}

export function ResetPasswordPage() {
  return <AuthLayout eyebrow="Recupero account" title="Reimposta la password" description="Il recupero password remoto resta intenzionalmente posticipato; l’E2E locale crea credenziali usa-e-getta.">
    <label className="auth-field"><span>Email</span><input type="email" placeholder="nome@azienda.it" autoComplete="email" /></label>
    <button className="button full" type="button" disabled>Invio disattivato in locale</button>
    <p className="auth-footer"><Link to="/login">← Torna all’accesso</Link></p>
  </AuthLayout>;
}

function AuthLayout({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: React.ReactNode }) {
  return <div className="auth-page">
    <Link className="public-logo auth-logo" to="/">SocialPilot AI</Link>
    <main className="auth-card">
      <span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p className="auth-description">{description}</p>
      <div>{children}</div>
      <div className="auth-safety"><span className="status-dot" /> {localE2EEnabled ? 'Modalità local E2E · Supabase Docker + provider mock' : 'Modalità mock · nessuna credenziale viene inviata'}</div>
    </main>
  </div>;
}
