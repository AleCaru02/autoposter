import { useState, type FormEvent, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { authClient } from "../lib/neon-client";

function AuthLayout({ children, title, subtitle }: { children: ReactNode; title: string; subtitle: string }) {
  return <main className="auth-page"><section className="auth-card"><div className="brand-mark">PA</div><p className="eyebrow">Post Automatici · uso personale</p><h1>{title}</h1><p className="auth-subtitle">{subtitle}</p>{children}</section></main>;
}

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null); setBusy(true);
    const result = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (result.error) { setError(result.error.message ?? "Accesso non riuscito."); return; }
    navigate("/app/dashboard", { replace: true });
  }

  return <AuthLayout title="Accedi" subtitle="Sessione reale Neon Auth. Nessun account demo."><form onSubmit={submit} className="auth-form"><label>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input required minLength={8} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy} type="submit">{busy ? "Accesso…" : "Accedi"}</button></form><p className="auth-switch">Non hai un account? <NavLink to="/registrazione">Registrati</NavLink></p></AuthLayout>;
}

export function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null); setBusy(true);
    const result = await authClient.signUp.email({ name, email, password });
    setBusy(false);
    if (result.error) { setError(result.error.message ?? "Registrazione non riuscita."); return; }
    navigate("/onboarding", { replace: true });
  }

  return <AuthLayout title="Crea il tuo accesso" subtitle="Versione personale di Post Automatici."><form onSubmit={submit} className="auth-form"><label>Nome<input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label><label>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><p className="field-help">Minimo 8 caratteri.</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy} type="submit">{busy ? "Creazione…" : "Crea account"}</button></form><p className="auth-switch">Hai già un account? <NavLink to="/login">Accedi</NavLink></p></AuthLayout>;
}
