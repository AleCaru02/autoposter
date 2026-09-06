import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, BarChart3, CalendarClock, CheckCircle2, FileCheck2, FileText, Lightbulb, Radio, Share2, Sparkles } from "lucide-react";
import { NavLink } from "react-router-dom";
import { neonClient } from "../lib/neon-client";
import { useProfiles } from "../features/profiles/profile-context";

type DashboardJob = { id: string; provider: string; state: string; scheduled_at: string; updated_at: string; last_error: string | null };
type MetricSnapshot = { id: string; provider: string; metrics: Record<string, unknown> | null; captured_at: string };
type LearningInsight = { id: string; recommendation: string; confidence: string; generated_at: string };
type DashboardData = { content: number; approvals: number; connected: number; jobs: DashboardJob[]; metrics: MetricSnapshot[]; insights: LearningInsight[] };

const emptyData: DashboardData = { content: 0, approvals: 0, connected: 0, jobs: [], metrics: [], insights: [] };
const providerNames: Record<string, string> = { FACEBOOK: "Facebook", INSTAGRAM: "Instagram", LINKEDIN: "LinkedIn" };

function providerName(value: string) { return providerNames[value.toUpperCase()] ?? value; }
function formatMoment(value: string, includeTime = true) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Data da verificare";
  return new Intl.DateTimeFormat("it-IT", includeTime ? { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short" }).format(date);
}
function metricLabel(value: string) {
  const labels: Record<string, string> = { impressions: "Visualizzazioni", reach: "Copertura", engagement: "Interazioni", engagement_rate: "Tasso di interazione", likes: "Mi piace", comments: "Commenti", shares: "Condivisioni", clicks: "Clic" };
  return labels[value.toLowerCase()] ?? value.replaceAll("_", " ");
}
function metricValue(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(parsed) : null;
}

export function DashboardPage() {
  const { selectedProfile } = useProfiles();
  const [data, setData] = useState<DashboardData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const profileId = selectedProfile?.id;
    if (!profileId) return;
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      const [content, approvals, jobs, connections, metrics, insights] = await Promise.all([
        neonClient.from("content_items").select("id", { count: "exact", head: true }).eq("profile_id", profileId),
        neonClient.from("content_variants").select("id", { count: "exact", head: true }).eq("profile_id", profileId).eq("approval_status", "PENDING"),
        neonClient.from("publication_jobs").select("id,provider,state,scheduled_at,updated_at,last_error").eq("profile_id", profileId).order("scheduled_at", { ascending: false }).limit(100),
        neonClient.from("social_connections").select("id", { count: "exact", head: true }).eq("profile_id", profileId).eq("status", "ACTIVE"),
        neonClient.from("metric_snapshots").select("id,provider,metrics,captured_at").eq("profile_id", profileId).order("captured_at", { ascending: false }).limit(6),
        neonClient.from("learning_insights").select("id,recommendation,confidence,generated_at").eq("profile_id", profileId).eq("active", true).order("generated_at", { ascending: false }).limit(1),
      ]);
      const firstError = [content.error, approvals.error, jobs.error, connections.error, metrics.error, insights.error].find(Boolean);
      if (!active) return;
      setLoading(false);
      if (firstError) {
        setData(emptyData);
        setError("Non riesco ad aggiornare la panoramica. I tuoi dati non sono stati modificati.");
        return;
      }
      setData({ content: content.count ?? 0, approvals: approvals.count ?? 0, connected: connections.count ?? 0, jobs: (jobs.data ?? []) as DashboardJob[], metrics: (metrics.data ?? []) as MetricSnapshot[], insights: (insights.data ?? []) as LearningInsight[] });
    }
    void load();
    return () => { active = false; };
  }, [selectedProfile?.id]);

  const view = useMemo(() => {
    const upcoming = data.jobs.filter((job) => ["SCHEDULED", "QUEUED", "BLOCKED_APPROVAL"].includes(job.state)).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)).slice(0, 3);
    const published = data.jobs.filter((job) => job.state === "PUBLISHED").sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const failed = data.jobs.filter((job) => job.state === "FAILED");
    const metricEntries = Object.entries(data.metrics[0]?.metrics ?? {}).map(([label, value]) => ({ label: metricLabel(label), value: metricValue(value) })).filter((entry): entry is { label: string; value: string } => entry.value !== null).slice(0, 3);
    return { upcoming, published, failed, metricEntries };
  }, [data]);

  if (!selectedProfile) return null;
  const priority = view.failed.length > 0
    ? { icon: AlertTriangle, eyebrow: "Richiede attenzione", title: `${view.failed.length} pubblicazion${view.failed.length === 1 ? "e" : "i"} da sistemare`, body: "Controlla il collegamento social e riprogramma dal calendario.", label: "Risolvi ora", to: "/app/calendario" }
    : data.approvals > 0
      ? { icon: FileCheck2, eyebrow: "Da fare ora", title: `${data.approvals} contenut${data.approvals === 1 ? "o" : "i"} da rivedere`, body: "Controlla testo e immagine, poi approva ciò che è pronto per il calendario.", label: "Apri revisioni", to: "/app/approvazioni" }
    : data.connected === 0
      ? { icon: Share2, eyebrow: "Prossimo passo", title: "Collega il primo canale social", body: "Scegli dove pubblicare: i collegamenti restano separati per questa attività.", label: "Collega un social", to: "/app/social" }
      : view.upcoming.length === 0
        ? { icon: CalendarClock, eyebrow: "Prossimo passo", title: "Prepara la prossima pubblicazione", body: "Crea un contenuto e scegli quando deve uscire.", label: "Crea contenuto", to: "/app/contenuti" }
        : { icon: CheckCircle2, eyebrow: "Tutto sotto controllo", title: "Il piano editoriale è in movimento", body: `La prossima pubblicazione è prevista ${formatMoment(view.upcoming[0].scheduled_at)}.`, label: "Apri calendario", to: "/app/calendario" };
  const PriorityIcon = priority.icon;
  const advice = data.insights[0]?.recommendation;

  return <div className="page-content dashboard-page">
    <header className="dashboard-hero"><div><p className="eyebrow">La giornata di {selectedProfile.name}</p><h1>Cosa richiede attenzione oggi</h1><p>Contenuti, pubblicazioni e risultati in una sola panoramica.</p></div><NavLink className="primary-button dashboard-create" to="/app/contenuti"><Sparkles size={17} /> Crea contenuto</NavLink></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {loading ? <section className="dashboard-loading" aria-label="Caricamento panoramica"><span /><span /><span /></section> : <>
      <section className="dashboard-priority"><span className="dashboard-priority-icon"><PriorityIcon size={22} /></span><div><p className="eyebrow">{priority.eyebrow}</p><h2>{priority.title}</h2><p>{priority.body}</p></div><NavLink className="priority-link" to={priority.to}>{priority.label} <ArrowRight size={16} /></NavLink></section>
      <section className="dashboard-kpis" aria-label="Riepilogo attività"><article><FileText size={18} /><div><strong>{data.content}</strong><span>Contenuti creati</span></div></article><article><FileCheck2 size={18} /><div><strong>{data.approvals}</strong><span>Da rivedere</span></div></article><article><CalendarClock size={18} /><div><strong>{view.upcoming.length}</strong><span>Prossime uscite</span></div></article><article><Radio size={18} /><div><strong>{view.published.length}</strong><span>Pubblicati recenti</span></div></article></section>
      <div className="dashboard-grid">
        <section className="dashboard-card dashboard-schedule"><div className="dashboard-card-head"><div><p className="eyebrow">In calendario</p><h2>Prossime pubblicazioni</h2></div><NavLink to="/app/calendario">Vedi calendario</NavLink></div>{view.upcoming.length ? <div className="dashboard-list">{view.upcoming.map((job) => <article key={job.id}><span className="provider-dot" /><div><strong>{providerName(job.provider)}</strong><small>{job.state === "BLOCKED_APPROVAL" ? "In attesa di approvazione" : "Programmato"}</small></div><time>{formatMoment(job.scheduled_at)}</time></article>)}</div> : <div className="dashboard-empty"><CalendarClock size={22} /><div><strong>Calendario libero</strong><p>Il prossimo contenuto che programmi comparirà qui.</p></div></div>}<div className="dashboard-recent"><strong>Pubblicato di recente</strong>{view.published.length ? <div className="dashboard-list">{view.published.slice(0, 2).map((job) => <article key={job.id}><span className="provider-dot published" /><div><strong>{providerName(job.provider)}</strong><small>Pubblicato</small></div><time>{formatMoment(job.updated_at)}</time></article>)}</div> : <p>Nessuna pubblicazione completata per questa attività.</p>}</div></section>
        <section className="dashboard-card dashboard-performance"><div className="dashboard-card-head"><div><p className="eyebrow">Risultati</p><h2>Come stanno andando i social</h2></div><NavLink to="/app/analytics">Apri analytics</NavLink></div>{view.metricEntries.length ? <><div className="dashboard-metrics">{view.metricEntries.map((entry) => <article key={entry.label}><strong>{entry.value}</strong><span>{entry.label}</span></article>)}</div><small className="dashboard-source">{providerName(data.metrics[0].provider)} · aggiornato {formatMoment(data.metrics[0].captured_at, false)}</small></> : <div className="dashboard-empty"><BarChart3 size={22} /><div><strong>Risultati non ancora disponibili</strong><p>Compariranno dopo le prime pubblicazioni e la raccolta dei dati reali.</p></div></div>}</section>
        <section className="dashboard-card dashboard-advice"><div className="dashboard-card-head"><div><p className="eyebrow">Consiglio AI</p><h2>La prossima ottimizzazione</h2></div><Lightbulb size={21} /></div>{advice ? <><blockquote>{advice}</blockquote><NavLink className="text-link" to="/app/apprendimento">Vedi tutti i consigli <ArrowRight size={14} /></NavLink></> : <div className="dashboard-empty"><Lightbulb size={22} /><div><strong>Sto raccogliendo segnali utili</strong><p>Dopo abbastanza pubblicazioni, qui apparirà un consiglio basato sui risultati reali.</p></div></div>}</section>
        <section className={`dashboard-card dashboard-issues ${view.failed.length || data.connected === 0 ? "needs-attention" : ""}`}><div className="dashboard-card-head"><div><p className="eyebrow">Controlli</p><h2>Problemi da risolvere</h2></div>{view.failed.length || data.connected === 0 ? <AlertTriangle size={21} /> : <CheckCircle2 size={21} />}</div>{view.failed.length ? <div className="dashboard-issue"><strong>{view.failed.length} pubblicazion{view.failed.length === 1 ? "e" : "i"} non riuscit{view.failed.length === 1 ? "a" : "e"}</strong><p>Apri il calendario per verificare il canale e riprogrammare.</p><NavLink to="/app/calendario">Risolvi <ArrowRight size={14} /></NavLink></div> : data.connected === 0 ? <div className="dashboard-issue"><strong>Nessun social collegato</strong><p>Collega almeno un canale prima di pubblicare.</p><NavLink to="/app/social">Collega ora <ArrowRight size={14} /></NavLink></div> : <div className="dashboard-clear"><CheckCircle2 size={20} /><span>Nessun problema operativo rilevato.</span></div>}</section>
      </div>
    </>}
  </div>;
}
