import { useEffect, useMemo, useState } from "react";
import { BarChart3, RefreshCw } from "lucide-react";
import { neonClient } from "../lib/neon-client";
import { useProfiles } from "../features/profiles/profile-context";

type MetricRow = {
  id: string; provider: string; external_post_id: string; format: string; topic: string;
  published_at: string; captured_at: string; metrics: Record<string, unknown> | null;
};

const providerNames: Record<string, string> = { INSTAGRAM: "Instagram", FACEBOOK: "Facebook", LINKEDIN: "LinkedIn" };
const metricNames: Record<string, string> = {
  impressions: "Visualizzazioni", post_impressions: "Visualizzazioni", views: "Visualizzazioni",
  reach: "Copertura", post_impressions_unique: "Copertura", post_engaged_users: "Persone coinvolte",
  total_interactions: "Interazioni", engagement_rate: "Tasso di interazione", reactions: "Reazioni",
  likes: "Mi piace", comments: "Commenti", shares: "Condivisioni", saved: "Salvataggi",
  saves: "Salvataggi", clicks: "Clic", post_clicks: "Clic", link_clicks: "Clic sul link",
};

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
function formatMetric(value: number, key: string) {
  return new Intl.NumberFormat("it-IT", { style: key.includes("rate") ? "percent" : "decimal", maximumFractionDigits: 2 }).format(value);
}
function moment(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Data non disponibile" : new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function AnalyticsPage() {
  const { selectedProfile } = useProfiles();
  const [rows, setRows] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const profileId = selectedProfile?.id;
    if (!profileId) return;
    setLoading(true); setError(null);
    const result = await neonClient.from("metric_snapshots")
      .select("id,provider,external_post_id,format,topic,published_at,captured_at,metrics")
      .eq("profile_id", profileId).order("captured_at", { ascending: false }).limit(100);
    setLoading(false);
    if (result.error) { setRows([]); setError("Non riesco a leggere i risultati in questo momento. Riprova più tardi."); return; }
    setRows((result.data ?? []) as MetricRow[]);
  }

  useEffect(() => { void load(); }, [selectedProfile?.id]);
  const latest = useMemo(() => {
    const seen = new Set<string>();
    return rows.filter((row) => { const key = `${row.provider}:${row.external_post_id}`; if (seen.has(key)) return false; seen.add(key); return true; });
  }, [rows]);

  if (!selectedProfile) return null;
  return <div className="page-content">
    <header className="page-header"><div><p className="eyebrow">Analytics</p><h1>Risultati dei tuoi social</h1><p>Dati reali dei contenuti pubblicati per {selectedProfile.name}.</p></div><button className="compact-action" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} /> {loading ? "Aggiornamento…" : "Ricarica dati"}</button></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!loading && !error && latest.length === 0 && <section className="panel empty-state"><BarChart3 size={28} /><h2>Nessun risultato disponibile</h2><p>I risultati compariranno dopo una pubblicazione e il primo aggiornamento automatico del social.</p></section>}
    {!error && latest.map((row) => {
      const metrics = Object.entries(row.metrics ?? {}).flatMap(([key, raw]) => { const value = number(raw); return value === null ? [] : [{ key, value }]; });
      return <section className="panel" key={row.id}>
        <p className="eyebrow">{providerNames[row.provider] ?? row.provider} · {row.format}</p>
        <h2>{row.topic || "Contenuto pubblicato"}</h2>
        <div className="status-rows"><div><span>Pubblicato</span><strong>{moment(row.published_at)}</strong></div><div><span>Ultimo aggiornamento</span><strong>{moment(row.captured_at)}</strong></div></div>
        {metrics.length ? <div className="stat-grid">{metrics.map(({ key, value }) => <article className="stat-card" key={key}><span>{metricNames[key] ?? key.replaceAll("_", " ")}</span><strong>{formatMetric(value, key)}</strong></article>)}</div> : <p>Nessuna metrica disponibile per questo contenuto.</p>}
      </section>;
    })}
  </div>;
}
