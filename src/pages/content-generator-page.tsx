import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, CalendarDays, ChevronDown, Eye, Globe2, LoaderCircle, Pause, Play, Settings2, ShieldCheck, Sparkles, WandSparkles } from "lucide-react";
import { NavLink } from "react-router-dom";
import type { EditorialResearchMode } from "../../api/_lib/editorial-research";
import { authenticatedApiToken } from "../lib/auth-token";
import { runFullWebsiteScan } from "../lib/full-website-scan";
import { useProfiles } from "../features/profiles/profile-context";
import { loadAutopilotOverview, saveAutopilotSettings, type AutopilotOverview, type AutopilotSettings } from "../features/content/autopilot-store";
import { CustomerWorkflowJourney } from "../components/customer-workflow-journey";
import { ManualContentComposer } from "../components/manual-content-composer";

type AnalysisResponse = { pagesAnalyzed?: number; error?: string; detail?: string };
type AutopilotRunResponse = {
  generated?: number;
  blockedForReview?: number;
  skipped?: number;
  errors?: string[];
  error?: string;
};

function autopilotFailureMessage(code: string): string {
  switch (code) {
    case "DATABASE_NOT_CONFIGURED":
      return "Il server di questa versione non ha ancora il collegamento al database. L'Autopilot non può avviarsi.";
    case "OPENAI_NOT_CONFIGURED":
      return "Il server di questa versione non ha ancora le credenziali AI. L'Autopilot non può generare contenuti.";
    case "AUTOPILOT_CANONICAL_UNAVAILABLE":
      return "Il motore AI principale non è raggiungibile. Non sono stati confermati nuovi contenuti.";
    case "AUTOPILOT_CANONICAL_INVALID_RESPONSE":
      return "Il motore AI principale ha restituito una risposta non valida.";
    case "SESSION_INVALID":
    case "AUTH_REQUIRED":
      return "Sessione scaduta: accedi di nuovo per avviare l'Autopilot.";
    case "PROFILE_NOT_FOUND":
      return "Non hai accesso all'attività selezionata. Controlla il profilo.";
    case "AUTOPILOT_AI_LIMIT_REACHED":
      return "Il limite AI dell'attività è stato raggiunto. Nessuna nuova generazione viene avviata.";
    case "PROFILE_DATA_API_UNAVAILABLE":
      return "Non riesco a verificare il profilo nel database. Riprova più tardi.";
    default:
      return "Generazione automatica non completata. Il server ha segnalato un errore: " + code.replace(/[^A-Z0-9_]/g, "").slice(0, 80);
  }
}

function autopilotResultMessage(value: AutopilotRunResponse): string | null {
  if (typeof value.generated === "number" && value.generated > 0) return null;
  const firstError = value.errors?.find(e => typeof e === "string" && e.trim());
  if (!firstError) return null;
  const code = firstError.split(":").find(part => part.startsWith("AUTOPILOT_AI_LIMIT_REACHED") || part.startsWith("OPENAI_")) ??
    firstError.split(":").at(-1) ?? "AUTOPILOT_RUN_FAILED";
  return autopilotFailureMessage(code);
}

const PROVIDER_LABELS: Record<string, string> = {
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  LINKEDIN: "LinkedIn",
  GBP: "Google Business Profile",
};

const RESEARCH_MODES: Array<{ value: EditorialResearchMode; title: string; description: string }> = [
  { value: "BALANCED", title: "Bilanciato", description: "Mescola informazioni di settore, consigli, contenuti evergreen e aggiornamenti pertinenti." },
  { value: "TIPS", title: "Consigli", description: "Privilegia guide pratiche, checklist, spiegazioni ed errori da evitare." },
  { value: "NEWS", title: "News", description: "Privilegia notizie e aggiornamenti recenti realmente collegati al settore." },
  { value: "EVERGREEN", title: "Evergreen", description: "Privilegia temi utili e durevoli, senza forzare news o trend." },
  { value: "WEBSITE_ONLY", title: "Solo sito", description: "Usa esclusivamente i fatti e i temi confermati dal sito e dal brand." },
];

export function ContentGeneratorPage() {
  const { profiles, selectedProfile, reload: reloadProfiles } = useProfiles();
  const [overview, setOverview] = useState<AutopilotOverview | null>(null);
  const [overviewLoadedFor, setOverviewLoadedFor] = useState<string | null>(null);
  const currentProfileIdRef = useRef<string | null>(selectedProfile?.id ?? null);
  currentProfileIdRef.current = selectedProfile?.id ?? null;
  const loadSequenceRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapPages, setBootstrapPages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showManualComposer, setShowManualComposer] = useState(false);
  const [showAllTopics, setShowAllTopics] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const settingsSavingRef = useRef(false);
  const [autopilotRunning, setAutopilotRunning] = useState(false);
  const [autopilotNotice, setAutopilotNotice] = useState<string | null>(null);
  const triggeredProfile = useRef<string | null>(null);
  const bootstrappedProfile = useRef<string | null>(null);

  const jwt = useCallback(async () => {
    return authenticatedApiToken();
  }, []);

  const load = useCallback(async () => {
    const profileId = selectedProfile?.id;
    if (!profileId) return;
    const sequence = ++loadSequenceRef.current;
    setLoading(true);
    try {
      const next = await loadAutopilotOverview(profileId);
      if (currentProfileIdRef.current !== profileId || loadSequenceRef.current !== sequence) return;
      setOverview(next);
      setOverviewLoadedFor(profileId);
      setError(null);
    } catch (reason) {
      if (currentProfileIdRef.current === profileId && loadSequenceRef.current === sequence) {
        setError(reason instanceof Error ? reason.message : "Impossibile caricare l'automazione contenuti.");
      }
    } finally {
      if (currentProfileIdRef.current === profileId && loadSequenceRef.current === sequence) setLoading(false);
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
      const scanBody = await runFullWebsiteScan({
        profileId: profile.id,
        getToken: jwt,
        onProgress: (batch) => setBootstrapPages(batch.analyzedPages ?? 0),
      });
      const hints = scanBody.visualHints;
      setBootstrapPages(scanBody.analyzedPages ?? 0);

      const analysisToken = await jwt();
      const analysisResponse = await fetch("/api/onboarding-analyze", {
        method: "POST",
        headers: { authorization: `Bearer ${analysisToken}`, "content-type": "application/json" },
        body: JSON.stringify({ profileId: profile.id, visualHints: hints }),
      });
      const analysisBody = await analysisResponse.json() as AnalysisResponse;
      if (!analysisResponse.ok) throw new Error("Analisi iniziale del brand non riuscita. Riprova tra poco.");
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
    setShowAllTopics(false);
    setAutopilotNotice(null);
    setOverview(null);
    setOverviewLoadedFor(null);
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
    setAutopilotRunning(true);
    setAutopilotNotice(null);
    try {
      const token = await jwt();
      const response = await fetch("/api/autopilot/run", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      const body = await response.json().catch(() => null) as AutopilotRunResponse | null;
      if (currentProfileIdRef.current !== profileId) return;
      if (!response.ok) throw new Error(autopilotFailureMessage(body?.error ?? `HTTP_${response.status}`));
      if (!body) throw new Error(autopilotFailureMessage("AUTOPILOT_CANONICAL_INVALID_RESPONSE"));
      setAutopilotNotice(autopilotResultMessage(body));
      await load();
    } catch (reason) {
      if (currentProfileIdRef.current === profileId) {
        triggeredProfile.current = null;
        setError(reason instanceof Error ? reason.message : "Autopilot non avviato.");
      }
    } finally {
      if (currentProfileIdRef.current === profileId) setAutopilotRunning(false);
    }
  }, [selectedProfile?.id, selectedProfile?.onboarding_completed, jwt, load]);

  useEffect(() => {
    if (overview?.settings.enabled && selectedProfile?.onboarding_completed) void triggerAutopilot();
  }, [overview?.settings.enabled, selectedProfile?.onboarding_completed, triggerAutopilot]);

  async function changeSettings(patch: Partial<AutopilotSettings>) {
    if (!selectedProfile?.id || !overview || settingsSavingRef.current) return;
    settingsSavingRef.current = true;
    setSettingsSaving(true);
    const previous = overview.settings;
    const next = { ...previous, ...patch };
    setOverview({ ...overview, settings: next });
    setError(null);
    try {
      await saveAutopilotSettings(selectedProfile.id, next);
      if (next.enabled && !previous.enabled) {
        triggeredProfile.current = null;
        void triggerAutopilot();
      }
    } catch (reason) {
      setOverview({ ...overview, settings: previous });
      setError(reason instanceof Error ? reason.message : "Impostazione non salvata.");
    } finally {
      settingsSavingRef.current = false;
      setSettingsSaving(false);
    }
  }

  if (!selectedProfile) return null;
  if (bootstrapping) return <div className="page-content"><section className="panel onboarding-loading"><Globe2 size={24} /><LoaderCircle className="spin" size={28} /><h2>Sto preparando l'attività</h2><p>{bootstrapPages > 0 ? `${bootstrapPages} pagine del sito analizzate. ` : ""}Scansione del sito e analisi del brand stanno avvenendo automaticamente. Non devi fare nulla.</p></section></div>;
  if ((loading || !overview || overviewLoadedFor !== selectedProfile.id) && !error) return <div className="page-content"><section className="panel">Caricamento automazione…</section></div>;
  if (!overview || overviewLoadedFor !== selectedProfile.id) return <div className="page-content"><header className="page-header"><div><p className="eyebrow">Contenuti · {selectedProfile.name}</p><h1>Contenuti automatici</h1></div></header>{error && <p className="form-error" role="alert">{error}</p>}</div>;

  const automaticApproval = overview.settings.approvalMode === "AUTOMATIC";

  const plan = overview.editorialPlan;
  const visibleTopics = plan?.items.slice(0, showAllTopics ? 60 : 5) ?? [];
  const generatedAt = plan?.generatedAt && Number.isFinite(Date.parse(plan.generatedAt)) ? new Date(plan.generatedAt) : null;
  const planStale = generatedAt !== null && Date.now() - generatedAt.getTime() > 14 * 86400000;
  const activeSchedules = overview.schedules.filter(schedule => schedule.enabled);
  const currentResearch = RESEARCH_MODES.find(mode => mode.value === overview.settings.researchMode)?.title ?? "Bilanciato";

  return <div className="page-content content-autopilot-page studio-editorial-page">
    <header className="page-header editorial-page-heading">
      <div>
        <p className="eyebrow">STUDIO EDITORIALE · {selectedProfile.name}</p>
        <h1>Il tuo piano editoriale</h1>
        <p>I temi vengono scelti per la tua attività. Qui controlli il piano, non devi scrivere ogni singolo post.</p>
      </div>
      <NavLink className="editorial-heading-link" to="/app/calendario"><CalendarDays size={16}/> Calendario <ArrowRight size={15}/></NavLink>
    </header>

    {error && <div className="editorial-alert" role="alert"><ShieldCheck size={18}/><p>{error}</p></div>}
    {autopilotNotice && <div className="editorial-alert subtle" role="status"><Globe2 size={18}/><p>{autopilotNotice}</p></div>}
    {settingsSaving && <p className="editorial-saving-status" role="status">Salvataggio preferenze…</p>}

    <section className={`autopilot-master editorial-control ${overview.settings.enabled ? "active" : "paused"}`} aria-label="Stato automazione">
      <div className="autopilot-master-icon">{autopilotRunning ? <LoaderCircle className="spin" size={23} /> : overview.settings.enabled ? <WandSparkles size={23} /> : <Pause size={23}/>}</div>
      <div className="autopilot-master-copy">
        <small>AUTOPILOT · {selectedProfile.name}</small>
        <h2>{autopilotRunning ? "Preparazione in corso" : overview.settings.enabled ? "Automazione attiva" : "Automazione in pausa"}</h2>
        <p>{autopilotRunning ? "Il motore sta controllando il piano e preparando eventuali nuovi contenuti." : overview.settings.enabled ? "Il sistema è abilitato a preparare contenuti secondo le frequenze impostate. Le pubblicazioni richiedono comunque autorizzazioni social valide." : "I nuovi contenuti automatici non vengono creati finché non riattivi l'automazione."}</p>
      </div>
      <button type="button" className={`autopilot-toggle ${overview.settings.enabled ? "pause" : "play"}`} disabled={autopilotRunning || settingsSaving} aria-pressed={overview.settings.enabled} onClick={() => void changeSettings({ enabled: !overview.settings.enabled })}>
        {overview.settings.enabled ? <><Pause size={16} /> Metti in pausa</> : <><Play size={16} /> Riattiva</>}
      </button>
    </section>

    <div className="editorial-summary" aria-label="Stato del piano">
      <div><strong>{plan?.items.length ?? 0}</strong><span>Idee nel piano AI</span></div>
      <div><strong>{overview.inReview}</strong><span>In revisione</span></div>
      <div><strong>{overview.upcoming}</strong><span>Nel calendario</span></div>
      <div><strong>{activeSchedules.length}</strong><span>Canali pianificati</span></div>
    </div>

    <section className="panel editorial-plan-surface" aria-labelledby="editorial-plan-title">
      <div className="editorial-plan-head">
        <div><p className="eyebrow">DECISIONI EDITORIALI</p><h2 id="editorial-plan-title">I prossimi argomenti</h2><p>Questi sono temi effettivamente salvati nel piano della tua attività; non sono pubblicazioni confermate.</p></div>
        {generatedAt && <div className="editorial-plan-updated"><span>Piano generato</span><strong>{new Intl.DateTimeFormat("it-IT",{day:"2-digit",month:"short",year:"numeric"}).format(generatedAt)}</strong>{planStale && <small>Da aggiornare</small>}</div>}
      </div>
      {visibleTopics.length ? <>
        <div className="editorial-topic-list">
          {visibleTopics.map((item,index) => <article key={`${item.provider}-${item.dayOffset}-${index}`} className="editorial-topic-row">
            <span className="editorial-topic-index">{String(index+1).padStart(2,"0")}</span>
            <div>
              <div className="editorial-topic-meta"><span>{PROVIDER_LABELS[item.provider] ?? item.provider}</span><span>{item.contentType === "CAROUSEL" ? "Carosello" : item.contentType === "STORY" ? "Storia" : "Post"}</span><span>Giorno {item.dayOffset + 1}</span></div>
              <h3>{item.topicDirection}</h3>
              {item.objective && <p>{item.objective}</p>}
            </div>
          </article>)}
        </div>
        {plan && plan.items.length > 5 && <button type="button" className="editorial-more-topics" aria-expanded={showAllTopics} onClick={() => setShowAllTopics(value => !value)}>{showAllTopics ? "Mostra solo i primi cinque" : `Vedi tutti i ${plan.items.length} argomenti`} <ChevronDown size={17} /></button>}
      </> : <div className="editorial-plan-empty"><WandSparkles size={24}/><strong>Piano non ancora disponibile</strong><p>L'automazione preparerà gli argomenti quando il servizio AI e il budget dell'attività saranno disponibili. Non vengono mostrati titoli inventati.</p></div>}
    </section>

    <div className="editorial-context-grid">
      <section className="panel editorial-context-card" aria-labelledby="editorial-frequency-title">
        <div className="editorial-context-top"><CalendarDays size={19}/><h2 id="editorial-frequency-title">Frequenza</h2></div>
        <p>Le uscite sono separate per attività e per social.</p>
        {activeSchedules.length ? <div className="editorial-frequency-list">
          {activeSchedules.map(schedule => <div key={schedule.provider}><span>{PROVIDER_LABELS[schedule.provider] ?? schedule.provider}</span><strong>{schedule.posts_per_week} / settimana</strong></div>)}
        </div> : <p className="editorial-minor-note">Nessun canale ha una frequenza attiva.</p>}
        <NavLink to="/app/calendario">Modifica calendario <ArrowRight size={15}/></NavLink>
      </section>

      <section className="panel editorial-context-card" aria-labelledby="editorial-research-title">
        <div className="editorial-context-top"><Globe2 size={19}/><h2 id="editorial-research-title">Fonti e concorrenti</h2></div>
        <p>Ricerca: <strong>{currentResearch}</strong>. Il sito della tua attività resta la fonte per servizi e promesse del brand.</p>
        {overview.competitorResearch.competitors.length ? <ul className="editorial-competitor-list">{overview.competitorResearch.competitors.map(competitor => <li key={competitor.website}><a href={competitor.website} target="_blank" rel="noopener noreferrer">{competitor.name} <ArrowRight size={13}/></a><small>{competitor.editorialOpportunity}</small></li>)}</ul> :
          <p className="editorial-minor-note">Nessun concorrente verificato nelle fonti disponibili. Il sistema non ne inventa.</p>}
        <NavLink to="/app/sito">Vedi analisi sito <ArrowRight size={15}/></NavLink>
      </section>
    </div>

    <details className="panel editorial-preferences">
      <summary><span><Settings2 size={21}/><span><strong>Preferenze dell'automazione</strong><small>Approvazione, ricerca e regole per questa attività</small></span></span><ChevronDown size={19}/></summary>
      <div className="editorial-preferences-body">
        <h3>Prima della pubblicazione</h3>
        <p>Scegli se controllare tu i contenuti o lasciare che il sistema li approvi e programmi. La pubblicazione esterna rimane bloccata senza un social realmente collegato.</p>
        <div className="approval-mode-grid">
          <button type="button" className={`approval-mode-card ${!automaticApproval ? "selected" : ""}`} aria-pressed={!automaticApproval} disabled={settingsSaving} onClick={() => void changeSettings({ approvalMode: "MANUAL_REVIEW" })}>
            <span className="approval-mode-icon"><Eye size={19}/></span><strong>Approvo io</strong><p>I contenuti arrivano nelle Revisioni prima della pubblicazione.</p><span className="mode-check">{!automaticApproval ? "Attivo" : "Seleziona"}</span>
          </button>
          <button type="button" className={`approval-mode-card ${automaticApproval ? "selected" : ""}`} aria-pressed={automaticApproval} disabled={settingsSaving} onClick={() => void changeSettings({ approvalMode: "AUTOMATIC" })}>
            <span className="approval-mode-icon"><Sparkles size={19}/></span><strong>Gestisci automaticamente</strong><p>Approvazione e programmazione automatiche, solo sui canali autorizzati.</p><span className="mode-check">{automaticApproval ? "Attivo" : "Seleziona"}</span>
          </button>
        </div>
        <h3>Strategia dei contenuti</h3>
        <div className="approval-mode-grid editorial-research-grid">
          {RESEARCH_MODES.map(mode => <button type="button" key={mode.value} className={`approval-mode-card ${overview.settings.researchMode === mode.value ? "selected" : ""}`} aria-pressed={overview.settings.researchMode === mode.value} disabled={settingsSaving} onClick={() => void changeSettings({ researchMode: mode.value })}>
            <strong>{mode.title}</strong><p>{mode.description}</p><span className="mode-check">{overview.settings.researchMode === mode.value ? "Attivo" : "Seleziona"}</span>
          </button>)}
        </div>
        {(overview.settings.websitePilotEnabled || /web design|creazione siti|sviluppo siti|agenzia web/i.test(selectedProfile.industry ?? "")) && <div className="editorial-experimental">
          <h3>Pilota Instagram · siti web</h3><p>Solo per attività che vendono siti: massimo due post Instagram a settimana con revisione manuale.</p>
          <button type="button" className="secondary-button" aria-pressed={overview.settings.websitePilotEnabled} disabled={settingsSaving} onClick={() => void changeSettings({
            websitePilotEnabled: !overview.settings.websitePilotEnabled, approvalMode: "MANUAL_REVIEW",
            enabled: overview.settings.websitePilotEnabled ? overview.settings.enabled : true,
          })}>{overview.settings.websitePilotEnabled ? "Disattiva pilota" : "Attiva pilota Instagram"}</button>
        </div>}
      </div>
    </details>

    <section className="panel editorial-manual">
      <div><h2>Un contenuto fuori piano?</h2><p>La creazione manuale è facoltativa: usala solo per una richiesta speciale.</p></div>
      <button type="button" className="secondary-button" aria-expanded={showManualComposer} onClick={() => setShowManualComposer(value => !value)}>{showManualComposer ? "Chiudi strumento" : "Apri creazione manuale"} <ChevronDown size={16}/></button>
      {showManualComposer && <div className="editorial-manual-composer"><ManualContentComposer profileId={selectedProfile.id} profileName={selectedProfile.name} profileType={selectedProfile.profile_type} profiles={profiles} researchMode={overview.settings.researchMode} /></div>}
    </section>

    <section className="editorial-workflow-footer" aria-label="Prossime sezioni"><p className="eyebrow">NEL TUO FLUSSO DI LAVORO</p><CustomerWorkflowJourney current="CREATE" /></section>
  </div>;
}
