import { useEffect, useMemo, useState } from "react";
import { BrainCircuit, RefreshCw } from "lucide-react";
import { neonClient } from "../lib/neon-client";
import { authenticatedApiToken } from "../lib/auth-token";
import { useProfiles } from "../features/profiles/profile-context";

type InsightRow = Record<string, unknown> & { id?: string };

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function title(row: InsightRow) {
  const dimension = text(row.dimension);
  const value = text(row.dimension_value);
  return text(row.title) ?? text(row.insight_type) ?? text(row.type) ?? (dimension && value ? `${dimension}: ${value}` : "Insight");
}

function body(row: InsightRow) {
  const direct = text(row.summary) ?? text(row.insight) ?? text(row.description) ?? text(row.recommendation);
  if (direct) return direct;
  const payload = row.payload && typeof row.payload === "object" ? row.payload as Record<string, unknown> : null;
  if (!payload) return "Insight registrato senza descrizione testuale.";
  const useful = Object.entries(payload).filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean").slice(0, 5);
  return useful.length ? useful.map(([key, value]) => `${key}: ${String(value)}`).join(" · ") : "Insight registrato.";
}

function source(row: InsightRow) {
  const confidence = text(row.confidence);
  const origin = text(row.source_type) === "DEMO_SAMPLE" ? "Dati dimostrativi" : text(row.provider) ?? text(row.source) ?? "Metriche provider reali";
  return [origin, confidence ? `confidenza ${confidence.toLowerCase()}` : null].filter(Boolean).join(" · ");
}

function createdAt(row: InsightRow) {
  const raw = text(row.created_at) ?? text(row.updated_at) ?? text(row.generated_at);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function LearningPage() {
  const { selectedProfile } = useProfiles();
  const [rows, setRows] = useState<InsightRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const profileId = selectedProfile?.id;
    if (!profileId) return;
    setLoading(true);
    setError(null);
    const result = await neonClient.from("learning_insights").select("*").eq("profile_id", profileId).eq("active", true).order("generated_at", { ascending: false }).limit(100);
    setLoading(false);
    if (result.error) {
      setRows([]);
      setError("Impossibile leggere gli insight. Riprova tra poco.");
      return;
    }
    setRows((result.data ?? []) as InsightRow[]);
  }

  useEffect(() => { void load(); }, [selectedProfile?.id]);

  async function refreshLearning() {
    if (!selectedProfile?.id) return;
    setLoading(true);
    setError(null);
    try {
      const token = await authenticatedApiToken();
      const response = await fetch("/api/learning/run", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ profileId: selectedProfile.id }) });
      if (!response.ok) throw new Error("LEARNING_REFRESH_FAILED");
      await load();
    } catch {
      setLoading(false);
      setError("Non riesco ad aggiornare l’apprendimento in questo momento. I dati esistenti non sono stati modificati.");
    }
  }

  const latest = useMemo(() => rows.slice().sort((a, b) => String(b.generated_at ?? b.created_at ?? b.updated_at ?? "").localeCompare(String(a.generated_at ?? a.created_at ?? a.updated_at ?? ""))).slice(0, 30), [rows]);

  if (!selectedProfile) return null;
  const demo = selectedProfile.tenant_type === "DEMO_PERSISTENT";
  return <div className="page-content">
    <header className="page-header"><div><p className="eyebrow">Apprendimento</p><h1>Ottimizzazione progressiva</h1><p>{demo ? `Insight dimostrativi per ${selectedProfile.name}; non alimentano il Learning reale.` : `Gli insight di ${selectedProfile.name} derivano esclusivamente da metriche reali del suo profilo.`}</p></div><button className="compact-action" type="button" onClick={() => void refreshLearning()} disabled={loading || demo}><RefreshCw size={16} /> {loading ? "Aggiornamento…" : "Aggiorna apprendimento"}</button></header>
    {demo && <p className="form-success" role="status">Dati dimostrativi · SAMPLE DATA</p>}
    {error && <p className="form-error" role="alert">Impossibile leggere gli insight: {error}</p>}
    {!loading && !error && latest.length === 0 && <section className="panel empty-state"><BrainCircuit size={28} /><h2>Apprendimento non ancora disponibile</h2><p>È corretto che sia vuoto finché non esistono pubblicazioni e metriche reali sufficienti. Il sistema non inventa suggerimenti, orari o temi.</p></section>}
    {latest.length > 0 && <section className="panel"><div className="status-rows">{latest.map((row, index) => <div key={String(row.id ?? `${title(row)}-${index}`)}><span><strong>{title(row)}</strong><br /><small>{body(row)}</small>{createdAt(row) && <><br /><small>{source(row)} · {createdAt(row)}</small></>}</span></div>)}</div></section>}
  </div>;
}
