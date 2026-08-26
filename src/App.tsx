import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { Building2, LogOut, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { authClient, neonClient } from "./lib/neon-client";

type Profile = {
  id: string;
  name: string;
  slug: string;
  website_url: string | null;
  industry: string | null;
  created_at: string;
};

function AuthLayout({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: string }) {
  return <main className="auth-page"><section className="auth-card"><div className="brand-mark">PA</div><p className="eyebrow">Post Automatici · uso personale</p><h1>{title}</h1><p className="auth-subtitle">{subtitle}</p>{children}</section></main>;
}

function LoginPage() {
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
    navigate("/app", { replace: true });
  }
  return <AuthLayout title="Accedi" subtitle="Sessione reale Neon Auth. Nessun account demo."><form onSubmit={submit} className="auth-form"><label>Email<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Password<input required minLength={8} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy} type="submit">{busy ? "Accesso…" : "Accedi"}</button></form><p className="auth-switch">Non hai un account? <NavLink to="/registrazione">Registrati</NavLink></p></AuthLayout>;
}

function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null); setBusy(true);
    const result = await authClient.signUp.email({ name, email, password }); setBusy(false);
    if (result.error) { setError(result.error.message ?? "Registrazione non riuscita."); return; }
    navigate("/app", { replace: true });
  }
  return <AuthLayout title="Crea il tuo accesso" subtitle="Versione personale di Post Automatici."><form onSubmit={submit} className="auth-form"><label>Nome<input required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label><label>Email<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Password<input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label><p className="field-help">Minimo 8 caratteri.</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy} type="submit">{busy ? "Creazione…" : "Crea account"}</button></form><p className="auth-switch">Hai già un account? <NavLink to="/login">Accedi</NavLink></p></AuthLayout>;
}

function slugify(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72);
}

function ProfileManager() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState(""); const [website, setWebsite] = useState(""); const [industry, setIndustry] = useState("");
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const result = await neonClient.from("profiles").select("id,name,slug,website_url,industry,created_at").is("archived_at", null).order("created_at", { ascending: true });
    setLoading(false);
    if (result.error) { setError(result.error.message); return; }
    const next = (result.data ?? []) as Profile[]; setProfiles(next); setSelectedId((current) => current && next.some((p) => p.id === current) ? current : next[0]?.id ?? null);
  }, []);

  useEffect(() => { void load(); }, [load]);
  const selected = useMemo(() => profiles.find((p) => p.id === selectedId) ?? null, [profiles, selectedId]);

  async function createProfile(event: FormEvent) {
    event.preventDefault(); const slug = slugify(name); if (!slug) return;
    setBusy(true); setError(null);
    const result = await neonClient.from("profiles").insert({ name: name.trim(), slug, website_url: website.trim() || null, industry: industry.trim() || null }).select("id,name,slug,website_url,industry,created_at").single();
    setBusy(false);
    if (result.error || !result.data) { setError(result.error?.message ?? "Impossibile creare il profilo."); return; }
    const created = result.data as Profile; setProfiles((rows) => [...rows, created]); setSelectedId(created.id); setName(""); setWebsite(""); setIndustry("");
  }

  async function removeProfile(profile: Profile) {
    if (!window.confirm(`Eliminare definitivamente “${profile.name}”?`)) return;
    setBusy(true); setError(null);
    const result = await neonClient.from("profiles").delete().eq("id", profile.id).select("id"); setBusy(false);
    if (result.error) { setError(result.error.message); return; }
    await load();
  }

  return <section className="profiles-section"><div className="section-heading"><div><p className="eyebrow">Profili attività</p><h2>Attività indipendenti</h2><p>Ogni profilo è una riga reale PostgreSQL protetta da RLS.</p></div><button className="icon-button" type="button" onClick={() => void load()} aria-label="Aggiorna"><RefreshCw size={17} /></button></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="profiles-layout"><div className="profile-list">{loading ? <p className="empty-copy">Caricamento…</p> : profiles.length === 0 ? <p className="empty-copy">Nessuna attività. Crea il primo profilo.</p> : profiles.map((profile) => <button type="button" className={`profile-row ${selectedId === profile.id ? "active" : ""}`} key={profile.id} onClick={() => setSelectedId(profile.id)}><span className="profile-icon"><Building2 size={18} /></span><span><strong>{profile.name}</strong><small>{profile.industry || "Settore da definire"}</small></span></button>)}</div><div className="profile-detail">{selected ? <><div className="profile-detail-head"><div><p className="eyebrow">Profilo selezionato</p><h3>{selected.name}</h3></div><button className="danger-button" type="button" disabled={busy} onClick={() => void removeProfile(selected)}><Trash2 size={15} /> Elimina</button></div><dl><div><dt>Sito</dt><dd>{selected.website_url || "Non impostato"}</dd></div><div><dt>Settore</dt><dd>{selected.industry || "Non impostato"}</dd></div><div><dt>Slug</dt><dd>{selected.slug}</dd></div></dl><p className="success-note"><ShieldCheck size={16} /> Il profilo corrente è visibile solo al proprietario autenticato.</p></> : <form className="create-profile" onSubmit={createProfile}><p className="eyebrow">Nuova attività</p><h3>Crea profilo</h3><label>Nome attività<input required value={name} onChange={(e) => setName(e.target.value)} /></label><label>Sito<input type="url" placeholder="https://..." value={website} onChange={(e) => setWebsite(e.target.value)} /></label><label>Settore<input value={industry} onChange={(e) => setIndustry(e.target.value)} /></label><button disabled={busy} className="primary-button" type="submit"><Plus size={16} /> {busy ? "Creazione…" : "Crea profilo"}</button></form>}</div></div>{selected && <form className="inline-create" onSubmit={createProfile}><input required placeholder="Nuova attività" value={name} onChange={(e) => setName(e.target.value)} /><input type="url" placeholder="Sito (opzionale)" value={website} onChange={(e) => setWebsite(e.target.value)} /><input placeholder="Settore (opzionale)" value={industry} onChange={(e) => setIndustry(e.target.value)} /><button disabled={busy} className="primary-button" type="submit"><Plus size={16} /> Aggiungi</button></form>}</section>;
}

function ProtectedApp() {
  const session = authClient.useSession(); const navigate = useNavigate();
  if (session.isPending) return <main className="center-state">Verifica sessione…</main>;
  if (!session.data?.user) return <Navigate to="/login" replace />;
  async function signOut() { await authClient.signOut(); navigate("/login", { replace: true }); }
  return <main className="app-shell"><header className="app-header"><div><p className="eyebrow">Post Automatici</p><h1>Dashboard personale</h1><p>{session.data.user.email}</p></div><button className="secondary-button" onClick={signOut}><LogOut size={16} /> Esci</button></header><ProfileManager /><section className="disabled-grid">{[["Brand e sito","Si attiva dopo il profilo"],["Contenuti AI","Non ancora collegato"],["Calendario","Non ancora collegato"],["Social","Da configurare"],["Metriche","In attesa dei social"],["Apprendimento","In attesa di metriche reali"]].map(([title,status]) => <article className="disabled-card" key={title}><h3>{title}</h3><p>{status}</p></article>)}</section></main>;
}

function RootRedirect() { const session = authClient.useSession(); if (session.isPending) return <main className="center-state">Caricamento…</main>; return <Navigate to={session.data?.user ? "/app" : "/login"} replace />; }
export default function App() { return <Routes><Route path="/" element={<RootRedirect />} /><Route path="/login" element={<LoginPage />} /><Route path="/registrazione" element={<RegisterPage />} /><Route path="/app" element={<ProtectedApp />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes>; }
