import { Link } from 'react-router';
import './auth-pages.css';

export function LoginPage() {
  return <AuthLayout eyebrow="Accesso" title="Bentornato" description="La schermata è pronta per Supabase Auth, ma in questa fase non invia credenziali a servizi remoti.">
    <label className="auth-field"><span>Email</span><input type="email" placeholder="nome@azienda.it" autoComplete="email" /></label>
    <label className="auth-field"><span>Password</span><input type="password" placeholder="••••••••••••" autoComplete="current-password" /></label>
    <div className="auth-row"><label><input type="checkbox" /> Ricordami</label><Link to="/reset-password">Password dimenticata?</Link></div>
    <button className="button full" type="button">Accedi · mock</button>
    <p className="auth-footer">Non hai un account? <Link to="/register">Crea account</Link></p>
  </AuthLayout>;
}

export function RegisterPage() {
  return <AuthLayout eyebrow="Registrazione" title="Crea il tuo workspace" description="Il piano verrà associato al tenant. Nessun pagamento o account cloud viene creato dalla demo.">
    <label className="auth-field"><span>Nome e cognome</span><input placeholder="Mario Rossi" autoComplete="name" /></label>
    <label className="auth-field"><span>Email di lavoro</span><input type="email" placeholder="mario@azienda.it" autoComplete="email" /></label>
    <label className="auth-field"><span>Password</span><input type="password" placeholder="Minimo 12 caratteri" autoComplete="new-password" /></label>
    <label className="auth-check"><input type="checkbox" /> <span>Accetto termini e privacy. In produzione questi documenti saranno versionati e registrati.</span></label>
    <button className="button full" type="button">Crea account · mock</button>
    <p className="auth-footer">Hai già un account? <Link to="/login">Accedi</Link></p>
  </AuthLayout>;
}

export function ResetPasswordPage() {
  return <AuthLayout eyebrow="Recupero account" title="Reimposta la password" description="Il flusso reale userà link monouso e redirect allowlist. Qui è solo una shell di sviluppo.">
    <label className="auth-field"><span>Email</span><input type="email" placeholder="nome@azienda.it" autoComplete="email" /></label>
    <button className="button full" type="button">Invia link · mock</button>
    <p className="auth-footer"><Link to="/login">← Torna all’accesso</Link></p>
  </AuthLayout>;
}

function AuthLayout({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: React.ReactNode }) {
  return <div className="auth-page">
    <Link className="public-logo auth-logo" to="/">SocialPilot AI</Link>
    <main className="auth-card">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p className="auth-description">{description}</p>
      <div className="auth-form">{children}</div>
      <div className="auth-safety"><span className="status-dot" /> Modalità locale/mock · nessuna credenziale viene inviata</div>
    </main>
  </div>;
}
