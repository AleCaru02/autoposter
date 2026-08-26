import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, Eye, Pause, Play, ShieldCheck, Sparkles, WandSparkles } from "lucide-react";
import { NavLink } from "react-router-dom";
import { authClient } from "../lib/neon-client";
import { useProfiles } from "../features/profiles/profile-context";
import { loadAutopilotOverview, saveAutopilotSettings, type AutopilotOverview, type AutopilotSettings } from "../features/content/autopilot-store";

type JwtAuth = { getJWTToken?: () => Promise<string | null> };

const PROVIDER_LABELS: Record<string, string> = {
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  LINKEDIN: "LinkedIn",
  GBP: "Google Business Profile",
};

export function ContentGeneratorPage() {
  const { selectedProfile } = useProfiles();
  const [overview, setOverview] = useState<AutopilotOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const triggeredProfile = useRef<string | null>(null);

  const load = useCallback(async () => {
    const profileId = selectedProfile?.id;
    if (!profileId) return;
    setLoading(true);
    try {
      setOverview(await loadAutopilotOverview(profileId));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossibile caricare l'automazione contenuti.");
    } finally {
      setLoading(false);
    }
  }, [selectedProfile?.id]);

  useEffect(() => { void load(); }, [load]);

  const triggerAutopilot = useCallback(async () => {
    const profileId = selectedProfile?.id;
    if (!profileId || triggeredProfile.current === profileId) return;
    triggeredProfile.current = profileId;
    try {
      const token = await (authClient as typeof authClient & JwtAuth).getJWTToken?.();
      if (!token) return;
      await fetch("/api/autopilot/run", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      window.setTimeout(() => { void load(); }, 2500);
    } catch {
      // Il cron server continua comunque a gestire l'autopilot: nessun errore UI per il trigger anticipato.
    }
  }, [selectedProfile?.id, load]);

  useEffect(() => {
    if (overview?.settings.enabled) void triggerAutopilot();
  }, [overview?.settings.enabled, triggerAutopilot]);

  async function changeSettings(patch: Partial<AutopilotSettings>) {
    if (!selectedProfile?.id || !overview) return;
    const previous = overview.settings;
    const next = { ...previous, ...patch };
    setOverview({ ...overview, settings: next });
    setError(null);
    try {
      await saveAutopilotSettings(selectedProfile.id, next);
      if (next.enabled) {
        triggeredProfile.current = null;
        void triggerAutopilot();
      }
    } catch (reason) {
      setOverview({ ...overview, settings: previous });
      setError(reason instanceof Error ? reason.message : "Impostazione non salvata.");
    }
  }

  if (!selectedProfile) return null;
  if (loading || !overview) return <div className="page-content"><section className="panel">Caricamento automazione…</section></div>;

  const automaticApproval = overview.settings.approvalMode === "AUTOMATIC";

  return <div className="page-content content-autopilot-page">
    <header className="page-header"><div><p className="eyebrow">Contenuti · {selectedProfile.name}</p><h1>Contenuti automatici</h1><p>Post Automatici usa sito, brand e frequenze per preparare i contenuti senza chiederti ogni volta tema, social o formato.</p></div></header>
    {error && <p className="form-error" role="alert">{error}</p>}

    <section className={`autopilot-master ${overview.settings.enabled ? "active" : "paused"}`}>
      <div className="autopilot-master-icon">{overview.settings.enabled ? <WandSparkles size={23} /> : <Pause size={23} />}</div>
      <div className="autopilot-master-copy"><small>AUTOPILOT</small><h2>{overview.settings.enabled ? "Attivo" : "In pausa"}</h2><p>{overview.settings.enabled ? "Il sistema mantiene il piano editoriale, crea testi e immagini e prepara le date nel calendario." : "Nessun nuovo contenuto automatico viene creato finché non riattivi l'autopilot."}</p></div>
      <button className={`autopilot-toggle ${overview.settings.enabled ? "pause" : "play"}`} type="button" onClick={() => void changeSettings({ enabled: !overview.settings.enabled })}>{overview.settings.enabled ? <><Pause size={15} /> Metti in pausa</> : <><Play size={15} /> Riattiva</>}</button>
    </section>

    <section className="panel approval-mode-panel">
      <div className="panel-heading"><div><h2>Prima della pubblicazione</h2><p>Scegli una volta come deve comportarsi il sistema. Puoi cambiarlo quando vuoi.</p></div><ShieldCheck size={20} /></div>
      <div className="approval-mode-grid">
        <button type="button" className={`approval-mode-card ${!automaticApproval ? "selected" : ""}`} onClick={() => void changeSettings({ approvalMode: "MANUAL_REVIEW" })}>
          <span className="approval-mode-icon"><Eye size={19} /></span><strong>Voglio approvare io</strong><p>Il sistema crea tutto e lo mette nel calendario, ma il post resta in attesa finché non lo approvi nelle Revisioni.</p><span className="mode-check">{!automaticApproval ? "Attivo" : "Seleziona"}</span>
        </button>
        <button type="button" className={`approval-mode-card ${automaticApproval ? "selected" : ""}`} onClick={() => void changeSettings({ approvalMode: "AUTOMATIC" })}>
          <span className="approval-mode-icon"><Sparkles size={19} /></span><strong>Gestisci tutto automaticamente</strong><p>Il sistema crea, approva e programma da solo. La pubblicazione esterna partirà solo quando il relativo social sarà realmente collegato.</p><span className="mode-check">{automaticApproval ? "Attivo" : "Seleziona"}</span>
        </button>
      </div>
    </section>

    <section className="autopilot-flow">
      <article><span>1</span><div><strong>Capisce l'attività</strong><p>Usa tutte le pagine analizzate del sito e i dati del brand.</p></div></article>
      <article><span>2</span><div><strong>Sceglie cosa creare</strong><p>Decide autonomamente tema e formato adatto al singolo social, evitando ripetizioni recenti.</p></div></article>
      <article><span>3</span><div><strong>Crea testo e immagine</strong><p>Usa OpenAI per il copy e GPT-Image-2 per le immagini.</p></div></article>
      <article><span>4</span><div><strong>Organizza il calendario</strong><p>Rispetta le frequenze dell'attività e prepara i contenuti nei giorni previsti.</p></div></article>
    </section>

    <section className="panel autopilot-plan-panel">
      <div className="panel-heading"><div><h2>Piano attuale</h2><p>Le frequenze si modificano dal calendario; qui vedi cosa sta usando l'autopilot.</p></div><CalendarDays size={20} /></div>
      {overview.schedules.length ? <div className="autopilot-schedule-list">{overview.schedules.filter((schedule) => schedule.enabled).map((schedule) => <div key={schedule.provider}><span>{PROVIDER_LABELS[schedule.provider] ?? schedule.provider}</span><strong>{schedule.posts_per_week} {schedule.posts_per_week === 1 ? "contenuto" : "contenuti"} / settimana</strong></div>)}</div> : <p className="autopilot-preparing">Il piano iniziale viene preparato automaticamente.</p>}
      <div className="autopilot-counters"><div><span>In revisione</span><strong>{overview.inReview}</strong></div><div><span>Nel calendario</span><strong>{overview.upcoming}</strong></div></div>
      <div className="autopilot-links"><NavLink to="/app/calendario">Apri calendario</NavLink>{!automaticApproval && <NavLink to="/app/approvazioni">Apri Revisioni</NavLink>}</div>
    </section>
  </div>;
}
