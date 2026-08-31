import { useEffect, useMemo, useState, type FormEvent } from "react";
import { adminRequest } from "../lib/admin-api";

type AuditRow = {
  id: string;
  actor_auth_user_id: string;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: unknown;
  created_at: string;
};

type AuditResponse = {
  audit: AuditRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

type Filters = { action: string; actor: string; target: string; from: string; to: string };

const EMPTY_FILTERS: Filters = { action: "", actor: "", target: "", from: "", to: "" };
const KNOWN_ACTIONS: Record<string, string> = {
  ADMIN_ACCESS: "Accesso al backoffice",
  ADMIN_OVERVIEW_VIEW: "Visualizzazione overview",
  ADMIN_CUSTOMERS_LIST: "Elenco clienti",
  ADMIN_CUSTOMER_DETAIL_VIEW: "Visualizzazione dettaglio cliente",
  ADMIN_ACTIVITIES_LIST: "Elenco attività",
};
const SENSITIVE_KEYS = new Set([
  "password", "jwt", "authorization", "cookie", "sessiontoken", "accesstoken", "refreshtoken",
  "apikey", "databaseurl", "clientsecret", "oauthsecret", "fase3qatoken",
]);

function actionLabel(action: string) {
  if (KNOWN_ACTIONS[action]) return KNOWN_ACTIONS[action];
  const text = action.replace(/^ADMIN_/, "").replace(/_/g, " ").toLowerCase();
  return text ? text[0].toUpperCase() + text.slice(1) : action;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Non disponibile" : new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function actorLabel(row: AuditRow) {
  return row.actor_name || row.actor_email || row.actor_auth_user_id;
}

function targetLabel(row: AuditRow) {
  if (!row.target_type && !row.target_id) return "Nessun target";
  return [row.target_type || "Risorsa", row.target_id || "—"].join(" · ");
}

function safeMetadataEntries(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [] as Array<[string, string]>;
  return Object.entries(metadata as Record<string, unknown>).map(([key, value]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (SENSITIVE_KEYS.has(normalized)) return [key, "[REDACTED]"] as [string, string];
    if (key === "resultCount" && typeof value === "number") return ["Risultati", `${value} risultati`];
    if (key === "profileCount" && typeof value === "number") return ["Attività", `${value} attività`];
    let rendered = typeof value === "string" ? value : JSON.stringify(value);
    if (!rendered) rendered = String(value ?? "");
    if (rendered.length > 160) rendered = `${rendered.slice(0, 157)}…`;
    return [key, rendered] as [string, string];
  });
}

function AuditDetails({ metadata }: { metadata: unknown }) {
  const entries = safeMetadataEntries(metadata);
  if (!entries.length) return <span className="admin-muted">Nessun dettaglio</span>;
  return <dl className="admin-audit-details">{entries.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>;
}

export function AdminAuditPage() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const path = useMemo(() => {
    const query = new URLSearchParams({ page: String(page), limit: "25" });
    if (filters.action.trim()) query.set("action", filters.action.trim());
    if (filters.actor.trim()) query.set("actor", filters.actor.trim());
    if (filters.target.trim()) query.set("target", filters.target.trim());
    if (filters.from) query.set("from", new Date(filters.from).toISOString());
    if (filters.to) query.set("to", new Date(filters.to).toISOString());
    return `/api/admin/audit?${query.toString()}`;
  }, [filters, page]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void adminRequest<AuditResponse>(path)
      .then((body) => { if (active) setData(body); })
      .catch(() => { if (active) setError("Audit non disponibile."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    const from = draft.from ? new Date(draft.from).getTime() : null;
    const to = draft.to ? new Date(draft.to).getTime() : null;
    if ((from !== null && !Number.isFinite(from)) || (to !== null && !Number.isFinite(to))) {
      setValidationError("Intervallo data non valido.");
      return;
    }
    if (from !== null && to !== null && from > to) {
      setValidationError("La data iniziale non può essere successiva alla data finale.");
      return;
    }
    setValidationError(null);
    setPage(1);
    setFilters({ ...draft });
  }

  function clearFilters() {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setValidationError(null);
    setPage(1);
  }

  const rows = data?.audit ?? [];
  const pagination = data?.pagination;

  return <>
    <header className="admin-page-header"><div><span>Amministrazione</span><h1>Audit</h1><p>Registro delle operazioni amministrative autorizzate, con dati e metadata sanitizzati.</p></div></header>

    <form className="admin-audit-filters" onSubmit={applyFilters} aria-label="Filtri audit">
      <label>Azione<input list="admin-audit-actions" value={draft.action} maxLength={120} onChange={(event) => setDraft({ ...draft, action: event.target.value })} placeholder="Es. ADMIN_ACCESS" /></label>
      <datalist id="admin-audit-actions">{Object.keys(KNOWN_ACTIONS).map((action) => <option key={action} value={action}>{KNOWN_ACTIONS[action]}</option>)}</datalist>
      <label>Actor<input value={draft.actor} maxLength={256} onChange={(event) => setDraft({ ...draft, actor: event.target.value })} placeholder="Nome, email o ID" /></label>
      <label>Target<input value={draft.target} maxLength={256} onChange={(event) => setDraft({ ...draft, target: event.target.value })} placeholder="Tipo o identificatore" /></label>
      <label>Da<input type="datetime-local" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
      <label>A<input type="datetime-local" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label>
      <div className="admin-audit-filter-actions"><button type="submit">Applica filtri</button><button type="button" className="secondary" onClick={clearFilters}>Azzera</button></div>
    </form>
    {validationError ? <div className="admin-inline-error" role="alert">{validationError}</div> : null}

    {loading ? <div className="admin-state">Caricamento…</div> : null}
    {!loading && error ? <div className="admin-state admin-error" role="alert">{error}</div> : null}
    {!loading && !error && rows.length === 0 ? <div className="admin-state admin-empty"><strong>Nessun evento trovato.</strong><span>Modifica o azzera i filtri per ampliare la ricerca.</span></div> : null}

    {!loading && !error && rows.length > 0 ? <>
      <div className="admin-table-wrap admin-audit-desktop"><table className="admin-table admin-audit-table"><thead><tr><th>Data/Ora</th><th>Azione</th><th>Actor</th><th>Target</th><th>Dettagli</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{formatDateTime(row.created_at)}</td><td><strong>{actionLabel(row.action)}</strong><code>{row.action}</code></td><td><strong>{actorLabel(row)}</strong>{row.actor_name && row.actor_email ? <span>{row.actor_email}</span> : null}</td><td><strong>{row.target_type || "Risorsa"}</strong><span className="admin-break">{row.target_id || "—"}</span></td><td><AuditDetails metadata={row.metadata} /></td></tr>)}</tbody></table></div>
      <div className="admin-audit-mobile">{rows.map((row) => <article key={row.id} className="admin-audit-card"><div className="admin-audit-card-head"><time dateTime={row.created_at}>{formatDateTime(row.created_at)}</time><code>{row.action}</code></div><h2>{actionLabel(row.action)}</h2><dl><div><dt>Actor</dt><dd>{actorLabel(row)}</dd></div><div><dt>Target</dt><dd className="admin-break">{targetLabel(row)}</dd></div></dl><AuditDetails metadata={row.metadata} /></article>)}</div>
    </> : null}

    {!loading && !error && pagination ? <nav className="admin-pagination" aria-label="Paginazione audit"><button type="button" disabled={pagination.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>← Precedente</button><span>Pagina {pagination.page} di {pagination.totalPages} · {pagination.total} eventi</span><button type="button" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)}>Successiva →</button></nav> : null}
  </>;
}
