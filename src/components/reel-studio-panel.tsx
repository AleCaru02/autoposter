import { useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard, LoaderCircle, RefreshCcw, TriangleAlert } from "lucide-react";
import { NavLink } from "react-router-dom";
import { authenticatedApiToken } from "../lib/auth-token";
import { neonClient } from "../lib/neon-client";
import "../reel-studio.css";

type RenderJobView = {
  id: string;
  state: "QUEUED" | "RUNNING" | "READY_FOR_REVIEW" | "FAILED" | "BLOCKED" | "CANCELED";
  step: string;
  steps_completed: number;
  steps_total: number;
  last_error_code: string | null;
  cost_usd: number;
  created_at: string;
  title: string | null;
  hook: string | null;
  video_url: string | null;
  cover_url: string | null;
  duration_seconds: number | null;
  output_workflow_status: string | null;
  output_qa_status: string | null;
  dry_run?: boolean;
};
type SourceVariant = { id: string; provider: string; format: string; hook: string | null; created_at: string };
type Engine = { ready: boolean; missing: string[]; dryRunAvailable?: boolean };

const STEP_LABEL: Record<string, string> = { SCRIPT: "Script", VISUALS: "Immagini delle scene", VOICE: "Voce", RENDER: "Montaggio video", QA: "Controllo qualità", DONE: "Completato" };
const STATE_LABEL: Record<RenderJobView["state"], string> = { QUEUED: "In coda", RUNNING: "In lavorazione", READY_FOR_REVIEW: "Pronto per la revisione", FAILED: "Non riuscito", BLOCKED: "Bloccato dal budget", CANCELED: "Annullato" };
const MISSING_LABEL: Record<string, string> = {
  REEL_ENGINE_ENABLED: "attivazione del motore Reel (REEL_ENGINE_ENABLED)",
  DATABASE_URL: "database",
  OPENAI_API_KEY: "chiave OpenAI",
  BLOB_READ_WRITE_TOKEN: "archivio video (Vercel Blob)",
};

function errorMessage(code: string | null) {
  if (!code) return "Errore non specificato.";
  if (code.startsWith("AI_BUDGET") || code.includes("BUDGET")) return "Budget AI dell'attività esaurito: aumenta il limite o attendi il mese successivo.";
  if (code.startsWith("CAPABILITY_")) return "Limite mensile Reel raggiunto per questa attività.";
  if (code === "REEL_SCRIPT_REJECTED") return "Lo script conteneva dati non presenti nel contenuto originale ed è stato scartato. Nessun video prodotto.";
  if (code === "REEL_TECHNICAL_QA_FAILED") return "Il video non ha superato il controllo tecnico (formato, audio o durata).";
  if (code.startsWith("OPENAI_")) return "OpenAI non ha risposto correttamente. Il sistema riprova automaticamente.";
  return `Errore tecnico (${code}).`;
}

async function api(path: string, init?: RequestInit) {
  const token = await authenticatedApiToken();
  const response = await fetch(path, { ...init, headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, body };
}

export function ReelStudioPanel({ profileId }: { profileId: string }) {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [jobs, setJobs] = useState<RenderJobView[]>([]);
  const [sources, setSources] = useState<SourceVariant[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentProfile = useRef(profileId);
  currentProfile.current = profileId;

  const refresh = useCallback(async () => {
    const requested = profileId;
    const result = await api(`/api/render/status?profileId=${encodeURIComponent(requested)}`);
    if (currentProfile.current !== requested) return;
    if (!result.ok) { setEngine({ ready: false, missing: [] }); return; }
    setEngine(result.body.engine as Engine);
    setJobs((result.body.jobs as RenderJobView[]) ?? []);
  }, [profileId]);

  useEffect(() => {
    setJobs([]); setEngine(null); setSourceId(""); setError(null);
    void refresh().catch(() => setEngine({ ready: false, missing: [] }));
    void neonClient.from("content_variants").select("id,provider,format,hook,created_at").eq("profile_id", profileId).in("format", ["POST", "STORY", "CAROUSEL"]).order("created_at", { ascending: false }).limit(20)
      .then((result) => { if (currentProfile.current === profileId && !result.error) setSources((result.data ?? []) as SourceVariant[]); });
  }, [profileId, refresh]);

  const active = jobs.some((job) => job.state === "QUEUED" || job.state === "RUNNING");
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 6000);
    return () => window.clearInterval(timer);
  }, [active, refresh]);

  async function createReel(dryRun = false) {
    if (!sourceId) return;
    setBusy(true); setError(null);
    try {
      const result = await api("/api/render/enqueue", { method: "POST", body: JSON.stringify({ profileId, sourceVariantId: sourceId, requestId: crypto.randomUUID(), dryRun }) });
      if (!result.ok) {
        const code = String(result.body.error ?? "");
        setError(code === "REEL_QUEUE_FULL" ? "Ci sono già 3 Reel in lavorazione per questa attività." : code === "REEL_SOURCE_NOT_ELIGIBLE" ? "Il contenuto scelto non ha un testo sufficiente per un Reel." : code === "REEL_ENGINE_NOT_CONFIGURED" ? "Il motore Reel non è ancora configurato." : "Avvio del Reel non riuscito. Riprova.");
      }
      await refresh();
    } catch {
      setError("Avvio del Reel non riuscito. Controlla la connessione e riprova.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel reel-studio" aria-labelledby="reel-studio-title">
    <header className="reel-studio-header">
      <Clapperboard size={22} aria-hidden="true" />
      <div>
        <p className="eyebrow">Reel · video 9:16</p>
        <h2 id="reel-studio-title">Trasforma un contenuto in Reel</h2>
        <p>Script, immagini, voce italiana, sottotitoli e montaggio nel cloud. Il Reel arriva in Revisioni: niente viene pubblicato senza la tua approvazione.</p>
      </div>
    </header>

    {engine && !engine.ready && <div className="reel-config-state" role="status">
      <TriangleAlert size={16} aria-hidden="true" />
      <span>Da configurare{engine.missing.length ? `: ${engine.missing.map((key) => MISSING_LABEL[key] ?? key).join(", ")}` : ""}. Puoi preparare i contenuti, ma la generazione video è disattivata.</span>
    </div>}

    <div className="reel-create-row">
      <label>Contenuto di partenza
        <select value={sourceId} onChange={(event) => setSourceId(event.target.value)} disabled={!engine?.ready || busy}>
          <option value="">Scegli un contenuto…</option>
          {sources.map((source) => <option key={source.id} value={source.id}>{source.provider} · {source.format} · {(source.hook ?? "Senza hook").slice(0, 70)}</option>)}
        </select>
      </label>
      <button className="primary-button" type="button" onClick={() => void createReel()} disabled={!engine?.ready || !sourceId || busy}>
        {busy ? <LoaderCircle className="spin" size={16} /> : <Clapperboard size={16} />} Crea Reel
      </button>
    </div>
    {engine?.dryRunAvailable && <button className="secondary-button reel-dry-run" type="button" onClick={() => void createReel(true)} disabled={!sourceId || busy}>Prova a secco senza AI (solo ambiente di test, costo 0)</button>}
    <p className="field-help">Costo stimato: circa 1,3–1,6 $ per Reel (immagini, voce, script), conteggiato nel budget AI dell'attività.</p>
    {error && <p className="form-error" role="alert">{error}</p>}

    <div className="reel-job-list">
      <div className="reel-job-list-head"><h3>Ultimi Reel</h3><button className="text-button" type="button" onClick={() => void refresh()}><RefreshCcw size={13} /> Aggiorna</button></div>
      {!jobs.length && <p className="field-help">Nessun Reel ancora creato per questa attività.</p>}
      {jobs.map((job) => <article className={`reel-job reel-job-${job.state.toLowerCase()}`} key={job.id}>
        <header>
          <strong>{job.dry_run ? "Prova a secco · " : ""}{job.title || job.hook || "Reel"}</strong>
          <span className="reel-job-state">{STATE_LABEL[job.state]}</span>
        </header>
        {(job.state === "QUEUED" || job.state === "RUNNING") && <div className="reel-progress" role="progressbar" aria-valuemin={0} aria-valuemax={job.steps_total} aria-valuenow={job.steps_completed} aria-label="Avanzamento Reel">
          <div className="reel-progress-bar"><span style={{ width: `${(job.steps_completed / job.steps_total) * 100}%` }} /></div>
          <small>Step {Math.min(job.steps_completed + 1, job.steps_total)} di {job.steps_total} · {STEP_LABEL[job.step] ?? job.step}</small>
        </div>}
        {(job.state === "FAILED" || job.state === "BLOCKED") && <p className="manual-warning">{errorMessage(job.last_error_code)}</p>}
        {job.video_url && <video className="reel-player" src={job.video_url} poster={job.cover_url ?? undefined} controls playsInline preload="metadata" />}
        <footer>
          <small>{new Date(job.created_at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}{job.duration_seconds ? ` · ${job.duration_seconds.toFixed(1)} s` : ""} · costo {job.cost_usd.toFixed(2)} $</small>
          {job.state === "READY_FOR_REVIEW" && <NavLink className="secondary-button" to="/app/approvazioni">Rivedi e approva</NavLink>}
        </footer>
      </article>)}
    </div>
  </section>;
}
