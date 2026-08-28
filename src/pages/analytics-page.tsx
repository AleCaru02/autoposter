import { useEffect, useMemo, useState } from "react";
import { BarChart3, RefreshCw } from "lucide-react";
import { neonClient } from "../lib/neon-client";
import { useProfiles } from "../features/profiles/profile-context";

type MetricRow = Record<string, unknown> & { id?: string };

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function metricName(row: MetricRow) {
  return text(row.metric_name) ?? text(row.metric) ?? text(row.name) ?? text(row.key) ?? "Metrica";
}

function metricValue(row: MetricRow) {
  const direct = number(row.value) ?? number(row.metric_value) ?? number(row.count);
  if (direct !== null) return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(direct);
  const payload = row.metrics && typeof row.metrics === "object" ? row.metrics as Record<string, unknown> : null;
  if (payload) {
    const entries = Object.entries(payload).filter(([, value]) => number(value) !== null).slice(0, 3);
    if (entries.length) return entries.map(([key, value]) => `${key}: ${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(number(value) ?? 0)}`).join(" · ");
  }
  return "—";
}

function provider(row: MetricRow) {
  return text(row.provider) ?? text(row.platform) ?? "Social";
}

function capturedAt(row: MetricRow) {
  const raw = text(row.captured_at) ?? text(row.created_at) ?? text(row.recorded_at);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat("it-IT", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function AnalyticsPage() {
  const { selectedProfile } = useProfiles();
  const [rows, setRows] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const profileId = selectedProfile?.id;
    if (!profileId) return;
    setLoading(true);
    setError(null);
    const result = await neonClient.from("metric_snapshots").select("*").eq("profile_id", profileId).limit(100);
    setLoading(false);
    if (result.error) {
      setRows([]);
      setError(result.error.message);
      return;
    }
    setRows((result.data ?? []) as MetricRow[]);
  }

  useEffect(() => { void load(); }, [selectedProfile?.id]);

  const latest = useMemo(() => rows.slice().sort((a, b) => String(b.captured_at ?? b.created_at ?? "").localeCompare(String(a.captured_at ?? a.created_at ?? ""))).slice(0, 24), [rows]);

  if (!selectedProfile) return null;
  return <div className="page-content">
    <header className="page-header"><div><p className="eyebrow">Analytics</p><h1>Metriche reali</h1><p>Mostriamo soltanto dati ricevuti e salvati dalle API social collegate per {selectedProfile.name}.</p></div><button className="compact-action" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} /> {loading ? "Aggiornamento…" : "Aggiorna"}</button></header>
    {error && <p className="form-error" role="alert">Impossibile leggere le metriche: {error}</p>}
    {!loading && !error && latest.length === 0 && <section className="panel empty-state"><BarChart3 size={28} /><h2>Nessuna metrica disponibile</h2><p>Non vengono creati numeri demo. Le metriche compariranno qui solo dopo il collegamento di un provider e una raccolta API riuscita.</p></section>}
    {latest.length > 0 && <section className="stat-grid">{latest.map((row, index) => <article className="stat-card" key={String(row.id ?? `${provider(row)}-${metricName(row)}-${index}`)}><span>{provider(row)} · {metricName(row)}</span><strong>{metricValue(row)}</strong>{capturedAt(row) && <small>{capturedAt(row)}</small>}</article>)}</section>}
  </div>;
}
