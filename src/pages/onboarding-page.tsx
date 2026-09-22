import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Check, Globe2, LoaderCircle, RefreshCw, Sparkles, WandSparkles } from "lucide-react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { authenticatedApiToken } from "../lib/auth-token";
import { useProfiles } from "../features/profiles/profile-context";

type VisualHints = { colors: string[]; socialLinks: Record<string, string>; logoUrl: string | null };
type ScanResponse = { visualHints?: VisualHints; analyzedPages?: number; discoveredPages?: number; error?: string; message?: string };
type AnalysisResponse = {
  pagesAnalyzed?: number;
  analysis?: {
    toneOfVoice?: { summary?: string; traits?: string[] };
    targetAudience?: { summary?: string; segments?: string[] };
    services?: string[];
    goals?: string[];
  };
  visualHints?: VisualHints;
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
  const creatingAnother = searchParams.get("new") === "1";
  const submitLock = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [stage, setStage] = useState<Stage>("FORM");
  const [error, setError] = useState<string | null>(null);
  const [createdProfileId, setCreatedProfileId] = useState<string | null>(null);
  const [pagesAnalyzed, setPagesAnalyzed] = useState(0);
  const [analysis, setAnalysis] = useState<AnalysisResponse["analysis"] | null>(null);
  const [visualHints, setVisualHints] = useState<VisualHints>({ colors: [], socialLinks: {}, logoUrl: null });
  const incompleteProfile = useMemo(() => profiles.find((profile) => !profile.onboarding_completed) ?? null, [profiles]);

  useEffect(() => {
    if (loading || creatingAnother || stage !== "FORM" || !incompleteProfile) return;
    setCreatedProfileId(incompleteProfile.id);
    setError("La configurazione di questa attività non è ancora completa. Riprendi da dove si era interrotta.");
    setStage("ERROR");
  }, [loading, creatingAnother, stage, incompleteProfile?.id]);

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

  async function analyzeProfile(profileId: string) {
    setError(null);
    const token = await jwt();
    setStage("CRAWL");
    const scanResponse = await fetch("/api/website-scan", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ profileId, pageLimit: 8 }),
    });
    const scanBody = await scanResponse.json() as ScanResponse;
    if (!scanResponse.ok) throw new Error(scanBody.message || "Non sono riuscito ad analizzare il sito. Riprova tra poco.");
    const hints = scanBody.visualHints ?? { colors: [], socialLinks: {}, logoUrl: null };
    setVisualHints({ ...hints, colors: concreteColors(hints.colors) });
    setPagesAnalyzed(scanBody.analyzedPages ?? 0);

    setStage("ANALYZE");
    const analysisResponse = await fetch("/api/onboarding-analyze", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ profileId, visualHints: hints }),
    });
    const analysisBody = await analysisResponse.json() as AnalysisResponse;
    if (!analysisResponse.ok) throw new Error("Analisi del brand non riuscita. Riprova tra poco.");
    setAnalysis(analysisBody.analysis ?? null);
    setPagesAnalyzed(analysisBody.pagesAnalyzed ?? scanBody.analyzedPages ?? 0);
    const analyzedHints = analysisBody.visualHints ?? hints;
    setVisualHints({ ...analyzedHints, colors: concreteColors(analyzedHints.colors) });
    await reload();
    setStage("DONE");
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
      // `?new=1` is an explicit one-shot intent. Remove it as soon as the new
      // workspace exists so a refresh/retry cannot reopen creation accidentally.
      if (creatingAnother) navigate("/onboarding", { replace: true });
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
      if (profile.website_url?.trim()) await analyzeProfile(createdProfileId);
      else await completeWithoutWebsite(createdProfileId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Analisi non riuscita.");
      setStage("ERROR");
    }
  }

  const pendingProfile = profiles.find((profile) => profile.id === createdProfileId) ?? incompleteProfile;
  const progressStage = stage === "ERROR" ? (pagesAnalyzed > 0 ? "ANALYZE" : "CRAWL") : stage;
  return <main className="onboarding-page"><section className="onboarding-card onboarding-card-wide">
    <div className="onboarding-progress">{steps.map((step, index) => {
      const currentIndex = steps.findIndex((item) => item.key === progressStage);
      const done = index < currentIndex || stage === "DONE";
      const active = step.key === progressStage && stage !== "DONE";
      return <div className={`onboarding-step ${done ? "done" : ""} ${active ? "active" : ""}`} key={step.key}><span>{done ? <Check size={14} /> : index + 1}</span><small>{step.label}</small></div>;
    })}</div>

    {stage === "FORM" && <div className="onboarding-copy"><span className="onboarding-icon"><WandSparkles size={22} /></span><h1>Crea il profilo della tua attività</h1><p>Dimmi l’essenziale. Se inserisci il sito, Post Automatici lo legge pagina per pagina e prepara automaticamente brand, tono, target, servizi e identità visiva.</p><form className="auth-form onboarding-form" onSubmit={submit}><label>Come si chiama l’attività?<input required autoFocus placeholder="Es. Il Tuo Property Manager" value={name} onChange={(event) => setName(event.target.value)} /></label><label>Sito web<input type="url" placeholder="https://iltuosito.it" value={website} onChange={(event) => setWebsite(event.target.value)} /></label><label>Settore <span className="optional-label">opzionale</span><input placeholder="Se lo lasci vuoto provo a capirlo dal sito" value={industry} onChange={(event) => setIndustry(event.target.value)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button onboarding-cta" type="submit" disabled={submitting}>{submitting ? "Creazione…" : "Continua"} <span>→</span></button></form></div>}

    {stage === "CRAWL" && <div className="onboarding-loading"><span className="onboarding-icon"><Globe2 size={24} /></span><LoaderCircle className="spin" size={30} /><h1>Sto leggendo il sito</h1><p>Controllo sitemap e collegamenti interni, poi salvo ogni pagina trovata. Non mi fermo alla homepage.</p><div className="analysis-pulse"><span /> <span /> <span /></div></div>}

    {stage === "ANALYZE" && <div className="onboarding-loading"><span className="onboarding-icon"><Sparkles size={24} /></span><LoaderCircle className="spin" size={30} /><h1>Sto costruendo il brand</h1><p>{pagesAnalyzed > 0 ? `${pagesAnalyzed} pagine lette. ` : ""}Ora individuo tono, servizi, pubblico, messaggi ricorrenti, obiettivi e stile visivo osservato.</p><div className="analysis-pulse"><span /> <span /> <span /></div></div>}

    {stage === "ERROR" && <div className="onboarding-done onboarding-error"><span className="onboarding-icon"><RefreshCw size={22} /></span><h1>L’attività è salva</h1><p>La configurazione non è ancora completa. Riprendi dallo stesso profilo senza crearne un secondo.</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button onboarding-cta" type="button" onClick={() => void retryAnalysis()}><RefreshCw size={16} /> {pendingProfile?.website_url ? "Riprendi analisi" : "Completa configurazione"}</button><button className="text-action" type="button" onClick={() => navigate("/app/brand", { replace: true })}>Apri il profilo e completa dopo</button></div>}

    {stage === "DONE" && <div className="onboarding-done"><span className="onboarding-icon success"><Check size={24} /></span><h1>Profilo pronto</h1><p>{pagesAnalyzed > 0 ? `Ho analizzato ${pagesAnalyzed} pagine e preparato una base di brand modificabile.` : "Profilo creato. Potrai aggiungere il sito in seguito."}</p>{analysis && <div className="onboarding-findings">{analysis.toneOfVoice?.traits?.slice(0, 4).map((item) => <span key={item}>{item}</span>)}{analysis.services?.slice(0, 4).map((item) => <span key={item}>{item}</span>)}{concreteColors(visualHints.colors).slice(0, 5).map((color) => <span className="color-finding" key={color} aria-label="Colore brand"><i style={{ background: color }} /></span>)}</div>}<button className="primary-button onboarding-cta" type="button" onClick={() => navigate("/app/dashboard", { replace: true })}>Apri la dashboard <span>→</span></button></div>}
  </section></main>;
}
