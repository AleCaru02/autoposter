import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Building2, Check, Globe2, Layers3, LoaderCircle, RefreshCw } from "lucide-react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { authenticatedApiToken } from "../lib/auth-token";
import { runFullWebsiteScan, websiteScanProgress, type WebsiteScanProgress, type WebsiteVisualHints } from "../lib/full-website-scan";
import { useProfiles } from "../features/profiles/profile-context";
import { clearNewActivityFlow, readNewActivityFlow, rememberNewActivityProfile } from "../lib/onboarding-flow";

type AnalysisResponse = {
  pagesAnalyzed?: number;
  analysis?: {
    toneOfVoice?: { summary?: string; traits?: string[] };
    targetAudience?: { summary?: string; segments?: string[] };
    services?: string[];
    goals?: string[];
  };
  visualHints?: WebsiteVisualHints;
  error?: string;
  detail?: string;
};

type Stage = "FORM" | "CRAWL" | "ANALYZE" | "ERROR" | "DONE";

function concreteColors(values: string[]) {
  return values.filter((value) => {
    const normalized = value.trim().toLowerCase();
    return Boolean(normalized)
      && !/(?:var|calc|min|max|clamp)\(|--/.test(normalized)
      && !/^#(?:0000|00000000)$/.test(normalized);
  });
}

export function OnboardingPage() {
  const { profiles, loading, createProfile, reload } = useProfiles();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedNewActivity = searchParams.get("new") === "1";
  const [newActivityProfileId, setNewActivityProfileId] = useState<string | null>(() => readNewActivityFlow()?.createdProfileId ?? null);
  const creatingAnother = requestedNewActivity || Boolean(newActivityProfileId);
  const submitLock = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [stage, setStage] = useState<Stage>("FORM");
  const [error, setError] = useState<string | null>(null);
  const [createdProfileId, setCreatedProfileId] = useState<string | null>(null);
  const [pagesAnalyzed, setPagesAnalyzed] = useState(0);
  const [scanProgress, setScanProgress] = useState<WebsiteScanProgress>({ processed: 0, total: 0, percent: 0 });
  const [brandProgress, setBrandProgress] = useState(0);
  const [brandStatus, setBrandStatus] = useState("Preparo i dati già letti dal sito");
  const [failedPhase, setFailedPhase] = useState<"CRAWL" | "ANALYZE" | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse["analysis"] | null>(null);
  const [visualHints, setVisualHints] = useState<WebsiteVisualHints>({ colors: [], socialLinks: {}, logoUrl: null });
  const incompleteProfile = useMemo(() => profiles.find((profile) => !profile.onboarding_completed) ?? null, [profiles]);

  useEffect(() => {
    if (loading || submitting || stage !== "FORM") return;

    if (newActivityProfileId) {
      const pendingNewProfile = profiles.find((profile) => profile.id === newActivityProfileId) ?? null;
      if (pendingNewProfile?.onboarding_completed) {
        clearNewActivityFlow();
        setNewActivityProfileId(null);
        navigate("/app/profili", { replace: true });
        return;
      }
      if (pendingNewProfile) {
        setCreatedProfileId(pendingNewProfile.id);
        setError("La nuova attività è già stata salvata ma la configurazione non è completa. Riprendi da qui.");
        setStage("ERROR");
        return;
      }
      clearNewActivityFlow();
      setNewActivityProfileId(null);
      return;
    }

    if (requestedNewActivity) return;
    if (!incompleteProfile) return;
    setCreatedProfileId(incompleteProfile.id);
    setError("La configurazione di questa attività non è ancora completa. Riprendi da dove si era interrotta.");
    setStage("ERROR");
  }, [loading, submitting, stage, requestedNewActivity, newActivityProfileId, profiles, incompleteProfile?.id, navigate]);

  const steps = useMemo(() => [
    { key: "FORM", label: "Attività" },
    { key: "CRAWL", label: "Sito" },
    { key: "ANALYZE", label: "Brand" },
    { key: "DONE", label: "Pronto" },
  ] as const, []);

  if (loading) return <main className="center-state">Caricamento…</main>;
  if (profiles.length > 0 && !creatingAnother && stage === "FORM" && !incompleteProfile) return <Navigate to="/app/dashboard" replace />;

  async function jwt() {
    return authenticatedApiToken();
  }

  async function analyzeBrandOnly(profileId: string, hints: WebsiteVisualHints, fallbackPageCount: number) {
    setError(null);
    setFailedPhase(null);
    setStage("ANALYZE");
    setBrandProgress(15);
    setBrandStatus("Preparo i dati già letti dal sito");

    let analysisBody: AnalysisResponse | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      setBrandProgress(attempt === 0 ? 35 : 45 + attempt * 5);
      setBrandStatus(attempt === 0 ? "Analizzo identità, servizi, pubblico e tono" : "Riprendo l’analisi senza rileggere il sito");

      const analysisToken = await jwt();
      const analysisResponse = await fetch("/api/onboarding-analyze", {
        method: "POST",
        headers: { authorization: `Bearer ${analysisToken}`, "content-type": "application/json" },
        body: JSON.stringify({ profileId, visualHints: hints }),
      });
      analysisBody = await analysisResponse.json().catch(() => ({})) as AnalysisResponse;
      if (analysisResponse.ok) break;

      const nonRetryable = ["CAPABILITY_DISABLED", "CAPABILITY_LIMIT_REACHED", "PROVIDER_COST_BUDGET_REACHED", "OPENAI_NOT_CONFIGURED", "DATABASE_NOT_CONFIGURED"].includes(analysisBody.error ?? "");
      const retryable = !nonRetryable && (
        analysisResponse.status === 401
        || analysisResponse.status === 408
        || analysisResponse.status === 409
        || analysisResponse.status === 425
        || analysisResponse.status === 429
        || analysisResponse.status >= 500
        || analysisBody.error === "AUTH_REQUIRED"
        || analysisBody.error === "BRAND_ANALYSIS_IN_PROGRESS"
        || analysisBody.error === "ONBOARDING_ANALYSIS_FAILED"
      );
      if (retryable && attempt < 2) {
        await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 500 : 1_200));
        continue;
      }
      if (analysisBody.error === "PROVIDER_COST_BUDGET_REACHED") throw new Error("Budget AI temporaneamente raggiunto per questa attività.");
      if (analysisBody.error === "CAPABILITY_LIMIT_REACHED") throw new Error("Limite analisi brand raggiunto per questa attività.");
      throw new Error("Analisi del brand non riuscita. Riprova tra poco.");
    }

    if (!analysisBody?.analysis) throw new Error("Analisi del brand non riuscita. Riprova tra poco.");
    setBrandProgress(85);
    setBrandStatus("Analisi completata. Salvo il profilo");

    setAnalysis(analysisBody.analysis);
    setPagesAnalyzed(analysisBody.pagesAnalyzed ?? fallbackPageCount);
    const analyzedHints = analysisBody.visualHints ?? hints;
    setVisualHints({ ...analyzedHints, colors: concreteColors(analyzedHints.colors ?? []) });

    setBrandProgress(95);
    setBrandStatus("Salvo brand e configurazione dell’attività");
    await reload();
    clearNewActivityFlow();
    setNewActivityProfileId(null);
    if (requestedNewActivity) navigate("/onboarding", { replace: true });
    setBrandProgress(100);
    setBrandStatus("Brand pronto");
    setStage("DONE");
  }

  async function analyzeProfile(profileId: string) {
    setError(null);
    setFailedPhase(null);
    setScanProgress({ processed: 0, total: 0, percent: 0 });
    setStage("CRAWL");

    let scanBody;
    try {
      scanBody = await runFullWebsiteScan({
        profileId,
        getToken: jwt,
        onProgress: (batch) => {
          setPagesAnalyzed(batch.analyzedPages ?? 0);
          setScanProgress(websiteScanProgress(batch));
        },
      });
    } catch (reason) {
      setFailedPhase("CRAWL");
      throw reason;
    }

    const hints: WebsiteVisualHints = {
      ...scanBody.visualHints,
      colors: concreteColors(scanBody.visualHints.colors ?? []),
      socialLinks: scanBody.visualHints.socialLinks ?? {},
      logoUrl: scanBody.visualHints.logoUrl ?? null,
    };
    setVisualHints(hints);
    setPagesAnalyzed(scanBody.analyzedPages ?? 0);
    setScanProgress(websiteScanProgress({ ...scanBody, hasMore: false }));

    try {
      await analyzeBrandOnly(profileId, hints, scanBody.analyzedPages ?? 0);
    } catch (reason) {
      setFailedPhase("ANALYZE");
      throw reason;
    }
  }

  async function completeWithoutWebsite(profileId: string) {
    const token = await jwt();
    const response = await fetch("/api/onboarding-complete", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ profileId }),
    });
    if (!response.ok) throw new Error("Non sono riuscito a completare la configurazione.");
    await reload();
    clearNewActivityFlow();
    setNewActivityProfileId(null);
    if (requestedNewActivity) navigate("/onboarding", { replace: true });
    setStage("DONE");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError(null);
    let profileId: string | null = null;
    try {
      const created = await createProfile({ name, websiteUrl: website, industry });
      profileId = created.id;
      setCreatedProfileId(created.id);
      if (creatingAnother) {
        rememberNewActivityProfile(created.id);
        setNewActivityProfileId(created.id);
      }
      if (!website.trim()) {
        await completeWithoutWebsite(created.id);
        return;
      }
      await analyzeProfile(created.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Configurazione non riuscita.");
      setStage(profileId ? "ERROR" : "FORM");
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  async function retryAnalysis() {
    if (!createdProfileId) return;
    const profile = profiles.find((item) => item.id === createdProfileId);
    if (!profile) {
      setError("Non riesco a trovare l’attività salvata. Ricarica la pagina.");
      setStage("ERROR");
      return;
    }
    try {
      if (!profile.website_url?.trim()) {
        await completeWithoutWebsite(createdProfileId);
      } else if (failedPhase === "ANALYZE" && pagesAnalyzed > 0) {
        await analyzeBrandOnly(createdProfileId, visualHints, pagesAnalyzed);
      } else {
        await analyzeProfile(createdProfileId);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Analisi non riuscita.");
      setStage("ERROR");
    }
  }

  const pendingProfile = profiles.find((profile) => profile.id === createdProfileId) ?? incompleteProfile;
  const progressStage = stage === "ERROR" ? (failedPhase ?? (pagesAnalyzed > 0 ? "ANALYZE" : "CRAWL")) : stage;
  return <main className="onboarding-page"><section className="onboarding-card onboarding-card-wide">
    <div className="onboarding-progress">{steps.map((step, index) => {
      const currentIndex = steps.findIndex((item) => item.key === progressStage);
      const done = index < currentIndex || stage === "DONE";
      const active = step.key === progressStage && stage !== "DONE";
      return <div className={`onboarding-step ${done ? "done" : ""} ${active ? "active" : ""}`} key={step.key}><span>{done ? <Check size={14} /> : index + 1}</span><small>{step.label}</small></div>;
    })}</div>

    {stage === "FORM" && <div className="onboarding-copy"><span className="onboarding-icon"><Building2 size={22} /></span><h1>Crea il profilo della tua attività</h1><p>Dimmi l’essenziale. Se inserisci il sito, Post Automatici lo legge pagina per pagina e prepara automaticamente brand, tono, target, servizi e identità visiva.</p><form className="auth-form onboarding-form" onSubmit={submit}><label>Come si chiama l’attività?<input required autoFocus placeholder="Es. Il Tuo Property Manager" value={name} onChange={(event) => setName(event.target.value)} /></label><label>Sito web<input type="url" placeholder="https://iltuosito.it" value={website} onChange={(event) => setWebsite(event.target.value)} /></label><label>Settore <span className="optional-label">opzionale</span><input placeholder="Se lo lasci vuoto provo a capirlo dal sito" value={industry} onChange={(event) => setIndustry(event.target.value)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button onboarding-cta" type="submit" disabled={submitting}>{submitting ? "Creazione…" : "Continua"} <span>→</span></button>{requestedNewActivity && !newActivityProfileId && <button className="text-action" type="button" onClick={() => { clearNewActivityFlow(); navigate("/app/profili", { replace: true }); }}>Annulla e torna alle attività</button>}</form></div>}

    {stage === "CRAWL" && <div className="onboarding-loading"><span className="onboarding-icon"><Globe2 size={24} /></span><LoaderCircle className="spin" size={30} /><h1>Sto leggendo il sito</h1><p>Controllo sitemap e collegamenti interni, poi salvo ogni pagina trovata. Non mi fermo alla homepage.</p><div className="scan-progress-block" aria-live="polite"><div className="scan-progress-row"><strong>{scanProgress.percent}%</strong><span>{scanProgress.total > 0 ? `${scanProgress.processed} di ${scanProgress.total} pagine elaborate` : "Sto rilevando le pagine del sito…"}</span></div><div className="scan-progress-track" role="progressbar" aria-label="Avanzamento scansione sito" aria-valuemin={0} aria-valuemax={100} aria-valuenow={scanProgress.percent}><span style={{ width: `${scanProgress.percent}%` }} /></div></div></div>}

    {stage === "ANALYZE" && <div className="onboarding-loading"><span className="onboarding-icon"><Layers3 size={24} /></span><LoaderCircle className="spin" size={30} /><h1>Sto costruendo il brand</h1><p>{pagesAnalyzed > 0 ? `${pagesAnalyzed} pagine lette. ` : ""}Ora individuo tono, servizi, pubblico, messaggi ricorrenti, obiettivi e stile visivo osservato.</p><div className="scan-progress-block" aria-live="polite"><div className="scan-progress-row"><strong>{brandProgress}%</strong><span>{brandStatus}</span></div><div className="scan-progress-track" role="progressbar" aria-label="Avanzamento configurazione brand" aria-valuemin={0} aria-valuemax={100} aria-valuenow={brandProgress}><span style={{ width: `${brandProgress}%` }} /></div></div></div>}

    {stage === "ERROR" && <div className="onboarding-done onboarding-error"><span className="onboarding-icon"><RefreshCw size={22} /></span><h1>L’attività è salva</h1><p>La configurazione non è ancora completa. Riprendi dallo stesso profilo senza crearne un secondo.</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button onboarding-cta" type="button" onClick={() => void retryAnalysis()}><RefreshCw size={16} /> {pendingProfile?.website_url ? (progressStage === "ANALYZE" ? "Riprendi analisi brand" : "Riprendi analisi") : "Completa configurazione"}</button><button className="text-action" type="button" onClick={() => navigate("/app/brand", { replace: true })}>Apri il profilo e completa dopo</button></div>}

    {stage === "DONE" && <div className="onboarding-done"><span className="onboarding-icon success"><Check size={24} /></span><h1>Profilo pronto</h1><p>{pagesAnalyzed > 0 ? `Ho analizzato ${pagesAnalyzed} pagine e preparato una base di brand modificabile.` : "Profilo creato. Potrai aggiungere il sito in seguito."}</p>{analysis && <div className="onboarding-findings">{analysis.toneOfVoice?.traits?.slice(0, 4).map((item) => <span key={item}>{item}</span>)}{analysis.services?.slice(0, 4).map((item) => <span key={item}>{item}</span>)}{concreteColors(visualHints.colors ?? []).slice(0, 5).map((color) => <span className="color-finding" key={color} aria-label="Colore brand"><i style={{ background: color }} /></span>)}</div>}<button className="primary-button onboarding-cta" type="button" onClick={() => navigate("/app/dashboard", { replace: true })}>Apri la dashboard <span>→</span></button></div>}
  </section></main>;
}
