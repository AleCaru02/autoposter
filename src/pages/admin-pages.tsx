import { useEffect, useState, type ReactNode } from "react";
import { Navigate, NavLink, Route, Routes, useParams } from "react-router-dom";
import { Activity, Building2, LayoutDashboard, ShieldCheck, Users } from "lucide-react";
import { authClient } from "../lib/neon-client";
import { adminRequest } from "../lib/admin-api";
import "../admin.css";

type AdminMe = { platformRole: "SUPER_ADMIN" };
type Overview = {
  users_total: number;
  profiles_total: number;
  onboarding_completed: number;
  onboarding_incomplete: number;
  social_connections_total: number;
};
type Customer = {
  auth_user_id: string;
  name: string | null;
  email: string | null;
  created_at: string | null;
  platform_role: "CUSTOMER" | "SUPER_ADMIN";
  banned: boolean | null;
  profile_count: number;
  onboarding_completed: number;
  onboarding_incomplete: number;
};
type Profile = {
  id: string;
  name: string;
  website_url: string | null;
  industry: string | null;
  onboarding_completed: boolean;
  created_at: string;
};
type Membership = { profile_id: string; profile_name: string; role: string };
type ActivityRow = Profile & {
  owner_name?: string | null;
  owner_email?: string | null;
  social_connections?: number;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "Non disponibile";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Non disponibile" : new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(date);
}

function AdminShell({ children }: { children: ReactNode }) {
  return <div className="admin-shell">
    <aside className="admin-sidebar">
      <div className="admin-brand"><ShieldCheck size={21} /><div><strong>Post Automatici</strong><span>Backoffice</span></div></div>
      <nav aria-label="Navigazione amministrazione">
        <NavLink end to="/admin"><LayoutDashboard size={18} />Overview</NavLink>
        <NavLink to="/admin/clienti"><Users size={18} />Clienti</NavLink>
        <NavLink to="/admin/attivita"><Building2 size={18} />Attività</NavLink>
      </nav>
      <NavLink className="admin-customer-link" to="/app/dashboard">Torna alla dashboard</NavLink>
    </aside>
    <main className="admin-main">{children}</main>
  </div>;
}

function Loading() { return <div className="admin-state">Caricamento…</div>; }
function ErrorState({ message }: { message: string }) { return <div className="admin-state admin-error">{message}</div>; }

function useAdminData<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void adminRequest<T>(path).then((body) => { if (active) setData(body); }).catch(() => { if (active) setError("Dati amministrativi non disponibili."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path]);
  return { data, error, loading };
}

function OverviewPage() {
  const { data, error, loading } = useAdminData<{ overview: Overview }>("/api/admin/overview");
  if (loading) return <Loading />;
  if (error || !data?.overview) return <ErrorState message={error || "Overview non disponibile."} />;
  const overview = data.overview;
  const cards = [
    ["Utenti", overview.users_total],
    ["Attività", overview.profiles_total],
    ["Onboarding completati", overview.onboarding_completed],
    ["Onboarding incompleti", overview.onboarding_incomplete],
    ["Social collegati", overview.social_connections_total],
  ];
  return <><header className="admin-page-header"><div><span>Amministrazione</span><h1>Overview</h1><p>Dati reali letti dal database di produzione.</p></div></header><section className="admin-metrics">{cards.map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>{value}</strong></article>)}</section></>;
}

function CustomersPage() {
  const { data, error, loading } = useAdminData<{ customers: Customer[] }>("/api/admin/customers");
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error || "Clienti non disponibili."} />;
  return <><header className="admin-page-header"><div><span>Amministrazione</span><h1>Clienti</h1><p>{data.customers.length} account reali.</p></div></header><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Utente</th><th>Ruolo</th><th>Attività</th><th>Onboarding</th><th>Creato</th><th /></tr></thead><tbody>{data.customers.map((customer) => <tr key={customer.auth_user_id}><td><strong>{customer.name || "Senza nome"}</strong><span>{customer.email || "Email non disponibile"}</span></td><td><span className={`admin-badge ${customer.platform_role === "SUPER_ADMIN" ? "admin" : ""}`}>{customer.platform_role}</span>{customer.banned ? <span className="admin-badge danger">Sospeso</span> : null}</td><td>{customer.profile_count}</td><td>{customer.onboarding_completed} completati{customer.onboarding_incomplete ? ` · ${customer.onboarding_incomplete} incompleti` : ""}</td><td>{formatDate(customer.created_at)}</td><td><NavLink className="admin-row-link" to={`/admin/clienti/${encodeURIComponent(customer.auth_user_id)}`}>Apri</NavLink></td></tr>)}</tbody></table></div></>;
}

function CustomerDetailPage() {
  const { id = "" } = useParams();
  const path = `/api/admin/customers/${encodeURIComponent(id)}`;
  const { data, error, loading } = useAdminData<{ customer: Customer; profiles: Profile[]; memberships: Membership[]; socialConnectionsByProfile: Array<{ profile_id: string; connections: number }> }>(path);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error || "Cliente non disponibile."} />;
  const socialMap = new Map(data.socialConnectionsByProfile.map((item) => [item.profile_id, item.connections]));
  return <><header className="admin-page-header"><div><NavLink className="admin-back" to="/admin/clienti">← Clienti</NavLink><h1>{data.customer.name || "Cliente"}</h1><p>{data.customer.email || "Email non disponibile"}</p></div><span className={`admin-badge ${data.customer.platform_role === "SUPER_ADMIN" ? "admin" : ""}`}>{data.customer.platform_role}</span></header><section className="admin-detail-grid"><article><h2>Account</h2><dl><div><dt>Creato</dt><dd>{formatDate(data.customer.created_at)}</dd></div><div><dt>Stato</dt><dd>{data.customer.banned ? "Sospeso" : "Attivo"}</dd></div><div><dt>Attività</dt><dd>{data.profiles.length}</dd></div></dl></article><article><h2>Membership</h2>{data.memberships.length ? <ul className="admin-list">{data.memberships.map((item) => <li key={`${item.profile_id}-${item.role}`}><span>{item.profile_name}</span><strong>{item.role}</strong></li>)}</ul> : <p>Nessuna membership disponibile.</p>}</article></section><section className="admin-section"><h2>Attività associate</h2><div className="admin-card-list">{data.profiles.map((profile) => <article key={profile.id}><div><strong>{profile.name}</strong><span>{profile.industry || "Settore non indicato"}</span></div><div><span>{profile.onboarding_completed ? "Onboarding completato" : "Onboarding incompleto"}</span><span>{socialMap.get(profile.id) ?? 0} social collegati</span></div></article>)}</div></section></>;
}

function ActivitiesPage() {
  const { data, error, loading } = useAdminData<{ activities: ActivityRow[] }>("/api/admin/activities");
  if (loading) return <Loading />;
  if (error || !data) return <ErrorState message={error || "Attività non disponibili."} />;
  return <><header className="admin-page-header"><div><span>Amministrazione</span><h1>Attività</h1><p>{data.activities.length} profili disponibili.</p></div></header><div className="admin-card-list">{data.activities.map((profile) => <article key={profile.id}><div><strong>{profile.name}</strong><span>{profile.owner_name || profile.owner_email || "Proprietario non disponibile"}</span></div><div><span>{profile.onboarding_completed ? "Onboarding completato" : "Onboarding incompleto"}</span><span>{profile.social_connections ?? 0} social collegati</span></div></article>)}</div></>;
}

export function AdminBackoffice() {
  const session = authClient.useSession();
  const [state, setState] = useState<"CHECKING" | "ALLOWED" | "DENIED">("CHECKING");
  useEffect(() => {
    if (session.isPending) return;
    if (!session.data?.user) { setState("DENIED"); return; }
    let active = true;
    void adminRequest<AdminMe>("/api/admin/me").then((body) => {
      if (active) setState(body.platformRole === "SUPER_ADMIN" ? "ALLOWED" : "DENIED");
    }).catch(() => { if (active) setState("DENIED"); });
    return () => { active = false; };
  }, [session.isPending, session.data?.user]);

  if (session.isPending || state === "CHECKING") return <main className="center-state">Verifica autorizzazione…</main>;
  if (!session.data?.user) return <Navigate to="/login" replace />;
  if (state === "DENIED") return <Navigate to="/app/dashboard" replace />;

  return <AdminShell><Routes>
    <Route index element={<OverviewPage />} />
    <Route path="clienti" element={<CustomersPage />} />
    <Route path="clienti/:id" element={<CustomerDetailPage />} />
    <Route path="attivita" element={<ActivitiesPage />} />
    <Route path="*" element={<Navigate to="/admin" replace />} />
  </Routes></AdminShell>;
}
