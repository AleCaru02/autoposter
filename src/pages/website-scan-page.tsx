import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Globe2, ImageIcon, Palette, RefreshCw, Tags, Type } from "lucide-react";
import { NavLink } from "react-router-dom";
import { neonClient } from "../lib/neon-client";
import { authenticatedApiToken } from "../lib/auth-token";
import { runFullWebsiteScan } from "../lib/full-website-scan";
import { websiteScanProgress, websiteScanUiState } from "../lib/website-scan-state";
import { siteIntelligenceView, type SiteIntelligenceView } from "../lib/site-intelligence-view";
import { useProfiles } from "../features/profiles/profile-context";

type Scan = {
  id: string;
  state: string;
  root_url: string;
  discovered_pages: number;
  analyzed_pages: number;
  skipped_pages: number;
  failed_pages: number;
  page_limit: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

type ScanPage = {
  id: string;
  url: string;
  status: string;
  depth: number;
  title: string | null;
  skip_reason: string | null;
  error: string | null;
};

type BrandRow = {
  visual_identity: unknown;
  social_links: unknown;
  services: unknown;
  tone_of_voice: unknown;
  target_audience: unknown;
  differentiators: unknown;
};

type StoredVisualHints = {
  colors: string[];
  fontFamilies: string[];
  socialLinks: Record<string, string>;
  logoUrl: string | null;
  logoCandidates: string[];
  imageUrls: string[];
  stylesheetUrls: string[];
  pageSignals: unknown[];
};

type AnalysisResponse = { error?: string; detail?: string };

const EMPTY_INTELLIGENCE: SiteIntelligenceView = {
  colors: [], fonts: [], logoUrl: null, pillars: [], pageInsightCount: 0,
  services: [], toneTraits: [], targetSummary: null, differentiators: [],
};

function readableApiError(body: { error?: string; detail?: string; message?: string }, fallback: string) {
  const value = body.detail || body.error;
  if (value === "OPENAI_NOT_CONFIGURED") return "L’analisi AI non è disponibile in questo momento. Riprova più tardi.";
  if (value === "PROFILE_NOT_FOUND") return "Attività non trovata per questo account.";
  if (value === "AUTH_REQUIRED") return "Sessione scaduta. Accedi di nuovo.";
  if (["CAPABILITY_DISABLED", "CAPABILITY_LIMIT_REACHED", "PROVIDER_COST_BUDGET_REACHED"].includes(value || "")) return "L’analisi non è disponibile per questa attività in questo momento.";
  return fallback;
}

function storedVisualHints(row: BrandRow | null): StoredVisualHints {
  const visual = row?.visual_identity && typeof row.visual_identity === "object" ? row.visual_identity as Record<string, unknown> : {};
  const socials = row?.social_links && typeof row.social_links === "object" ? row.social_links as Record<string, unknown> : {};
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return {
    colors: strings(visual.observedColors),
    fontFamilies: strings(visual.observedFonts),
    socialLinks: Object.fromEntries(Object.entries(socials).filter((entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1]))),
    logoUrl: typeof visual.logoUrl === "string" ? visual.logoUrl : null,
    logoCandidates: strings(visual.logoCandidates),
    imageUrls: strings(visual.observedImages),
    stylesheetUrls: strings(visual.stylesheets),
    pageSignals: Array.isArray(visual.pageSignals) ? visual.pageSignals : [],
  };
}

function brandAnalysisTimestamp(row: BrandRow | null) {
  const visual = row?.visual_identity && typeof row.visual_identity === "object" ? row.visual_identity as Record<string, unknown> : {};
  return typeof visual.analyzedAt === "string" && visual.analyzedAt.trim() ? visual.analyzedAt : null;
}

function brandNeedsAnalysis(scan: Scan | null, analyzedAt: string | null) {
  if (!scan || !["COMPLETE", "COMPLETE_WITH_WARNINGS"].includes(scan.state)) return false;
  const scanTime = Date.parse(scan.finished_at || scan.created_at);
  const brandTime = analyzedAt ? Date.parse(analyzedAt) : Number.NaN;
  if (!Number.isFinite(scanTime)) return !analyzedAt;
  return !Number.isFinite(brandTime) || brandTime < scanTime;
}

async function requestBrandAnalysis(profileId: string, visualHints: Partial<StoredVisualHints>, signal?: AbortSignal) {
  let lastBody: AnalysisResponse = {};
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await authenticatedApiToken();
    const response = await fetch("/api/onboarding-analyze", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ profileId, visualHints }),
      signal,
    });
    const body = await response.json().catch(() => ({})) as AnalysisResponse;
    lastBody = body;
    if (response.ok) return body;
    if (attempt === 0 && (response.status === 401 || body.error === "AUTH_REQUIRED")) continue;
    throw new Error(readableApiError(body, "Analisi brand non riuscita."));
  }
  throw new Error(readableApiError(lastBody, "Analisi brand non riuscita."));
}

function isBrandRetryableError(error: string | null) {
  if (!error) return false;
  return error === "Analisi brand non riuscita."
    || error.startsWith("L’analisi AI")
    || error.startsWith("L’analisi non è disponibile")
    || error.startsWith("Sessione scaduta")
    || error.startsWith("Sessione non valida");
}

function IntelligencePanel({ intelligence, demo = false }: { intelligence: SiteIntelligenceView; demo?: boolean }) {
  const hasData = intelligence.colors.length || intelligence.fonts.length || intelligence.logoUrl || intelligence.pillars.length || intelligence.services.length || intelligence.toneTraits.length || intelligence.targetSummary || intelligence.differentiators.length;
  if (!hasData) return <section className="panel empty-panel"><Tags size={24} /><h2>Analisi del sito non ancora disponibile</h2><p>Dopo una scansione completata, qui trovi i dati realmente osservati e analizzati per questa attività.</p></section>;
  return <section className="panel"><div className="panel-heading"><div><h2>Cosa ho imparato dal sito</h2><p>{demo ? "Dati dimostrativi · SAMPLE DATA. Nessun sito reale è stato analizzato." : "Dati osservati e analizzati per questa attività. Non vengono mostrati valori demo."}</p></div>{intelligence.pageInsightCount > 0 && <span>{intelligence.pageInsightCount} pagine interpretate</span>}</div>
    <div className="site-intelligence-grid">
      {(Boolean(intelligence.logoUrl) || intelligence.colors.length > 0) && <article className="site-intelligence-card"><div className="site-intelligence-title"><Palette size={17} /><strong>Identità visiva osservata</strong></div>{intelligence.logoUrl && <div className="site-logo-preview"><img src={intelligence.logoUrl} alt="Logo rilevato dal sito" loading="lazy" /></div>}{intelligence.colors.length > 0 && <div className="site-color-list">{intelligence.colors.map((color) => <span className="site-color-chip" key={color}><i style={{ background: color }} />{color}</span>)}</div>}</article>}
      {intelligence.fonts.length > 0 && <article className="site-intelligence-card"><div className="site-intelligence-title"><Type size={17} /><strong>Font osservati</strong></div><div className="site-tag-list">{intelligence.fonts.map((font) => <span key={font}>{font}</span>)}</div></article>}
      {intelligence.pillars.length > 0 && <article className="site-intelligence-card site-intelligence-wide"><div className="site-intelligence-title"><Tags size={17} /><strong>Argomenti e pilastri editoriali</strong></div><div className="site-pillar-list">{intelligence.pillars.map((pillar) => <div key={pillar.name}><strong>{pillar.name}</strong>{pillar.description && <p>{pillar.description}</p>}</div>)}</div></article>}
      {intelligence.services.length > 0 && <article className="site-intelligence-card"><div className="site-intelligence-title"><Globe2 size={17} /><strong>Servizi rilevati</strong></div><div className="site-tag-list">{intelligence.services.map((service) => <span key={service}>{service}</span>)}</div></article>}
      {(intelligence.toneTraits.length > 0 || intelligence.targetSummary) && <article className="site-intelligence-card"><div className="site-intelligence-title"><ImageIcon size={17} /><strong>Voce e pubblico</strong></div>{intelligence.targetSummary && <p>{intelligence.targetSummary}</p>}{intelligence.toneTraits.length > 0 && <div className="site-tag-list">{intelligence.toneTraits.map((trait) => <span key={trait}>{trait}</span>)}</div>}</article>}
      {intelligence.differentiators.length > 0 && <article className="site-intelligence-card site-intelligence-wide"><div className="site-intelligence-title"><Tags size={17} /><strong>Elementi distintivi rilevati</strong></div><div className="site-tag-list">{intelligence.differentiators.map((item) => <span key={item}>{item}</span>)}</div></article>}
    </div>
  </section>;
}

export function WebsiteScanPage() {
  const { selectedProfile, reload } = useProfiles();
  const [scan, setScan] = useState<Scan | null>(null);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [intelligence, setIntelligence] = useState<SiteIntelligenceView>(EMPTY_INTELLIGENCE);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [brandRetrying, setBrandRetrying] = useState(false);
  const [brandVisualHints, setBrandVisualHints] = useState<StoredVisualHints>(() => storedVisualHints(null));
  const [brandAnalyzedAt, setBrandAnalyzedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const runnerInFlightRef = useRef(false);
  const pollInFlightRef = useRef(false);
  const scanAbortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (background = false) => {
    const profileId = selectedProfile?.id;
    if (!profileId) return null;
    if (!background) { setLoading(true); setError(null); }
    const [scanResult, brandResult] = await Promise.all([
      neonClient.from("website_scans").select("id,state,root_url,discovered_pages,analyzed_pages,skipped_pages,failed_pages,page_limit,error,created_at,finished_at").eq("profile_id", profileId).order("created_at", { ascending: false }).limit(1),
      neonClient.from("brand_profiles").select("visual_identity,social_links,services,tone_of_voice,target_audience,differentiators").eq("profile_id", profileId).limit(1),
    ]);
    if (scanResult.error || brandResult.error) {
      if (!background) setLoading(false);
      setError("Impossibile caricare l’analisi del sito. Riprova.");
      return null;
    }
    const brandRow = (brandResult.data?.[0] ?? null) as BrandRow | null;
    setIntelligence(siteIntelligenceView(brandRow));
    setBrandVisualHints(storedVisualHints(brandRow));
    setBrandAnalyzedAt(brandAnalysisTimestamp(brandRow));
    const latest = (scanResult.data?.[0] ?? null) as Scan | null;
    setScan(latest);
    if (!latest) { setPages([]); if (!background) setLoading(false); return null; }
    const pageResult = await neonClient.from("website_pages").select("id,url,status,depth,title,skip_reason,error").eq("profile_id", profileId).eq("scan_id", latest.id).order("depth", { ascending: true }).order("url", { ascending: true });
    if (!background) setLoading(false);
    if (pageResult.error) { setError("Impossibile caricare l’analisi del sito. Riprova."); return latest; }
    setPages((pageResult.data ?? []) as ScanPage[]);
    return latest;
  }, [selectedProfile?.id]);

  const pollScan = useCallback(async () => {
    const profileId = selectedProfile?.id;
    if (!profileId || pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    try {
      const result = await neonClient.from("website_scans").select("id,state,root_url,discovered_pages,analyzed_pages,skipped_pages,failed_pages,page_limit,error,created_at,finished_at").eq("profile_id", profileId).order("created_at", { ascending: false }).limit(1);
      if (!result.error && result.data?.[0]) setScan(result.data[0] as Scan);
    } finally {
      pollInFlightRef.current = false;
    }
  }, [selectedProfile?.id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => () => {
    scanAbortRef.current?.abort();
    scanAbortRef.current = null;
    runnerInFlightRef.current = false;
  }, [selectedProfile?.id]);

  async function retryBrandAnalysis() {
    if (!selectedProfile?.id || brandRetrying || selectedProfile.tenant_type === "DEMO_PERSISTENT") return;
    setBrandRetrying(true);
    setError(null);
    try {
      await requestBrandAnalysis(selectedProfile.id, brandVisualHints);
      await reload();
      await load(true);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Analisi brand non riuscita.");
    } finally {
      setBrandRetrying(false);
    }
  }

  async function startScan(automatic = false) {
    if (!selectedProfile?.id || !selectedProfile.website_url || selectedProfile.tenant_type === "DEMO_PERSISTENT" || runnerInFlightRef.current) return;
    runnerInFlightRef.current = true;
    setRunning(true);
    setError(null);
    const controller = new AbortController();
    scanAbortRef.current = controller;
    try {
      const body = await runFullWebsiteScan({
        profileId: selectedProfile.id,
        getToken: authenticatedApiToken,
        forceNew: !automatic,
        signal: controller.signal,
        onProgress: (batch) => {
          setScan((current) => ({
            id: batch.scanId ?? current?.id ?? "running",
            state: batch.hasMore ? "PARTIAL" : (batch.state ?? current?.state ?? "RUNNING"),
            root_url: current?.root_url ?? selectedProfile.website_url ?? "",
            discovered_pages: batch.discoveredPages ?? current?.discovered_pages ?? 0,
            analyzed_pages: batch.analyzedPages ?? current?.analyzed_pages ?? 0,
            skipped_pages: batch.skippedPages ?? current?.skipped_pages ?? 0,
            failed_pages: batch.failedPages ?? current?.failed_pages ?? 0,
            page_limit: current?.page_limit ?? 4,
            error: batch.hasMore ? "BATCH_PENDING" : (batch.failedPages ?? 0) > 0 ? "PAGE_ERRORS" : null,
            created_at: current?.created_at ?? new Date().toISOString(),
            finished_at: batch.hasMore ? null : current?.finished_at ?? new Date().toISOString(),
          }));
        },
      });

      if (controller.signal.aborted) return;
      await requestBrandAnalysis(selectedProfile.id, body.visualHints, controller.signal);

      await reload();
      await load(true);
    } catch (reason) {
      if (controller.signal.aborted || (reason instanceof DOMException && reason.name === "AbortError")) return;
      setError(reason instanceof Error ? reason.message : "Scansione non riuscita.");
      await load(true);
    } finally {
      if (scanAbortRef.current === controller) scanAbortRef.current = null;
      runnerInFlightRef.current = false;
      setRunning(false);
    }
  }

  const scanUiState = websiteScanUiState(scan);
  const progress = websiteScanProgress(scan);

  useEffect(() => {
    if (!selectedProfile?.id || !selectedProfile.website_url || selectedProfile.tenant_type === "DEMO_PERSISTENT" || loading || runnerInFlightRef.current) return;
    if (!scan || scanUiState === "IN_PROGRESS") void startScan(true);
  }, [selectedProfile?.id, selectedProfile?.website_url, selectedProfile?.tenant_type, loading, scan?.id, scan?.state, scan?.error, scanUiState]);

  useEffect(() => {
    if (!selectedProfile?.id || selectedProfile.tenant_type === "DEMO_PERSISTENT" || scanUiState !== "IN_PROGRESS") return;
    const interval = window.setInterval(() => { void pollScan(); }, 2500);
    return () => window.clearInterval(interval);
  }, [selectedProfile?.id, selectedProfile?.tenant_type, scanUiState, pollScan]);

  if (!selectedProfile) return null;
  const isDemo = selectedProfile.tenant_type === "DEMO_PERSISTENT";
  const brandAnalysisPending = !isDemo && brandNeedsAnalysis(scan, brandAnalyzedAt);
  const analysisCoverage = scan?.discovered_pages ? Math.round((scan.analyzed_pages / scan.discovered_pages) * 100) : 0;
  const stateLabel = scanUiState === "COMPLETED" ? "Completata"
    : scanUiState === "COMPLETED_WITH_WARNINGS" ? "Completata con avvisi"
      : scanUiState === "FAILED" ? "Errore"
        : "In corso";
  const stateClass = scanUiState === "COMPLETED" ? "status-ok" : scanUiState === "FAILED" ? "status-error" : "status-wait";

  return <div className="page-content"><header className="page-header"><div><p className="eyebrow">Sito · {selectedProfile.name}</p><h1>Analisi pagina per pagina</h1><p>{isDemo ? "Dati dimostrativi · SAMPLE DATA. Nessuna scansione esterna reale." : "L’analisi continua automaticamente a batch sicuri finché tutte le pagine rilevate sono state controllate."}</p></div>{scan && !isDemo && <button className="secondary-button" type="button" disabled={running} onClick={() => void startScan(false)}><RefreshCw size={16} className={running ? "spin" : ""} /> {running ? "Analisi in corso…" : scanUiState === "FAILED" ? "Riprova analisi" : "Ripeti analisi"}</button>}</header>
    {error && scanUiState !== "IN_PROGRESS" && <div className="form-error" role="alert"><span>{error}</span>{isBrandRetryableError(error) && !isDemo && <button className="text-action" type="button" disabled={brandRetrying} onClick={() => void retryBrandAnalysis()}><RefreshCw size={14} className={brandRetrying ? "spin" : ""} /> {brandRetrying ? "Analisi brand in corso…" : "Riprova solo analisi brand"}</button>}</div>}
    {!error && brandAnalysisPending && scanUiState !== "IN_PROGRESS" && <div className="coverage-warning" role="status"><AlertTriangle size={16} /><span><strong>Analisi brand da completare.</strong> La scansione del sito è salvata; non serve analizzare di nuovo le pagine.</span><button className="text-action" type="button" disabled={brandRetrying} onClick={() => void retryBrandAnalysis()}><RefreshCw size={14} className={brandRetrying ? "spin" : ""} /> {brandRetrying ? "Analisi brand in corso…" : "Completa analisi brand"}</button></div>}
    {!selectedProfile.website_url ? <section className="unavailable-panel"><Globe2 size={24} /><div><h2>Sito non configurato</h2><p>Inserisci il sito dell’attività: l’analisi partirà automaticamente.</p><NavLink className="text-link" to="/app/brand">Apri Brand</NavLink></div></section>
      : loading || running && !scan ? <section className="panel" role="status" aria-live="polite"><Globe2 size={22} /><h2>Sto analizzando il sito</h2><p>Controllo le pagine e i collegamenti interni senza fermarmi alla homepage.</p></section>
        : !scan ? <section className="panel empty-panel"><Globe2 size={26} /><h2>Analisi non ancora disponibile</h2><p>L’analisi parte automaticamente dal sito configurato.</p></section>
          : <>
            <section className="scan-summary"><article><span>Stato</span><strong className={stateClass}>{stateLabel}</strong></article><article><span>Pagine rilevate</span><strong>{scan.discovered_pages}</strong></article><article><span>Analizzate</span><strong>{scan.analyzed_pages}</strong></article><article><span>Saltate</span><strong>{scan.skipped_pages}</strong></article><article><span>Errori pagina</span><strong>{scan.failed_pages}</strong></article><article><span>Copertura analizzata</span><strong>{analysisCoverage}%</strong></article></section>

            {scanUiState === "IN_PROGRESS" && <section className="scan-progress-panel" role="status" aria-live="polite"><div className="scan-progress-heading"><div><Globe2 size={20} /><div><h2>Analisi del sito in corso</h2><p>Sto continuando ad analizzare le pagine del sito.</p></div></div><strong>{progress.percent}% completato</strong></div><div className="scan-progress-copy"><span>{scan.analyzed_pages} / {scan.discovered_pages} pagine analizzate</span>{progress.remaining > 0 && <span>{progress.remaining} ancora da processare</span>}</div><div className="scan-progress-track" role="progressbar" aria-label="Avanzamento analisi sito" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><span style={{ width: `${progress.percent}%` }} /></div></section>}

            {scanUiState === "COMPLETED_WITH_WARNINGS" && <p className="coverage-warning"><AlertTriangle size={16} /><span><strong>Analisi completata con alcune pagine non accessibili.</strong> {scan.failed_pages > 0 ? `${scan.failed_pages} pagine non sono state analizzate correttamente.` : "La parte disponibile del sito è stata elaborata."}</span></p>}
            {scanUiState === "FAILED" && <p className="form-error scan-failure" role="alert"><AlertTriangle size={16} /> La scansione si è interrotta per un errore reale. Premi “Riprova analisi”.</p>}
            {scanUiState === "COMPLETED" && <p className="scan-complete"><CheckCircle2 size={16} /> Analisi completata.</p>}

            <IntelligencePanel intelligence={intelligence} demo={isDemo} />
            <section className="panel"><div className="panel-heading"><div><h2>Pagine rilevate</h2><p>{scan.root_url}</p></div><span>{pages.length} pagine</span></div><div className="scan-pages">{pages.map((page) => <article className="scan-page-row" key={page.id}><div className={`scan-dot ${page.status.toLowerCase()}`} /><div className="scan-page-copy"><strong>{page.title || new URL(page.url).pathname || "/"}</strong><a href={page.url} target="_blank" rel="noreferrer">{page.url} <ExternalLink size={12} /></a>{(page.skip_reason || page.error) && <small>{page.skip_reason || page.error}</small>}</div><div className="scan-page-meta"><span>{page.status === "ANALYZED" ? "Analizzata" : page.status === "SKIPPED" ? "Saltata" : page.status === "FAILED" ? "Errore" : "In coda"}</span><small>livello {page.depth}</small></div></article>)}</div></section>
          </>}
  </div>;
}
