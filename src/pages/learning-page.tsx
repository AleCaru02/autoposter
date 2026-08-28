import { useEffect, useMemo, useState } from "react";
import { BrainCircuit, RefreshCw } from "lucide-react";
import { neonClient } from "../lib/neon-client";
import { useProfiles } from "../features/profiles/profile-context";

type InsightRow = Record<string, unknown> & { id?: string };

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function title(row: InsightRow) {
  return text(row.title) ?? text(row.insight_type) ?? text(row.type) ?? "Insight";
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
  return text(row.provider) ?? text(row.source) ?? "Dati performance";
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
    const result = await neonClient.from("learning_insights").select("*").eq("profile_id", profileId).limit(100);
    setLoading(false);
    if (result.error) {
      setRows([]);
      setError(result.error.message);
      return;
    }
    setRows((result.data ?? []) as InsightRow[]);
  }

  useEffect(() => { void load(); }, [selectedProfile?.id]);

  const latest = useMemo(() => rows.slice().sort((a, b) => String(b.created_at ?? b.updated_at ?? "").localeCompare(String(a.created_at ?? a.updated_at ?? ""))).slice(0, 30), [rows]);

  if (!selectedProfile) return null;
  return <div className="page-content">
    <header className="page-header"><div><p className="eyebrow">Apprendimento</p><h1>Ottimizzazione progressiva</h1><p>Gli insight di {selectedProfile.name} devono derivare esclusivamente da metriche reali del suo profilo.</p></div><button className="compact-action" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} /> {loading ? "Aggiornamento…" : "Aggiorna"}</button></header>
    {error && <p className="form-error" role="alert">Impossibile leggere gli insight: {error}</p>}
    {!loading && !error && latest.length === 0 && <section className="panel empty-state"><BrainCircuit size={28} /><h2>Apprendimento non ancora disponibile</h2><p>È corretto che sia vuoto finché non esistono pubblicazioni e metriche reali sufficienti. Il sistema non inventa suggerimenti, orari o temi.</p></section>}
    {latest.length > 0 && <section className="panel"><div className="status-rows">{latest.map((row, index) => <div key={String(row.id ?? `${title(row)}-${index}`)}><span><strong>{title(row)}</strong><br /><small>{body(row)}</small>{createdAt(row) && <><br /><small>{source(row)} · {createdAt(row)}</small></>}</span></div>)}</div></section>}
  </div>;
}
