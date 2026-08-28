import { useEffect, useState } from "react";
import { CalendarClock, FileCheck2, FileText, Share2 } from "lucide-react";
import { neonClient } from "../lib/neon-client";
import { useProfiles } from "../features/profiles/profile-context";

type Stats = { content: number; approvals: number; scheduled: number; connected: number };
type Health = { ready: boolean; database: string; latencyMs?: number };

export function DashboardPage() {
  const { selectedProfile } = useProfiles();
  const [stats, setStats] = useState<Stats>({ content: 0, approvals: 0, scheduled: 0, connected: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadHealth() {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        const body = await response.json() as Partial<Health>;
        if (!active) return;
        setHealth({ ready: response.ok && body.ready === true, database: typeof body.database === "string" ? body.database : response.ok ? "unknown" : "unavailable", latencyMs: typeof body.latencyMs === "number" ? body.latencyMs : undefined });
        setHealthError(false);
      } catch {
        if (!active) return;
        setHealth(null);
        setHealthError(true);
      }
    }
    void loadHealth();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const profileId = selectedProfile?.id;
    if (!profileId) return;
    let active = true;
    async function load() {
      setLoading(true); setError(null);
      const [content, approvals, scheduled, connections] = await Promise.all([
        neonClient.from("content_items").select("id").eq("profile_id", profileId),
        neonClient.from("content_variants").select("id").eq("profile_id", profileId).eq("approval_status", "PENDING"),
        neonClient.from("publication_jobs").select("id").eq("profile_id", profileId).in("state", ["QUEUED", "SCHEDULED"]),
        neonClient.from("social_connections").select("id").eq("profile_id", profileId).eq("status", "ACTIVE"),
      ]);
      const firstError = [content.error, approvals.error, scheduled.error, connections.error].find(Boolean);
      if (!active) return;
      setLoading(false);
      if (firstError) { setError(firstError.message); return; }
      setStats({ content: content.data?.length ?? 0, approvals: approvals.data?.length ?? 0, scheduled: scheduled.data?.length ?? 0, connected: connections.data?.length ?? 0 });
    }
    void load();
    return () => { active = false; };
  }, [selectedProfile?.id]);

  if (!selectedProfile) return null;
  const cards = [["Contenuti", stats.content, FileText], ["Da approvare", stats.approvals, FileCheck2], ["Programmato", stats.scheduled, CalendarClock], ["Social connessi", stats.connected, Share2]] as const;
  const databaseOk = health?.ready === true && health.database === "connected";
  const databaseLabel = databaseOk ? `Attivo${typeof health?.latencyMs === "number" ? ` · ${health.latencyMs} ms` : ""}` : healthError ? "Verifica non disponibile" : health ? health.database === "not_configured" ? "Non configurato" : "Non disponibile" : "Verifica…";
  return <div className="page-content"><header className="page-header"><div><p className="eyebrow">Dashboard</p><h1>{selectedProfile.name}</h1><p>Dati reali del profilo selezionato. Nessuna metrica demo.</p></div></header>{error && <p className="form-error">{error}</p>}<section className="stat-grid">{cards.map(([label, value, Icon]) => <article className="stat-card" key={label}><Icon size={20} /><span>{label}</span><strong>{loading ? "—" : value}</strong></article>)}</section><section className="panel"><h2>Stato operativo</h2><div className="status-rows"><div><span>PostgreSQL runtime</span><strong className={databaseOk ? "status-ok" : "status-wait"}>{databaseLabel}</strong></div><div><span>Autenticazione</span><strong className="status-ok">Sessione attiva</strong></div><div><span>Isolamento profilo</span><strong className="status-ok">RLS applicato</strong></div><div><span>OpenAI</span><strong className="status-wait">Verificato durante la generazione</strong></div><div><span>Social</span><strong className={stats.connected > 0 ? "status-ok" : "status-wait"}>{stats.connected > 0 ? `${stats.connected} collegato${stats.connected === 1 ? "" : "i"}` : "Da configurare"}</strong></div></div></section></div>;
}
