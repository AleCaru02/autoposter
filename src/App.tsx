import { FormEvent, useState } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { LogOut, ShieldCheck } from "lucide-react";
import { authClient } from "./lib/auth-client";

function AuthLayout({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand-mark">PA</div>
        <p className="eyebrow">Post Automatici · uso personale</p>
        <h1>{title}</h1>
        <p className="auth-subtitle">{subtitle}</p>
        {children}
      </section>
    </main>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "Accesso non riuscito.");
      return;
    }
    navigate("/app", { replace: true });
  }

  return (
    <AuthLayout title="Accedi" subtitle="Sessione reale gestita da Neon Auth. Nessun login demo o localStorage.">
      <form onSubmit={submit} className="auth-form">
        <label>Email<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Password<input required minLength={8} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" disabled={busy} type="submit">{busy ? "Accesso…" : "Accedi"}</button>
      </form>
      <p className="auth-switch">Non hai ancora un account? <NavLink to="/registrazione">Registrati</NavLink></p>
    </AuthLayout>
  );
}

function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await authClient.signUp.email({ name, email, password });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "Registrazione non riuscita.");
      return;
    }
    navigate("/app", { replace: true });
  }

  return (
    <AuthLayout title="Crea il tuo accesso" subtitle="Per ora l’account serve solo alla versione personale di Post Automatici.">
      <form onSubmit={submit} className="auth-form">
        <label>Nome<input required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Email<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Password<input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <p className="field-help">Minimo 8 caratteri.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" disabled={busy} type="submit">{busy ? "Creazione…" : "Crea account"}</button>
      </form>
      <p className="auth-switch">Hai già un account? <NavLink to="/login">Accedi</NavLink></p>
    </AuthLayout>
  );
}

function ProtectedApp() {
  const session = authClient.useSession();
  const navigate = useNavigate();

  if (session.isPending) {
    return <main className="center-state">Verifica sessione…</main>;
  }
  if (!session.data?.user) {
    return <Navigate to="/login" replace />;
  }

  async function signOut() {
    await authClient.signOut();
    navigate("/login", { replace: true });
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div><p className="eyebrow">Post Automatici</p><h1>Dashboard personale</h1></div>
        <button className="secondary-button" onClick={signOut}><LogOut size={16} /> Esci</button>
      </header>
      <section className="welcome-card">
        <ShieldCheck size={28} />
        <div>
          <h2>Autenticazione attiva</h2>
          <p>Sessione reale: {session.data.user.email}. Il prossimo gate collega questa identità ai profili attività isolati nel PostgreSQL.</p>
        </div>
      </section>
      <section className="disabled-grid">
        {[
          ["Profili attività", "In configurazione"],
          ["Brand e sito", "In configurazione"],
          ["Contenuti AI", "Non ancora collegato"],
          ["Calendario", "Non ancora collegato"],
          ["Social", "Da configurare"],
          ["Metriche", "Non disponibili finché i social non sono collegati"],
        ].map(([title, status]) => (
          <article className="disabled-card" key={title}><h3>{title}</h3><p>{status}</p></article>
        ))}
      </section>
    </main>
  );
}

function RootRedirect() {
  const session = authClient.useSession();
  if (session.isPending) return <main className="center-state">Caricamento…</main>;
  return <Navigate to={session.data?.user ? "/app" : "/login"} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/registrazione" element={<RegisterPage />} />
      <Route path="/app" element={<ProtectedApp />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
