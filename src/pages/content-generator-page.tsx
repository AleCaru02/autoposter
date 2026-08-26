import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, Eye, Globe2, LoaderCircle, Pause, Play, ShieldCheck, Sparkles, WandSparkles } from "lucide-react";
import { NavLink } from "react-router-dom";
import { authClient } from "../lib/neon-client";
import { useProfiles } from "../features/profiles/profile-context";
import { loadAutopilotOverview, saveAutopilotSettings, type AutopilotOverview, type AutopilotSettings } from "../features/content/autopilot-store";

type VisualHints = { colors: string[]; socialLinks: Record<string, string>; logoUrl: string | null };
type ScanResponse = { visualHints?: VisualHints; analyzedPages?: number; error?: string; detail?: string };
type AnalysisResponse = { pagesAnalyzed?: number; error?: string; detail?: string };

const PROVIDER_LABELS: Record<string, string> = {
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  LINKEDIN: "LinkedIn",
  GBP: "Google Business Profile",
};

export function ContentGeneratorPage() {
  const { selectedProfile, reload: reloadProfiles } = useProfiles();
  const [overview, setOverview] = useState<AutopilotOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapPages, setBootstrapPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const triggeredProfile = useRef<string | null>(null);
  const bootstrappedProfile = useRef<string | null>(null);

  const jwt = useCallback(async () => {
    const token = await authClient.getJwtToken();
    if (!token) throw new Error("Sessione non valida. Accedi di nuovo.");
    return token;
  }, []);

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

  const bootstrapLegacyProfile = useCallback(async () => {
    const profile = selectedProfile;
    if (!profile || profile.onboarding_completed) return;
    if (bootstrappedProfile.current === profile.id) return;
    if (!profile.website_url?.trim()) {
      setLoading(false);
      setError("Per avviare i contenuti automatici serve prima il sito dell'attività. Aggiungilo nella sezione Brand.");
      return;
    }

    bootstrappedProfile.current = profile.id;
    setBootstrapping(true);
    setLoading(true);
    setBootstrapPages(0);
    setError(null);
    try {
      const token = await jwt();
      const scanResponse = await fetch("/api/website-scan", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ profileId: profile.id, pageLimit: 500 }),
      });
      const scanBody = await scanResponse.json() as ScanResponse;
      if (!scanResponse.ok) throw new Error(scanBody.detail || scanBody.error || "Analisi iniziale del sito non riuscita.");
      const hints = scanBody.visualHints ?? { colors: [], socialLinks: {}, logoUrl: null };
      setBootstrapPages(scanBody.analyzedPages ?? 0);

      const analysisResponse = await fetch("/api/onboarding-analyze", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ profileId: profile.id, visualHints: hints }),
      });
      const analysisBody = await analysisResponse.json() as AnalysisResponse;
      if (!analysisResponse.ok) throw new Error(analysisBody.detail || analysisBody.error || "Analisi iniziale del brand non riuscita.");
      setBootstrapPages(analysisBody.pagesAnalyzed ?? scanBody.analyzedPages ?? 0);
      await reloadProfiles();
    } catch (reason) {
      bootstrappedProfile.current = null;
      setError(reason instanceof Error ? reason.message : "Preparazione automatica dell'attività non riuscita.");
      setLoading(false);
    } finally {
      setBootstrapping(false);
    }
  }, [selectedProfile, jwt, reloadProfiles]);

  useEffect(() => {
    triggeredProfile.current = null;
    if (!selectedProfile) return;
    if (!selectedProfile.onboarding_completed) {
      setOverview(null);
      void bootstrapLegacyProfile();
      return;
    }
    void load();
  }, [selectedProfile?.id, selectedProfile?.onboarding_completed, bootstrapLegacyProfile, load]);

  const triggerAutopilot = useCallback(async () => {
    const profileId = selectedProfile?.id;
    if (!profileId || !selectedProfile.onboarding_completed || triggeredProfile.current === profileId) return;
    triggeredProfile.current = profileId;
    try {
      const token = await jwt();
      const response = await fetch("/api/autopilot/run", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { detail?: string; error?: string };
        throw new Error(body.detail || body.error || "AUTOPILOT_RUN_FAILED");
      }
      window.setTimeout(() => { void load(); }, 2500);
    } catch (reason) {
      triggeredProfile.current = null;
      setError(reason instanceof Error ? reason.message : "Autopilot non avviato.");
    }
  }, [selectedProfile?.id, selectedProfile?.onboarding_completed, jwt, load]);

  useEffect(() => {
    if (overview?.settings.enabled && selectedProfile?.onboarding_completed) void triggerAutopilot();
  }, [overview?.settings.enabled, selectedProfile?.onboarding_completed, triggerAutopilot]);

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
  if (bootstrapping) return <div className="page-content"><section className="panel onboarding-loading"><Globe2 size={24} /><LoaderCircle className="spin" size={28} /><h2>Sto preparando l'attività</h2><p>{bootstrapPages > 0 ? `${bootstrapPages} pagine del sito analizzate. ` : ""}Scansione del sito e analisi del brand stanno avvenendo automaticamente. Non devi fare nulla.</p></section></div>;
  if ((loading || !overview) && !error) return <div className="page-content"><section className="panel">Caricamento automazione…</section></div>;
  if (!overview) return <div className="page-content"><header className="page-header"><div><p className="eyebrow">Contenuti · {selectedProfile.name}</p><h1>Contenuti automatici</h1></div></header>{error && <p className="form-error" role="alert">{error}</p>}</div>;

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
