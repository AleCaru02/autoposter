import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, Image as ImageIcon, LoaderCircle, RefreshCcw, Trash2, Undo2, X } from "lucide-react";
import { authenticatedApiToken } from "../lib/auth-token";
import { useProfiles } from "../features/profiles/profile-context";
import {
  deleteContent,
  loadContentWorkflow,
  reviewVariant,
  runVariantQa,
  type AssetRow,
  type ContentItemRow,
  type ContentVariantRow,
  type ContentCarouselSlideRow,
  type StoredMasterDecision,
} from "../features/content/content-store";
import "../approvals.css";
import { NavLink } from "react-router-dom";
import { CustomerWorkflowJourney } from "../components/customer-workflow-journey";
import { buildEditorialDecisionRecord } from "../../api/_lib/editorial-decision-record";

type DraftFields = {
  hook: string;
  caption: string;
  cta: string;
  hashtags: string;
  visualBrief: string;
  altText: string;
};
type DraftSaveStatus = "SAVED" | "WAITING" | "SAVING" | "ERROR";

type ImageResponse = {
  image?: { dataUrl: string; model: string; size: string; quality: string };
  asset?: { id: string };
  error?: string;
  message?: string;
  detail?: string;
};

function draftFromVariant(variant: ContentVariantRow): DraftFields {
  return {
    hook: variant.hook ?? "",
    caption: variant.caption,
    cta: variant.cta ?? "",
    hashtags: variant.hashtags.join(" "),
    visualBrief: variant.visual_brief ?? "",
    altText: variant.alt_text ?? "",
  };
}

function parseHashtags(value: string) {
  return value.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean).map((entry) => entry.startsWith("#") ? entry : `#${entry}`).slice(0, 30);
}

function statusLabel(status: string) {
  if (status === "APPROVED") return "Approvato";
  if (status === "CHANGES_REQUESTED") return "Rifiutato";
  return "In revisione";
}

function workflowStatusLabel(status: ContentVariantRow["workflow_status"]) {
  if (status === "DRAFT") return "Bozza";
  if (status === "REVIEW") return "In revisione";
  if (status === "REVIEW_REQUIRED") return "Revisione richiesta";
  if (status === "APPROVED") return "Approvato";
  return "Rifiutato";
}

function providerLabel(provider: string) {
  const labels: Record<string, string> = { INSTAGRAM: "Instagram", FACEBOOK: "Facebook", LINKEDIN: "LinkedIn", GBP: "Google Business Profile" };
  return labels[provider.toUpperCase()] ?? provider;
}

function visualGenerationErrorMessage(value: string | null) {
  const code = (value ?? "").toUpperCase();
  if (!code) return "";
  if (code.includes("CREDIT_BALANCE_EXHAUSTED") || code.includes("INSUFFICIENT_QUOTA") || code.includes("BILLING")) {
    return "Generazione immagini bloccata: il credito o la fatturazione OpenAI non sono disponibili. Il copy è salvo; ricarica il credito prima di riprovare.";
  }
  if (code.includes("429") || code.includes("RATE_LIMIT")) {
    return "Generazione immagini temporaneamente limitata dal servizio. Il copy è salvo; riprova più tardi.";
  }
  if (code.includes("401") || code.includes("403") || code.includes("AUTH") || code.includes("PERMISSION")) {
    return "Generazione immagini non autorizzata. Verifica la configurazione OpenAI prima di riprovare.";
  }
  return "Generazione immagini non completata. Il copy è salvo; puoi riprovare solo il visuale.";
}


export function ApprovalsPage() {
  const { selectedProfile } = useProfiles();
  const [items, setItems] = useState<ContentItemRow[]>([]);
  const [variants, setVariants] = useState<ContentVariantRow[]>([]);
  const [carouselSlides, setCarouselSlides] = useState<ContentCarouselSlideRow[]>([]);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [masterDecisions, setMasterDecisions] = useState<Record<string, StoredMasterDecision>>({});
  const [drafts, setDrafts] = useState<Record<string, DraftFields>>({});
  const [saveStatus, setSaveStatus] = useState<Record<string, DraftSaveStatus>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const draftsRef = useRef<Record<string, DraftFields>>({});
  const variantsRef = useRef<ContentVariantRow[]>([]);
  const dirtyVariantIdsRef = useRef(new Set<string>());
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const reload = useCallback(async () => {
    if (!selectedProfile?.id) return;
    setLoading(true);
    setError(null);
    try {
      const workflow = await loadContentWorkflow(selectedProfile.id);
      const nextDrafts = Object.fromEntries(workflow.variants.map((variant) => [variant.id, draftFromVariant(variant)]));
      setItems(workflow.items);
      setVariants(workflow.variants);
      variantsRef.current = workflow.variants;
      setCarouselSlides(workflow.carouselSlides);
      setAssets(workflow.assets);
      setMasterDecisions(workflow.masterDecisions);
      setDrafts(nextDrafts);
      draftsRef.current = nextDrafts;
      dirtyVariantIdsRef.current.clear();
      setSaveStatus(Object.fromEntries(workflow.variants.map((variant) => [variant.id, "SAVED"])));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossibile caricare i contenuti.");
    } finally {
      setLoading(false);
    }
  }, [selectedProfile?.id]);

  useEffect(() => { void reload(); }, [reload]);

  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const slidesByVariant = useMemo(() => {
    const map = new Map<string, ContentCarouselSlideRow[]>();
    for (const slide of carouselSlides) map.set(slide.variant_id, [...(map.get(slide.variant_id) ?? []), slide].sort((a, b) => a.position - b.position));
    return map;
  }, [carouselSlides]);

  const variantsByContent = useMemo(() => {
    const map = new Map<string, ContentVariantRow[]>();
    for (const variant of variants) map.set(variant.content_id, [...(map.get(variant.content_id) ?? []), variant]);
    return map;
  }, [variants]);

  async function persistVariant(variant: ContentVariantRow, draft = draftsRef.current[variant.id] ?? draftFromVariant(variant), profileId = selectedProfile?.id) {
    if (!profileId) return;
    const currentVariant = variantsRef.current.find((row) => row.id === variant.id) ?? variant;
    const existingTimer = saveTimersRef.current[variant.id];
    if (existingTimer) clearTimeout(existingTimer);
    delete saveTimersRef.current[variant.id];
    setSaveStatus((current) => ({ ...current, [variant.id]: "SAVING" }));
    try {
      const result = await reviewVariant({
        profileId,
        variantId: variant.id,
        contentId: variant.content_id,
        expectedUpdatedAt: currentVariant.updated_at,
        hook: draft.hook,
        caption: draft.caption,
        cta: draft.cta,
        hashtags: parseHashtags(draft.hashtags),
        visualBrief: draft.visualBrief,
        altText: draft.altText,
        approvalStatus: "PENDING",
      });
      dirtyVariantIdsRef.current.delete(variant.id);
      setSaveStatus((current) => ({ ...current, [variant.id]: "SAVED" }));
      const changed = currentVariant.hook !== (draft.hook || null)
        || currentVariant.caption !== draft.caption
        || currentVariant.cta !== (draft.cta || null)
        || currentVariant.hashtags.join(" ") !== parseHashtags(draft.hashtags).join(" ")
        || currentVariant.visual_brief !== (draft.visualBrief || null)
        || currentVariant.alt_text !== (draft.altText || null);
      setVariants((current) => {
        const next: ContentVariantRow[] = current.map((row) => row.id === variant.id ? {
          ...row,
          hook: draft.hook || null,
          caption: draft.caption,
          cta: draft.cta || null,
          hashtags: parseHashtags(draft.hashtags),
          visual_brief: draft.visualBrief || null,
          alt_text: draft.altText || null,
          approval_status: result.approvalStatus,
          approval_mode: "MANUAL",
          workflow_status: result.workflowStatus,
          approved_by: result.workflowStatus === "APPROVED" ? row.approved_by : null,
          approved_at: result.workflowStatus === "APPROVED" ? row.approved_at : null,
          rejected_reason: result.workflowStatus === "REJECTED" ? row.rejected_reason : null,
          approved_fingerprint: result.workflowStatus === "APPROVED" ? row.approved_fingerprint : null,
          qa_status: changed ? "PENDING" : row.qa_status,
          qa_fingerprint: changed ? null : row.qa_fingerprint,
          qa_result: changed ? {} : row.qa_result,
          qa_checked_at: changed ? null : row.qa_checked_at,
          updated_at: result.updatedAt,
        } : row);
        variantsRef.current = next;
        return next;
      });
      setItems((current) => current.map((item) => item.id === variant.content_id ? { ...item, status: result.contentStatus, updated_at: result.updatedAt } : item));
    } catch (reason) {
      setSaveStatus((current) => ({ ...current, [variant.id]: "ERROR" }));
      throw reason;
    }
  }

  function setDraftField(variant: ContentVariantRow, field: keyof DraftFields, value: string) {
    const profileId = selectedProfile?.id;
    if (!profileId) return;
    const currentDraft = draftsRef.current[variant.id] ?? draftFromVariant(variant);
    const next = { ...currentDraft, [field]: value };
    draftsRef.current = { ...draftsRef.current, [variant.id]: next };
    dirtyVariantIdsRef.current.add(variant.id);
    setDrafts((current) => ({ ...current, [variant.id]: next }));
    setSaveStatus((current) => ({ ...current, [variant.id]: "WAITING" }));
    const existingTimer = saveTimersRef.current[variant.id];
    if (existingTimer) clearTimeout(existingTimer);
    saveTimersRef.current[variant.id] = setTimeout(() => {
      void persistVariant(variant, draftsRef.current[variant.id], profileId).catch((reason) => setError(reason instanceof Error ? reason.message : "Salvataggio automatico non riuscito."));
    }, 500);
  }

  useEffect(() => {
    const profileId = selectedProfile?.id;
    return () => {
      for (const timer of Object.values(saveTimersRef.current)) clearTimeout(timer);
      saveTimersRef.current = {};
      if (!profileId) return;
      const dirtyIds = new Set(dirtyVariantIdsRef.current);
      for (const variant of variantsRef.current) {
        if (!dirtyIds.has(variant.id)) continue;
        void persistVariant(variant, draftsRef.current[variant.id], profileId).catch(() => undefined);
      }
    };
  }, [selectedProfile?.id]);

  async function run(key: string, task: () => Promise<void>) {
    if (busy[key]) return;
    setBusy((current) => ({ ...current, [key]: true }));
    setError(null);
    try { await task(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Operazione non riuscita."); }
    finally { setBusy((current) => ({ ...current, [key]: false })); }
  }

  async function approve(variant: ContentVariantRow, approvalStatus: "PENDING" | "APPROVED" | "CHANGES_REQUESTED") {
    if (!selectedProfile) return;
    let rejectedReason: string | null = null;
    if (approvalStatus === "CHANGES_REQUESTED") {
      const reason = window.prompt("Motivo del rifiuto o delle modifiche richieste:");
      if (reason === null) return;
      rejectedReason = reason.trim();
      if (!rejectedReason) {
        setError("Indica il motivo del rifiuto.");
        return;
      }
    }
    if (approvalStatus === "APPROVED" && variant.qa_status !== "PASS") {
      setError("Il contenuto non può essere approvato finché il Content QA non è PASS.");
      return;
    }
    if (variant.format === "CAROUSEL" && approvalStatus === "APPROVED") {
      const slides = slidesByVariant.get(variant.id) ?? [];
      const ready = slides.length >= 4 && slides.length <= 10 && slides.every((slide) => slide.asset_id && slide.qa_status === "PASS");
      if (!ready) {
        setError("Il carosello non può essere approvato finché ogni slide non ha un visuale e QA PASS.");
        return;
      }
    }
    await run(`approval-${variant.id}`, async () => {
      const timer = saveTimersRef.current[variant.id];
      if (timer) clearTimeout(timer);
      delete saveTimersRef.current[variant.id];
      const draft = draftsRef.current[variant.id] ?? draftFromVariant(variant);
      const currentVariant = variantsRef.current.find((row) => row.id === variant.id) ?? variant;
      await reviewVariant({
        profileId: selectedProfile.id,
        variantId: variant.id,
        contentId: variant.content_id,
        expectedUpdatedAt: currentVariant.updated_at,
        hook: draft.hook,
        caption: draft.caption,
        cta: draft.cta,
        hashtags: parseHashtags(draft.hashtags),
        visualBrief: draft.visualBrief,
        altText: draft.altText,
        approvalStatus,
        rejectedReason,
      });
      dirtyVariantIdsRef.current.delete(variant.id);
      await reload();
    });
  }

  async function runQa(variant: ContentVariantRow) {
    if (!selectedProfile) return;
    await run(`qa-${variant.id}`, async () => {
      const timer = saveTimersRef.current[variant.id];
      if (timer) clearTimeout(timer);
      delete saveTimersRef.current[variant.id];
      if (dirtyVariantIdsRef.current.has(variant.id)) {
        await persistVariant(variant, draftsRef.current[variant.id] ?? draftFromVariant(variant));
      }
      await runVariantQa({
        profileId: selectedProfile.id,
        contentId: variant.content_id,
        variantId: variant.id,
      });
      await reload();
    });
  }

    async function generateImage(variant: ContentVariantRow) {
    if (!selectedProfile) return;
    if (variant.format === "CAROUSEL") {
      setError("Il carosello richiede un visuale distinto per ogni slide. La generazione singola è bloccata per evitare un falso carosello.");
      return;
    }
    const draft = draftsRef.current[variant.id] ?? draftFromVariant(variant);
    if (!draft.visualBrief.trim()) {
      setError("Inserisci prima un brief visivo.");
      return;
    }
    await run(`image-${variant.id}`, async () => {
      await persistVariant(variant, draft);
      const token = await authenticatedApiToken();
      const response = await fetch("/api/generate-image", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-post-automatici-operation-id": crypto.randomUUID() },
        body: JSON.stringify({
          profileId: selectedProfile.id,
          contentVariantId: variant.id,
          provider: variant.provider,
          format: variant.format,
          visualBrief: draft.visualBrief,
          caption: draft.caption,
          forceNewImage: Boolean(variant.image_asset_id),
        }),
      });
      const body = await response.json() as ImageResponse;
      if (!response.ok || !body.asset?.id) {
        await reload();
        throw new Error("Il visuale non è stato generato. Il copy resta salvato: riprova solo il visuale.");
      }
      await reload();
    });
  }

  async function generateCarouselSlideImage(variant: ContentVariantRow, slide: ContentCarouselSlideRow) {
    if (!selectedProfile || variant.format !== "CAROUSEL") return;
    await run(`slide-image-${slide.id}`, async () => {
      const token = await authenticatedApiToken();
      const response = await fetch("/api/generate-image", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-post-automatici-operation-id": crypto.randomUUID() },
        body: JSON.stringify({
          profileId: selectedProfile.id,
          contentVariantId: variant.id,
          carouselSlideId: slide.id,
          provider: variant.provider,
          format: "CAROUSEL",
          visualBrief: slide.visual_brief,
          caption: [slide.headline, slide.body].filter(Boolean).join(" — "),
          forceNewImage: Boolean(slide.asset_id),
        }),
      });
      const body = await response.json() as ImageResponse;
      if (!response.ok || !body.asset?.id) {
        await reload();
        throw new Error("Il visuale della slide non è stato generato. Testo e struttura restano salvati: riprova solo questa slide.");
      }
      await reload();
    });
  }

    async function removeItem(item: ContentItemRow) {
    if (!selectedProfile || !window.confirm("Eliminare questo contenuto e tutte le sue varianti?")) return;
    await run(`delete-${item.id}`, async () => {
      await deleteContent(selectedProfile.id, item.id);
      await reload();
    });
  }

  if (!selectedProfile) return null;
  if (loading) return <div className="page-content"><p>Caricamento revisioni…</p></div>;

  return <div className="page-content">
    <header className="page-header">
      <div><p className="eyebrow">Revisioni · {selectedProfile.name}</p><h1>Revisione contenuti</h1><p>Ogni modifica al testo viene salvata automaticamente. Approva solo quando il contenuto è pronto.</p></div>
      <button className="compact-action" type="button" onClick={() => void reload()}><RefreshCcw size={15} /> Aggiorna</button>
    </header>
    <CustomerWorkflowJourney current="REVIEW" />
    {error && <p className="form-error" role="alert">{error}</p>}
    {items.length === 0 ? <section className="panel empty-approval"><CheckCircle2 size={24} /><h2>Nessun contenuto da controllare</h2><p>Se l’Autopilot è attivo, i prossimi contenuti compariranno qui. Puoi controllare le impostazioni o il calendario.</p><div className="empty-approval-actions"><NavLink className="primary-button" to="/app/contenuti">Apri Contenuti</NavLink><NavLink className="secondary-button" to="/app/calendario">Vedi calendario</NavLink></div></section> : null}
    <div className="approval-list">
      {items.map((item) => {
        const itemVariants = variantsByContent.get(item.id) ?? [];
        return <section className="approval-item" key={item.id}>
          <header className="approval-item-header">
            <div><span className={`workflow-status status-${item.status.toLowerCase()}`}>{statusLabel(item.status)}</span><h2>{item.title || item.topic}</h2><p>{item.topic}{item.objective ? ` · Obiettivo: ${item.objective}` : ""}</p></div>
            <button className="icon-danger-button" type="button" disabled={busy[`delete-${item.id}`]} onClick={() => void removeItem(item)} aria-label="Elimina contenuto"><Trash2 size={17} /></button>
          </header>
          <div className="approval-variants">
            {itemVariants.map((variant) => {
              const draft = drafts[variant.id] ?? draftFromVariant(variant);
              const asset = variant.image_asset_id ? assetMap.get(variant.image_asset_id) : undefined;
              const slides = slidesByVariant.get(variant.id) ?? [];
              const carouselReady = variant.format !== "CAROUSEL" || (slides.length >= 4 && slides.length <= 10 && slides.every((slide) => slide.asset_id && slide.qa_status === "PASS"));
              const decision = buildEditorialDecisionRecord({ topic: item.topic, objective: item.objective, provider: variant.provider, format: variant.format, eligible: variant.eligible, approvalStatus: variant.approval_status, asset, masterDecision: masterDecisions[item.id] });
              const currentSaveStatus = saveStatus[variant.id] ?? "SAVED";
              return <article className="approval-variant" key={variant.id}>
                <header><div><strong>{providerLabel(variant.provider)}</strong><span>{variant.format}</span></div><div className="variant-header-status"><span className={`variant-status variant-${variant.workflow_status.toLowerCase()}`}>{workflowStatusLabel(variant.workflow_status)} · {variant.approval_mode === "AUTO" ? "Auto" : "Manuale"}</span><span className={`variant-status variant-${variant.qa_status.toLowerCase()}`}>QA {variant.qa_status}</span><span className={`autosave-mini ${currentSaveStatus.toLowerCase()}`}>{currentSaveStatus === "WAITING" || currentSaveStatus === "SAVING" ? <><LoaderCircle className="spin" size={12} /> Salvataggio…</> : currentSaveStatus === "ERROR" ? "Errore salvataggio" : <><Check size={12} /> Salvato</>}</span></div></header>
                <div className="approval-grid" onBlurCapture={() => void persistVariant(variant).catch((reason) => setError(reason instanceof Error ? reason.message : "Salvataggio automatico non riuscito."))}>
                  <label>Hook<input value={draft.hook} onChange={(event) => setDraftField(variant, "hook", event.target.value)} /></label>
                  <label>CTA<input value={draft.cta} onChange={(event) => setDraftField(variant, "cta", event.target.value)} /></label>
                  <label className="full">Testo<textarea rows={5} value={draft.caption} onChange={(event) => setDraftField(variant, "caption", event.target.value)} /></label>
                  <label className="full">Hashtag<input value={draft.hashtags} onChange={(event) => setDraftField(variant, "hashtags", event.target.value)} /></label>
                  <label className="full">Brief immagine<textarea rows={3} value={draft.visualBrief} onChange={(event) => setDraftField(variant, "visualBrief", event.target.value)} /></label>
                  <label className="full">Alt text<input value={draft.altText} onChange={(event) => setDraftField(variant, "altText", event.target.value)} /></label>
                </div>
                {variant.format === "CAROUSEL" ? <div className="carousel-review-slides">
                  <h3>Slide carosello · {slides.length}</h3>
                  {slides.map((slide) => {
                    const slideAsset = slide.asset_id ? assetMap.get(slide.asset_id) : undefined;
                    return <article className="carousel-review-slide" key={slide.id}>
                      <header><strong>Slide {slide.position} · {slide.headline}</strong><span>QA {slide.qa_status}</span></header>
                      <p><strong>Scopo:</strong> {slide.purpose}</p>
                      <p>{slide.body}</p>
                      <p><strong>Gerarchia:</strong> {slide.hierarchy}</p>
                      <p><strong>Visuale:</strong> {slide.visual_brief}</p>
                      {slideAsset ? <figure className="approval-image"><img src={slideAsset.storage_url} alt={slide.alt_text} /><figcaption>Visuale slide {slide.position} · {slideAsset.source}</figcaption></figure> : <div className="no-image-state">Visuale slide {slide.position} non ancora generato.</div>}
                      {slide.visual_generation_status === "FAIL" && <p className="manual-warning">{visualGenerationErrorMessage(slide.visual_generation_error)}</p>}
                      <button className="secondary-button" type="button" disabled={busy[`slide-image-${slide.id}`] || slide.visual_generation_status === "GENERATING"} onClick={() => void generateCarouselSlideImage(variant, slide)}><ImageIcon size={16} /> {busy[`slide-image-${slide.id}`] || slide.visual_generation_status === "GENERATING" ? "Generazione visuale…" : slide.visual_generation_status === "FAIL" ? "Riprova visuale slide" : slideAsset ? "Rigenera visuale slide" : "Genera visuale slide"}</button>
                    </article>;
                  })}
                  {!carouselReady && <p className="manual-warning">Approvazione bloccata: ogni slide deve avere un visuale distinto e QA PASS.</p>}
                </div> : <>
                  {asset ? <figure className="approval-image"><img src={asset.storage_url} alt={draft.altText || "Immagine generata"} /><figcaption>Immagine salvata · {asset.source}</figcaption></figure> : <div className="no-image-state">Nessuna immagine salvata per questa variante.</div>}
                  {variant.visual_generation_status === "FAIL" && <p className="manual-warning">{visualGenerationErrorMessage(variant.visual_generation_error)}</p>}
                </>}
                <details className="decision-record"><summary>Approvazione · {workflowStatusLabel(variant.workflow_status)}</summary>
                  <dl>
                    <div><dt>Modalità</dt><dd>{variant.approval_mode === "AUTO" ? "Automatica" : "Manuale"}</dd></div>
                    <div><dt>Approvato da</dt><dd>{variant.approved_by ?? "—"}</dd></div>
                    <div><dt>Approvato il</dt><dd>{variant.approved_at ? new Date(variant.approved_at).toLocaleString("it-IT") : "—"}</dd></div>
                    <div><dt>Motivo rifiuto</dt><dd>{variant.rejected_reason ?? "—"}</dd></div>
                  </dl>
                </details>
                <details className="decision-record"><summary>Content QA · {variant.qa_status}</summary>
                  <dl>
                    {Object.entries(variant.qa_result ?? {}).filter(([key]) => ["brandStatus","copyStatus","visualStatus","factStatus","platformStatus","duplicateStatus","budgetStatus"].includes(key)).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}
                  </dl>
                  {Array.isArray((variant.qa_result as { reasons?: unknown[] })?.reasons) && <p>{((variant.qa_result as { reasons?: unknown[] }).reasons ?? []).map(String).join(" · ")}</p>}
                </details>
                <details className="decision-record"><summary>Perché questa scelta</summary><p>{decision.summary}</p><dl>{decision.entries.map((entry) => <div key={entry.label}><dt>{entry.label}</dt><dd className={`decision-${entry.state.toLowerCase()}`}>{entry.detail}</dd></div>)}</dl></details>
                <div className="approval-actions">
                  {variant.format !== "CAROUSEL" && <button className="secondary-button" type="button" disabled={busy[`image-${variant.id}`] || variant.visual_generation_status === "GENERATING"} onClick={() => void generateImage(variant)}><ImageIcon size={16} /> {busy[`image-${variant.id}`] || variant.visual_generation_status === "GENERATING" ? "Generazione visuale…" : variant.visual_generation_status === "FAIL" ? "Riprova visuale" : asset ? "Rigenera immagine" : "Genera immagine"}</button>}
                  <button className="secondary-button" type="button" disabled={busy[`qa-${variant.id}`] || currentSaveStatus === "SAVING" || currentSaveStatus === "WAITING"} onClick={() => void runQa(variant)}><CheckCircle2 size={16} /> {busy[`qa-${variant.id}`] ? "QA in corso…" : variant.qa_status === "PASS" ? "Riesegui QA" : "Esegui QA"}</button>
                  <button className="approval-button approve" type="button" disabled={busy[`approval-${variant.id}`] || currentSaveStatus === "SAVING" || !carouselReady || variant.qa_status !== "PASS"} onClick={() => void approve(variant, "APPROVED")}><Check size={16} /> Approva</button>
                  <button className="approval-button changes" type="button" disabled={busy[`approval-${variant.id}`] || currentSaveStatus === "SAVING"} onClick={() => void approve(variant, "CHANGES_REQUESTED")}><X size={16} /> Rifiuta</button>
                  {variant.approval_status !== "PENDING" && <button className="approval-button pending" type="button" disabled={busy[`approval-${variant.id}`] || currentSaveStatus === "SAVING"} onClick={() => void approve(variant, "PENDING")}><Undo2 size={16} /> Riapri</button>}
                </div>
              </article>;
            })}
          </div>
        </section>;
      })}
    </div>
  </div>;
}
