import { useMemo, useState, type FormEvent } from "react";
import { Check, Globe2, LoaderCircle, RefreshCw, Sparkles, WandSparkles } from "lucide-react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { authClient, neonClient } from "../lib/neon-client";
import { useProfiles } from "../features/profiles/profile-context";

type VisualHints = { colors: string[]; socialLinks: Record<string, string>; logoUrl: string | null };
type ScanResponse = { visualHints?: VisualHints; analyzedPages?: number; discoveredPages?: number; error?: string; detail?: string };
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

export function OnboardingPage() {
  const { profiles, loading, createProfile, reload } = useProfiles();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const creatingAnother = searchParams.get("new") === "1";
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [stage, setStage] = useState<Stage>("FORM");
  const [error, setError] = useState<string | null>(null);
  const [createdProfileId, setCreatedProfileId] = useState<string | null>(null);
  const [pagesAnalyzed, setPagesAnalyzed] = useState(0);
  const [analysis, setAnalysis] = useState<AnalysisResponse["analysis"] | null>(null);
  const [visualHints, setVisualHints] = useState<VisualHints>({ colors: [], socialLinks: {}, logoUrl: null });

  const steps = useMemo(() => [
    { key: "FORM", label: "Attività" },
    { key: "CRAWL", label: "Sito" },
    { key: "ANALYZE", label: "Brand" },
    { key: "DONE", label: "Pronto" },
  ] as const, []);

  if (loading) return <main className="center-state">Caricamento…</main>;
  if (profiles.length > 0 && !creatingAnother && stage === "FORM") return <Navigate to="/app/dashboard" replace />;

  async function jwt() {
    const token = await authClient.getJwtToken();
    if (!token) throw new Error("Sessione non valida. Accedi di nuovo.");
    return token;
  }

  async function analyzeProfile(profileId: string) {
    setError(null);
    const token = await jwt();
    setStage("CRAWL");
    const scanResponse = await fetch("/api/website-scan", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ profileId, pageLimit: 500 }),
    });
    const scanBody = await scanResponse.json() as ScanResponse;
    if (!scanResponse.ok) throw new Error(scanBody.detail || scanBody.error || "Non sono riuscito ad analizzare il sito.");
    const hints = scanBody.visualHints ?? { colors: [], socialLinks: {}, logoUrl: null };
    setVisualHints(hints);
    setPagesAnalyzed(scanBody.analyzedPages ?? 0);

    setStage("ANALYZE");
    const analysisResponse = await fetch("/api/onboarding-analyze", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ profileId, visualHints: hints }),
    });
    const analysisBody = await analysisResponse.json() as AnalysisResponse;
    if (!analysisResponse.ok) throw new Error(analysisBody.detail || analysisBody.error || "Analisi del brand non riuscita.");
    setAnalysis(analysisBody.analysis ?? null);
    setPagesAnalyzed(analysisBody.pagesAnalyzed ?? scanBody.analyzedPages ?? 0);
    setVisualHints(analysisBody.visualHints ?? hints);
    await reload();
    setStage("DONE");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    let profileId: string | null = null;
    try {
      const created = await createProfile({ name, websiteUrl: website, industry });
      profileId = created.id;
      setCreatedProfileId(created.id);
      if (!website.trim()) {
        const done = await neonClient.from("profiles").update({ onboarding_completed: true, updated_at: new Date().toISOString() }).eq("id", created.id).select("id");
        if (done.error) throw new Error(done.error.message);
        await reload();
        setStage("DONE");
        return;
      }
      await analyzeProfile(created.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Configurazione non riuscita.");
      setStage(profileId ? "ERROR" : "FORM");
    }
  }

  async function retryAnalysis() {
    if (!createdProfileId) return;
    try {
      await analyzeProfile(createdProfileId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Analisi non riuscita.");
      setStage("ERROR");
    }
  }

  const progressStage = stage === "ERROR" ? (pagesAnalyzed > 0 ? "ANALYZE" : "CRAWL") : stage;
  return <main className="onboarding-page"><section className="onboarding-card onboarding-card-wide">
    <div className="onboarding-progress">{steps.map((step, index) => {
      const currentIndex = steps.findIndex((item) => item.key === progressStage);
      const done = index < currentIndex || stage === "DONE";
      const active = step.key === progressStage && stage !== "DONE";
      return <div className={`onboarding-step ${done ? "done" : ""} ${active ? "active" : ""}`} key={step.key}><span>{done ? <Check size={14} /> : index + 1}</span><small>{step.label}</small></div>;
    })}</div>

    {stage === "FORM" && <div className="onboarding-copy"><span className="onboarding-icon"><WandSparkles size={22} /></span><h1>Crea il profilo della tua attività</h1><p>Dimmi l’essenziale. Se inserisci il sito, Post Automatici lo legge pagina per pagina e prepara automaticamente brand, tono, target, servizi e identità visiva.</p><form className="auth-form onboarding-form" onSubmit={submit}><label>Come si chiama l’attività?<input required autoFocus placeholder="Es. Il Tuo Property Manager" value={name} onChange={(event) => setName(event.target.value)} /></label><label>Sito web<input type="url" placeholder="https://iltuosito.it" value={website} onChange={(event) => setWebsite(event.target.value)} /></label><label>Settore <span className="optional-label">opzionale</span><input placeholder="Se lo lasci vuoto provo a capirlo dal sito" value={industry} onChange={(event) => setIndustry(event.target.value)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button onboarding-cta" type="submit">Continua <span>→</span></button></form></div>}

    {stage === "CRAWL" && <div className="onboarding-loading"><span className="onboarding-icon"><Globe2 size={24} /></span><LoaderCircle className="spin" size={30} /><h1>Sto leggendo il sito</h1><p>Controllo sitemap e collegamenti interni, poi salvo ogni pagina trovata. Non mi fermo alla homepage.</p><div className="analysis-pulse"><span /> <span /> <span /></div></div>}

    {stage === "ANALYZE" && <div className="onboarding-loading"><span className="onboarding-icon"><Sparkles size={24} /></span><LoaderCircle className="spin" size={30} /><h1>Sto costruendo il brand</h1><p>{pagesAnalyzed > 0 ? `${pagesAnalyzed} pagine lette. ` : ""}Ora individuo tono, servizi, pubblico, messaggi ricorrenti, obiettivi e stile visivo osservato.</p><div className="analysis-pulse"><span /> <span /> <span /></div></div>}

    {stage === "ERROR" && <div className="onboarding-done onboarding-error"><span className="onboarding-icon"><RefreshCw size={22} /></span><h1>L’attività è salva</h1><p>L’analisi automatica si è interrotta, ma non creo un secondo profilo. Puoi riprovare dallo stesso punto.</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button onboarding-cta" type="button" onClick={() => void retryAnalysis()}><RefreshCw size={16} /> Riprova analisi</button><button className="text-action" type="button" onClick={() => navigate("/app/brand", { replace: true })}>Apri il profilo e completa dopo</button></div>}

    {stage === "DONE" && <div className="onboarding-done"><span className="onboarding-icon success"><Check size={24} /></span><h1>Profilo pronto</h1><p>{pagesAnalyzed > 0 ? `Ho analizzato ${pagesAnalyzed} pagine e preparato una base di brand modificabile.` : "Profilo creato. Potrai aggiungere il sito in seguito."}</p>{analysis && <div className="onboarding-findings">{analysis.toneOfVoice?.traits?.slice(0, 4).map((item) => <span key={item}>{item}</span>)}{analysis.services?.slice(0, 4).map((item) => <span key={item}>{item}</span>)}{visualHints.colors.slice(0, 5).map((color) => <span className="color-finding" key={color}><i style={{ background: color }} />{color}</span>)}</div>}<button className="primary-button onboarding-cta" type="button" onClick={() => navigate("/app/dashboard", { replace: true })}>Apri la dashboard <span>→</span></button></div>}
  </section></main>;
}
