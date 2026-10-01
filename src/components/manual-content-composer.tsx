import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, LoaderCircle, Sparkles } from "lucide-react";
import { NavLink } from "react-router-dom";
import type { EditorialResearchMode } from "../../api/_lib/editorial-research";
import type { GeneratedSocialContent, GeneratedVariant, SocialFormat, SocialProvider } from "../../api/_lib/openai-text";
import { saveGeneratedContent } from "../features/content/content-store";
import {
  ManualGenerationError,
  friendlyGenerationError,
  manualGenerationFingerprint,
  requestManualContent,
  requestManualContentStatus,
  type ManualEditorialContext,
  type ManualGenerationProgressStage,
  type ManualGenerationRequest,
  type ManualGenerationResult,
} from "../features/content/manual-content-generation";
import { loadPersonalBrandSources, type PersonalBrandSourceRow } from "../features/profiles/personal-brand-source-store";
import type { Profile, ProfileType } from "../features/profiles/profile-context";
import { authenticatedApiToken } from "../lib/auth-token";

type ComposerStatus = "IDLE" | "GENERATING" | "READY" | "SAVING" | "SAVED";
type PendingOperation = { fingerprint: string; id: string; request: ManualGenerationRequest };
type GenerationProgress = { percent: number; stage: ManualGenerationProgressStage };
type PersistedComposerState = {
  version: 1;
  topic: string;
  objective: string;
  providers: SocialProvider[];
  format: SocialFormat;
  sourceKey: string;
  content: GeneratedSocialContent | null;
  editorialContext: ManualEditorialContext | null;
  status: ComposerStatus;
  operation: PendingOperation | null;
  progress: GenerationProgress;
};

const PROVIDERS: Array<{ value: SocialProvider; label: string }> = [
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "FACEBOOK", label: "Facebook" },
  { value: "LINKEDIN", label: "LinkedIn" },
  { value: "GBP", label: "Google Business Profile" },
];

const VALID_PROVIDER_VALUES = new Set<SocialProvider>(PROVIDERS.map((item) => item.value));
const VALID_FORMATS = new Set<SocialFormat>(["POST", "STORY", "CAROUSEL"]);

function storageKey(profileId: string) {
  return `post-automatici:manual-composer:${profileId}`;
}

function readPersistedState(profileId: string): PersistedComposerState | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey(profileId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PersistedComposerState>;
    if (value.version !== 1) return null;
    const providers = Array.isArray(value.providers)
      ? value.providers.filter((provider): provider is SocialProvider => typeof provider === "string" && VALID_PROVIDER_VALUES.has(provider as SocialProvider))
      : [];
    const format = typeof value.format === "string" && VALID_FORMATS.has(value.format as SocialFormat) ? value.format as SocialFormat : "POST";
    const status: ComposerStatus = value.status === "SAVED" || value.status === "READY" || value.status === "SAVING" || value.status === "GENERATING" ? value.status : "IDLE";
    return {
      version: 1,
      topic: typeof value.topic === "string" ? value.topic : "",
      objective: typeof value.objective === "string" ? value.objective : "",
      providers: providers.length ? providers : ["INSTAGRAM"],
      format,
      sourceKey: typeof value.sourceKey === "string" ? value.sourceKey : "",
      content: value.content && typeof value.content === "object" ? value.content as GeneratedSocialContent : null,
      editorialContext: value.editorialContext && typeof value.editorialContext === "object" ? value.editorialContext as ManualEditorialContext : null,
      status,
      operation: value.operation && typeof value.operation === "object" ? value.operation as PendingOperation : null,
      progress: value.progress && typeof value.progress === "object"
        ? {
            percent: typeof value.progress.percent === "number" ? Math.max(0, Math.min(100, Math.round(value.progress.percent))) : 0,
            stage: value.progress.stage ?? "PREPARING",
          }
        : { percent: 0, stage: "PREPARING" },
    };
  } catch {
    return null;
  }
}

function writePersistedState(profileId: string, state: PersistedComposerState) {
  try { window.sessionStorage.setItem(storageKey(profileId), JSON.stringify(state)); } catch { /* browser storage is best-effort */ }
}

function replaceVariant(content: GeneratedSocialContent, index: number, patch: Partial<GeneratedVariant>) {
  return { ...content, variants: content.variants.map((variant, current) => current === index ? { ...variant, ...patch } : variant) };
}

function progressLabel(stage: ManualGenerationProgressStage) {
  if (stage === "ANALYZING") return "Analizzo brand e brief";
  if (stage === "RESEARCHING") return "Cerco le fonti";
  if (stage === "CHANNEL_STRATEGY") return "Adatto la strategia ai canali";
  if (stage === "WRITING") return "Scrivo le varianti";
  if (stage === "VISUAL_BRIEF") return "Preparo i brief visuali";
  if (stage === "COPY_READY") return "Controllo struttura e formato";
  if (stage === "SOURCE_VALIDATION") return "Normalizzo e valido le fonti";
  if (stage === "VERIFYING") return "Verifico le affermazioni";
  if (stage === "VERIFIED") return "Verifica completata";
  if (stage === "FINALIZING") return "Salvo il risultato";
  if (stage === "COMMITTED") return "Contenuto pronto";
  if (stage === "RELEASED") return "Creazione interrotta";
  return "Preparo la creazione";
}

export function ManualContentComposer(props: { profileId: string; profileName: string; profileType: ProfileType; profiles: Profile[]; researchMode: EditorialResearchMode }) {
  const [topic, setTopic] = useState("");
  const [objective, setObjective] = useState("");
  const [providers, setProviders] = useState<SocialProvider[]>(["INSTAGRAM"]);
  const [format, setFormat] = useState<SocialFormat>("POST");
  const [content, setContent] = useState<GeneratedSocialContent | null>(null);
  const [editorialContext, setEditorialContext] = useState<ManualEditorialContext | null>(null);
  const [sourceRows, setSourceRows] = useState<PersonalBrandSourceRow[]>([]);
  const [sourceKey, setSourceKey] = useState("");
  const [status, setStatus] = useState<ComposerStatus>("IDLE");
  const [progress, setProgress] = useState<GenerationProgress>({ percent: 0, stage: "PREPARING" });
  const [error, setError] = useState<string | null>(null);
  const [hydratedProfileId, setHydratedProfileId] = useState<string | null>(null);
  const operation = useRef<PendingOperation | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const monitorSequence = useRef(0);
  const mounted = useRef(true);
  const activeSources = useMemo(() => sourceRows.filter((row) => row.enabled), [sourceRows]);
  const selectedSource = activeSources.find((row) => `${row.source_profile_id}::${row.pillar}` === sourceKey) ?? null;
  const generating = status === "GENERATING";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = null;
    };
  }, []);

  useEffect(() => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = null;
    monitorSequence.current += 1;
    const stored = readPersistedState(props.profileId);
    operation.current = stored?.operation ?? null;
    setTopic(stored?.topic ?? "");
    setObjective(stored?.objective ?? "");
    setProviders(stored?.providers?.length ? stored.providers : ["INSTAGRAM"]);
    setFormat(stored?.format ?? "POST");
    setSourceKey(stored?.sourceKey ?? "");
    setContent(stored?.content ?? null);
    setEditorialContext(stored?.editorialContext ?? null);
    setProgress(stored?.progress ?? { percent: 0, stage: "PREPARING" });
    setStatus(stored?.operation ? "GENERATING" : stored?.content ? (stored.status === "SAVED" ? "SAVED" : "READY") : "IDLE");
    setError(null);
    setHydratedProfileId(props.profileId);
  }, [props.profileId]);

  useEffect(() => {
    if (hydratedProfileId !== props.profileId) return;
    writePersistedState(props.profileId, {
      version: 1,
      topic,
      objective,
      providers,
      format,
      sourceKey,
      content,
      editorialContext,
      status,
      operation: operation.current,
      progress,
    });
  }, [hydratedProfileId, props.profileId, topic, objective, providers, format, sourceKey, content, editorialContext, status, progress]);

  useEffect(() => {
    if (props.profileType !== "PERSONAL_BRAND") {
      setSourceRows([]);
      return;
    }
    void loadPersonalBrandSources(props.profileId).then((rows) => {
      if (!mounted.current) return;
      const enabled = rows.filter((row) => row.enabled);
      setSourceRows(rows);
      setSourceKey((current) => current || (enabled[0] ? `${enabled[0].source_profile_id}::${enabled[0].pillar}` : ""));
    }).catch(() => {
      if (!mounted.current) return;
      setSourceRows([]);
    });
  }, [props.profileId, props.profileType]);

  function persistPending(op: PendingOperation) {
    writePersistedState(props.profileId, {
      version: 1,
      topic,
      objective,
      providers,
      format,
      sourceKey,
      content: null,
      editorialContext: null,
      status: "GENERATING",
      operation: op,
      progress: { percent: 5, stage: "PREPARING" },
    });
  }

  function finishGeneration(generated: ManualGenerationResult, sequence: number) {
    if (!mounted.current || sequence !== monitorSequence.current) return;
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = null;
    operation.current = null;
    setContent(generated.content);
    setEditorialContext(generated.editorialContext);
    setProgress({ percent: 100, stage: "COMMITTED" });
    setStatus("READY");
    setError(null);
  }

  function failGeneration(reason: unknown, sequence: number) {
    if (!mounted.current || sequence !== monitorSequence.current) return;
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = null;
    const code = reason instanceof ManualGenerationError ? reason.code : null;
    if (code === "GENERATION_IN_PROGRESS") return;
    operation.current = null;
    setStatus("IDLE");
    setProgress((current) => ({ ...current, stage: "RELEASED" }));
    setError(reason instanceof Error ? reason.message : "Generazione non riuscita.");
  }

  async function monitorOperation(op: PendingOperation, startRequest: boolean) {
    const sequence = ++monitorSequence.current;
    setStatus("GENERATING");
    setError(null);
    setProgress((current) => current.percent > 0 ? current : { percent: 5, stage: "PREPARING" });
    let token = "";
    try {
      token = await authenticatedApiToken();
    } catch (reason) {
      failGeneration(reason, sequence);
      return;
    }
    if (!mounted.current || sequence !== monitorSequence.current) return;

    const poll = async () => {
      if (!mounted.current || sequence !== monitorSequence.current) return;
      try {
        const current = await requestManualContentStatus(props.profileId, token, op.id);
        if (!mounted.current || sequence !== monitorSequence.current) return;
        if (current.percent > 0) setProgress({ percent: current.percent, stage: current.stage });
        if (current.state === "COMPLETED" && current.result) {
          finishGeneration(current.result, sequence);
          return;
        }
        if (current.state === "FAILED") {
          failGeneration(new ManualGenerationError(current.error || "GENERATION_FAILED", friendlyGenerationError(current.error || "GENERATION_FAILED")), sequence);
        }
      } catch {
        // A transient status read must not cancel the real generation request.
      }
    };

    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(() => { void poll(); }, 1200);
    void poll();

    if (!startRequest) {
      window.setTimeout(async () => {
        if (!mounted.current || sequence !== monitorSequence.current || !operation.current) return;
        try {
          const current = await requestManualContentStatus(props.profileId, token, op.id);
          if (current.state !== "NOT_FOUND") return;
          const generated = await requestManualContent(op.request, token, op.id);
          finishGeneration(generated, sequence);
        } catch (reason) {
          if (reason instanceof ManualGenerationError && reason.code === "GENERATION_IN_PROGRESS") return;
          try {
            const canonical = await requestManualContentStatus(props.profileId, token, op.id);
            if (canonical.state === "FAILED" && canonical.error) {
              failGeneration(new ManualGenerationError(canonical.error, friendlyGenerationError(canonical.error)), sequence);
              return;
            }
          } catch { /* fall back to the request error */ }
          failGeneration(reason, sequence);
        }
      }, 350);
      return;
    }

    try {
      const generated = await requestManualContent(op.request, token, op.id);
      finishGeneration(generated, sequence);
    } catch (reason) {
      if (reason instanceof ManualGenerationError && reason.code === "GENERATION_IN_PROGRESS") return;
      try {
        const canonical = await requestManualContentStatus(props.profileId, token, op.id);
        if (canonical.state === "FAILED" && canonical.error) {
          failGeneration(new ManualGenerationError(canonical.error, friendlyGenerationError(canonical.error)), sequence);
          return;
        }
      } catch { /* fall back to the request error */ }
      failGeneration(reason, sequence);
    }
  }

  useEffect(() => {
    if (hydratedProfileId !== props.profileId || !operation.current || status !== "GENERATING") return;
    const pending = operation.current;
    void monitorOperation(pending, false);
    // Resumption is intentionally keyed only to profile hydration; progress updates must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydratedProfileId, props.profileId]);

  function clearGenerated() {
    if (generating) return;
    operation.current = null;
    setContent(null);
    setEditorialContext(null);
    setProgress({ percent: 0, stage: "PREPARING" });
    setStatus("IDLE");
    setError(null);
  }

  function toggleProvider(provider: SocialProvider) {
    if (generating) return;
    setProviders((current) => current.includes(provider) ? current.filter((value) => value !== provider) : [...current, provider]);
    clearGenerated();
  }

  async function generate() {
    if (!topic.trim()) { setError("Descrivi il tema del contenuto."); return; }
    if (!providers.length) { setError("Scegli almeno un social."); return; }
    if (props.profileType === "PERSONAL_BRAND" && !objective.trim()) { setError("Per il Personal Brand indica l’obiettivo editoriale."); return; }
    const request: ManualGenerationRequest = {
      profileId: props.profileId,
      topic,
      objective: objective || null,
      providers,
      format,
      researchMode: props.researchMode,
      sourceProfileId: selectedSource?.source_profile_id ?? null,
      pillar: selectedSource?.pillar ?? null,
    };
    const fingerprint = manualGenerationFingerprint(request);
    const nextOperation = operation.current?.fingerprint === fingerprint
      ? operation.current
      : { fingerprint, id: crypto.randomUUID(), request };
    operation.current = nextOperation;
    setContent(null);
    setEditorialContext(null);
    setProgress({ percent: 5, stage: "PREPARING" });
    setStatus("GENERATING");
    setError(null);
    persistPending(nextOperation);
    await monitorOperation(nextOperation, true);
  }

  async function save() {
    if (!content) return;
    setStatus("SAVING");
    setError(null);
    try {
      await saveGeneratedContent({ profileId: props.profileId, topic, objective: objective || null, content, editorialContext });
      setStatus("SAVED");
    } catch (reason) {
      setStatus("READY");
      setError(reason instanceof Error ? reason.message : "Salvataggio non riuscito.");
    }
  }

  function updateVariant(index: number, patch: Partial<GeneratedVariant>) {
    setContent((current) => current ? replaceVariant(current, index, patch) : current);
    if (status === "SAVED") setStatus("READY");
  }

  function updateCarouselSlide(variantIndex: number, slideIndex: number, patch: Partial<NonNullable<GeneratedVariant["carouselSlides"]>[number]>) {
    setContent((current) => {
      if (!current) return current;
      const variant = current.variants[variantIndex];
      const slides = [...(variant.carouselSlides ?? [])];
      if (!slides[slideIndex]) return current;
      slides[slideIndex] = { ...slides[slideIndex], ...patch };
      return replaceVariant(current, variantIndex, { carouselSlides: slides });
    });
    if (status === "SAVED") setStatus("READY");
  }

  return <section className="panel manual-composer" aria-labelledby="manual-composer-title">
    <div className="manual-composer-heading"><div><p className="eyebrow">Creazione guidata</p><h2 id="manual-composer-title">Crea un contenuto ora</h2><p>Scegli tema, social e formato. Il copy userà il brand e le informazioni confermate del sito di {props.profileName}.</p></div><Sparkles size={23} /></div>
    <div className="manual-composer-form">
      {props.profileType === "PERSONAL_BRAND" && <label className="full">Dati da usare <span>(opzionale)</span><select disabled={generating} value={sourceKey} onChange={(event) => { setSourceKey(event.target.value); clearGenerated(); }}><option value="">Solo {props.profileName}: sito, brand e informazioni aggiuntive</option>{activeSources.map((row) => { const profile = props.profiles.find((item) => item.id === row.source_profile_id); const key = `${row.source_profile_id}::${row.pillar}`; return <option key={row.id} value={key}>Aggiungi fatti verificati da {profile?.name ?? "attività collegata"}</option>; })}</select></label>}
      <label className="full">Di cosa vuoi parlare?<textarea disabled={generating} rows={3} value={topic} maxLength={1000} placeholder="Es. Tre errori da evitare quando si affitta una casa" onChange={(event) => { setTopic(event.target.value); clearGenerated(); }} /></label>
      <label className="full">Obiettivo o dettagli da rispettare {props.profileType === "PERSONAL_BRAND" ? <span>(richiesto)</span> : <span>(opzionale)</span>}<input disabled={generating} value={objective} maxLength={500} placeholder="Es. Mostra le 5 differenze principali e chiudi con una CTA" onChange={(event) => { setObjective(event.target.value); clearGenerated(); }} /></label>
      <fieldset className="full" disabled={generating}><legend>Social</legend><div className="manual-choice-grid providers">{PROVIDERS.map((provider) => <label key={provider.value} className={providers.includes(provider.value) ? "selected" : ""}><input type="checkbox" checked={providers.includes(provider.value)} onChange={() => toggleProvider(provider.value)} /><span>{provider.label}</span></label>)}</div></fieldset>
      <fieldset className="full" disabled={generating}><legend>Formato</legend><div className="manual-choice-grid formats"><label className={format === "POST" ? "selected" : ""}><input type="radio" name="manual-format" checked={format === "POST"} onChange={() => { setFormat("POST"); clearGenerated(); }} /><span>Post</span></label><label className={format === "STORY" ? "selected" : ""}><input type="radio" name="manual-format" checked={format === "STORY"} onChange={() => { setFormat("STORY"); clearGenerated(); }} /><span>Storia</span></label><label className={format === "CAROUSEL" ? "selected" : ""}><input type="radio" name="manual-format" checked={format === "CAROUSEL"} onChange={() => { setFormat("CAROUSEL"); clearGenerated(); }} /><span>Carosello</span></label></div></fieldset>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!content && <button className="primary-button manual-generate" type="button" disabled={generating} onClick={() => void generate()}>{generating ? <><LoaderCircle className="spin" size={17} /> Creazione in corso…</> : <><Sparkles size={17} /> Genera contenuto</>}</button>}
    {generating && <div className="manual-generation-progress" aria-live="polite" aria-label="Avanzamento creazione contenuto">
      <div className="manual-generation-progress-head"><span>{progressLabel(progress.stage)}</span><strong>{progress.percent}%</strong></div>
      <div className="manual-generation-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}><span style={{ width: `${progress.percent}%` }} /></div>
      <p>Puoi aprire Calendario o altre sezioni: la creazione continua e, tornando qui, ritrovi richiesta e avanzamento.</p>
    </div>}
    {content && <div className="manual-result" aria-live="polite">
      <div className="manual-result-summary"><div><small>PROPOSTA EDITORIALE</small><h3>{content.editorialTopic}</h3><p>{content.editorialAngle}</p></div><span>{content.variants.length} {content.variants.length === 1 ? "variante" : "varianti"}</span></div>
      {(editorialContext?.sourceIntelligence?.uiSources?.length ?? editorialContext?.externalSources?.length ?? 0) > 0 && <details className="manual-source-proof">
        <summary>Fonti verificate · {editorialContext?.sourceIntelligence?.auditSources?.length ?? editorialContext?.externalSources?.length ?? 0}</summary>
        {(editorialContext?.sourceIntelligence?.claims?.length ?? 0) > 0 && <div className="manual-source-claims">
          {editorialContext?.sourceIntelligence?.claims.slice(0, 8).map((claim) => <section key={claim.claim}>
            <header><strong>{claim.claim}</strong><span>{claim.verificationStatus === "VERIFIED" ? "Verificato" : claim.verificationStatus === "PARTIALLY_VERIFIED" ? "Parzialmente verificato" : claim.verificationStatus === "CONFLICTING_SOURCES" ? "Fonti in conflitto" : "Da verificare"}</span></header>
            <div>{claim.sourceUrls.slice(0, 4).map((source) => { let label = source; try { label = new URL(source).hostname.replace(/^www\./, ""); } catch { /* keep URL */ } return <a key={source} href={source} target="_blank" rel="noreferrer">{label}</a>; })}</div>
          </section>)}
        </div>}
        <div className="manual-source-list">{(editorialContext?.sourceIntelligence?.uiSources ?? []).length > 0
          ? editorialContext?.sourceIntelligence?.uiSources.map((source) => <a key={source.canonicalUrl} href={source.canonicalUrl} target="_blank" rel="noreferrer" title={source.tier}>{source.label}</a>)
          : (editorialContext?.externalSources ?? []).slice(0, 8).map((source) => { let label = source; try { label = new URL(source).hostname.replace(/^www\./, ""); } catch { /* keep URL */ } return <a key={source} href={source} target="_blank" rel="noreferrer">{label}</a>; })}
        </div>
        {(editorialContext?.sourceIntelligence?.auditSources?.length ?? 0) > (editorialContext?.sourceIntelligence?.uiSources?.length ?? 0) && <p className="field-help">La UI mostra le fonti principali; tutte le fonti normalizzate restano conservate per audit.</p>}
      </details>}
      <div className="manual-variant-list">{content.variants.map((variant, index) => <article key={`${variant.provider}-${variant.format}`} className="manual-variant">
        <header><strong>{PROVIDERS.find((provider) => provider.value === variant.provider)?.label ?? variant.provider}</strong><span>{variant.format === "STORY" ? "Storia" : variant.format === "CAROUSEL" ? "Carosello" : "Post"}</span></header>
        {!variant.eligible && <p className="manual-warning">Questa proposta richiede una revisione particolare per il social scelto.</p>}
        <div className="manual-edit-grid">
          <label>Hook<input value={variant.hook} onChange={(event) => updateVariant(index, { hook: event.target.value })} /></label>
          <label>Invito all’azione<input value={variant.cta ?? ""} onChange={(event) => updateVariant(index, { cta: event.target.value || null })} /></label>
          <label className="full">Testo<textarea rows={5} value={variant.caption} onChange={(event) => updateVariant(index, { caption: event.target.value })} /></label>
          <label className="full">Hashtag<input value={variant.hashtags.join(" ")} onChange={(event) => updateVariant(index, { hashtags: event.target.value.split(/[\s,]+/).filter(Boolean).map((tag) => tag.startsWith("#") ? tag : `#${tag}`).slice(0, 15) })} /></label>
          <label className="full">Indicazioni per l’immagine<textarea rows={3} value={variant.visualBrief} onChange={(event) => updateVariant(index, { visualBrief: event.target.value })} /></label>
          <label className="full">Descrizione accessibile<input value={variant.altText} onChange={(event) => updateVariant(index, { altText: event.target.value })} /></label>
        </div>
        {variant.format === "CAROUSEL" && <div className="manual-carousel-slides">
          <h4>Slide del carosello · {variant.carouselSlides?.length ?? 0}</h4>
          <p>Ogni slide è un elemento separato del carosello, non un collage.</p>
          {(variant.carouselSlides ?? []).map((slide, slideIndex) => <section className="manual-carousel-slide" key={slide.position}>
            <header><strong>Slide {slide.position}</strong><span>{slide.purpose}</span></header>
            <div className="manual-edit-grid">
              <label>Scopo<input value={slide.purpose} onChange={(event) => updateCarouselSlide(index, slideIndex, { purpose: event.target.value })} /></label>
              <label>Gerarchia<input value={slide.hierarchy} onChange={(event) => updateCarouselSlide(index, slideIndex, { hierarchy: event.target.value })} /></label>
              <label className="full">Titolo<input value={slide.headline} onChange={(event) => updateCarouselSlide(index, slideIndex, { headline: event.target.value })} /></label>
              <label className="full">Testo<textarea rows={3} value={slide.body} onChange={(event) => updateCarouselSlide(index, slideIndex, { body: event.target.value })} /></label>
              <label className="full">Visuale<textarea rows={2} value={slide.visualBrief} onChange={(event) => updateCarouselSlide(index, slideIndex, { visualBrief: event.target.value })} /></label>
              <label className="full">Alt text<input value={slide.altText} onChange={(event) => updateCarouselSlide(index, slideIndex, { altText: event.target.value })} /></label>
            </div>
          </section>)}
        </div>}
      </article>)}</div>
      <div className="manual-result-actions">{status === "SAVED" ? <><span className="manual-saved"><Check size={16} /> Salvato nelle Revisioni</span><NavLink className="primary-button" to="/app/approvazioni">Aggiungi immagine e approva <ArrowRight size={16} /></NavLink></> : <><button className="secondary-button" type="button" disabled={status === "SAVING"} onClick={() => clearGenerated()}>Cambia richiesta</button><button className="primary-button" type="button" disabled={status === "SAVING"} onClick={() => void save()}>{status === "SAVING" ? <><LoaderCircle className="spin" size={16} /> Salvataggio…</> : "Salva per la revisione"}</button></>}</div>
    </div>}
  </section>;
}
