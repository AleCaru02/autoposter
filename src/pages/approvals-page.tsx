import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Image as ImageIcon, RefreshCcw, Save, Trash2, Undo2, X } from "lucide-react";
import { authClient } from "../lib/neon-client";
import { useProfiles } from "../features/profiles/profile-context";
import {
  deleteContent,
  loadContentWorkflow,
  setVariantApproval,
  updateVariant,
  type AssetRow,
  type ContentItemRow,
  type ContentVariantRow,
} from "../features/content/content-store";
import "../approvals.css";

type JwtAuth = { getJWTToken?: () => Promise<string | null> };
type DraftFields = {
  hook: string;
  caption: string;
  cta: string;
  hashtags: string;
  visualBrief: string;
  altText: string;
};

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
  if (status === "CHANGES_REQUESTED") return "Da correggere";
  return "In revisione";
}

export function ApprovalsPage() {
  const { selectedProfile } = useProfiles();
  const [items, setItems] = useState<ContentItemRow[]>([]);
  const [variants, setVariants] = useState<ContentVariantRow[]>([]);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftFields>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!selectedProfile?.id) return;
    setLoading(true);
    setError(null);
    try {
      const workflow = await loadContentWorkflow(selectedProfile.id);
      setItems(workflow.items);
      setVariants(workflow.variants);
      setAssets(workflow.assets);
      setDrafts(Object.fromEntries(workflow.variants.map((variant) => [variant.id, draftFromVariant(variant)])));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Impossibile caricare i contenuti.");
    } finally {
      setLoading(false);
    }
  }, [selectedProfile?.id]);

  useEffect(() => { void reload(); }, [reload]);

  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const variantsByContent = useMemo(() => {
    const map = new Map<string, ContentVariantRow[]>();
    for (const variant of variants) map.set(variant.content_id, [...(map.get(variant.content_id) ?? []), variant]);
    return map;
  }, [variants]);

  function setDraftField(variantId: string, field: keyof DraftFields, value: string) {
    setDrafts((current) => ({ ...current, [variantId]: { ...(current[variantId] ?? { hook: "", caption: "", cta: "", hashtags: "", visualBrief: "", altText: "" }), [field]: value } }));
  }

  async function run(key: string, task: () => Promise<void>) {
    if (busy[key]) return;
    setBusy((current) => ({ ...current, [key]: true }));
    setError(null);
    try { await task(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Operazione non riuscita."); }
    finally { setBusy((current) => ({ ...current, [key]: false })); }
  }

  async function saveVariant(variant: ContentVariantRow) {
    if (!selectedProfile) return;
    const draft = drafts[variant.id] ?? draftFromVariant(variant);
    await run(`save-${variant.id}`, async () => {
      await updateVariant({
        profileId: selectedProfile.id,
        variantId: variant.id,
        contentId: variant.content_id,
        hook: draft.hook,
        caption: draft.caption,
        cta: draft.cta,
        hashtags: parseHashtags(draft.hashtags),
        visualBrief: draft.visualBrief,
        altText: draft.altText,
      });
      await reload();
    });
  }

  async function approve(variant: ContentVariantRow, approvalStatus: "PENDING" | "APPROVED" | "CHANGES_REQUESTED") {
    if (!selectedProfile) return;
    await run(`approval-${variant.id}`, async () => {
      await setVariantApproval({ profileId: selectedProfile.id, variantId: variant.id, contentId: variant.content_id, approvalStatus });
      await reload();
    });
  }

  async function generateImage(variant: ContentVariantRow) {
    if (!selectedProfile) return;
    const draft = drafts[variant.id] ?? draftFromVariant(variant);
    if (!draft.visualBrief.trim()) {
      setError("Inserisci prima un brief visivo e salvalo.");
      return;
    }
    await run(`image-${variant.id}`, async () => {
      await updateVariant({
        profileId: selectedProfile.id,
        variantId: variant.id,
        contentId: variant.content_id,
        hook: draft.hook,
        caption: draft.caption,
        cta: draft.cta,
        hashtags: parseHashtags(draft.hashtags),
        visualBrief: draft.visualBrief,
        altText: draft.altText,
      });
      const token = await (authClient as typeof authClient & JwtAuth).getJWTToken?.();
      if (!token) throw new Error("Sessione non valida: effettua nuovamente l’accesso.");
      const response = await fetch("/api/generate-image", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          profileId: selectedProfile.id,
          contentVariantId: variant.id,
          provider: variant.provider,
          format: variant.format,
          visualBrief: draft.visualBrief,
          caption: draft.caption,
        }),
      });
      const body = await response.json() as ImageResponse;
      if (!response.ok || !body.asset?.id) throw new Error(body.detail || body.message || body.error || "Immagine non salvata.");
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
  if (loading) return <div className="page-content"><p>Caricamento approvazioni…</p></div>;

  return <div className="page-content">
    <header className="page-header">
      <div><p className="eyebrow">Approvazioni · {selectedProfile.name}</p><h1>Revisione contenuti</h1><p>Modifica, salva e approva ogni variante separatamente. Le modifiche riaprono automaticamente l’approvazione.</p></div>
      <button className="secondary-button" type="button" onClick={() => void reload()}><RefreshCcw size={16} /> Aggiorna</button>
    </header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {items.length === 0 ? <section className="panel empty-approval"><h2>Nessun contenuto in revisione</h2><p>Genera una bozza dalla sezione Contenuti e salvala nelle approvazioni.</p></section> : null}
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
              return <article className="approval-variant" key={variant.id}>
                <header><div><strong>{variant.provider}</strong><span>{variant.format}</span></div><span className={`variant-status variant-${variant.approval_status.toLowerCase()}`}>{statusLabel(variant.approval_status)}</span></header>
                <div className="approval-grid">
                  <label>Hook<input value={draft.hook} onChange={(event) => setDraftField(variant.id, "hook", event.target.value)} /></label>
                  <label>CTA<input value={draft.cta} onChange={(event) => setDraftField(variant.id, "cta", event.target.value)} /></label>
                  <label className="full">Testo<textarea rows={5} value={draft.caption} onChange={(event) => setDraftField(variant.id, "caption", event.target.value)} /></label>
                  <label className="full">Hashtag<input value={draft.hashtags} onChange={(event) => setDraftField(variant.id, "hashtags", event.target.value)} /></label>
                  <label className="full">Brief immagine<textarea rows={3} value={draft.visualBrief} onChange={(event) => setDraftField(variant.id, "visualBrief", event.target.value)} /></label>
                  <label className="full">Alt text<input value={draft.altText} onChange={(event) => setDraftField(variant.id, "altText", event.target.value)} /></label>
                </div>
                {asset ? <figure className="approval-image"><img src={asset.storage_url} alt={draft.altText || "Immagine generata"} /><figcaption>Immagine salvata · {asset.source}</figcaption></figure> : <div className="no-image-state">Nessuna immagine salvata per questa variante.</div>}
                <div className="approval-actions">
                  <button className="secondary-button" type="button" disabled={busy[`save-${variant.id}`]} onClick={() => void saveVariant(variant)}><Save size={16} /> Salva modifiche</button>
                  <button className="secondary-button" type="button" disabled={busy[`image-${variant.id}`]} onClick={() => void generateImage(variant)}><ImageIcon size={16} /> {busy[`image-${variant.id}`] ? "Generazione…" : asset ? "Rigenera immagine" : "Genera e salva immagine"}</button>
                  <button className="approval-button approve" type="button" disabled={busy[`approval-${variant.id}`]} onClick={() => void approve(variant, "APPROVED")}><Check size={16} /> Approva</button>
                  <button className="approval-button changes" type="button" disabled={busy[`approval-${variant.id}`]} onClick={() => void approve(variant, "CHANGES_REQUESTED")}><X size={16} /> Da correggere</button>
                  {variant.approval_status !== "PENDING" && <button className="approval-button pending" type="button" disabled={busy[`approval-${variant.id}`]} onClick={() => void approve(variant, "PENDING")}><Undo2 size={16} /> Riapri</button>}
                </div>
              </article>;
            })}
          </div>
        </section>;
      })}
    </div>
  </div>;
}
