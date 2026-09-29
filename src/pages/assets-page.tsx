import { useCallback, useEffect, useMemo, useState } from "react";
import { Images, Link2, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { authenticatedApiToken } from "../lib/auth-token";
import { useProfiles } from "../features/profiles/profile-context";

type AssetRow = {
  id: string;
  content_id: string | null;
  source: string;
  name: string;
  storage_url: string;
  mime_type: string | null;
  provider: "REAL_ASSET" | "OPENAI" | "HIGGSFIELD" | null;
  model: string | null;
  cost_eur: number;
  width: number | null;
  height: number | null;
  format: string | null;
  quality_status: "PENDING" | "PASS" | "BLOCK" | "FAILED";
  identity_status: "NOT_REQUIRED" | "PENDING" | "PASS" | "BLOCK";
  publication_usage: number;
  reuse_count: number;
  created_at: string;
};

type VariantRow = {
  id: string;
  content_id: string;
  provider: string;
  format: string;
  topic: string;
  image_asset_id: string | null;
};

type AssetResponse = { assets?: AssetRow[]; variants?: VariantRow[]; error?: string };

const PROVIDER_LABELS: Record<string,string> = {
  REAL_ASSET:"Foto reale",
  OPENAI:"OpenAI",
  HIGGSFIELD:"Higgsfield",
};

function qualityLabel(value: AssetRow["quality_status"]) {
  if (value === "PASS") return "Pronto";
  if (value === "BLOCK") return "Bloccato";
  if (value === "FAILED") return "Errore";
  return "Da verificare";
}

export function AssetsPage() {
  const { selectedProfile } = useProfiles();
  const [assets,setAssets] = useState<AssetRow[]>([]);
  const [variants,setVariants] = useState<VariantRow[]>([]);
  const [query,setQuery] = useState("");
  const [provider,setProvider] = useState("");
  const [quality,setQuality] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const [selectedVariants,setSelectedVariants] = useState<Record<string,string>>({});

  const load = useCallback(async () => {
    if (!selectedProfile?.id) return;
    setBusy(true); setError(null);
    try {
      const token = await authenticatedApiToken();
      const params = new URLSearchParams({ profileId:selectedProfile.id });
      if (query.trim()) params.set("q",query.trim());
      if (provider) params.set("provider",provider);
      if (quality) params.set("quality",quality);
      const response = await fetch(`/api/assets?${params.toString()}`, {
        headers:{ authorization:`Bearer ${token}`, accept:"application/json" },
      });
      const body = await response.json().catch(()=>({})) as AssetResponse;
      if (!response.ok) throw new Error(body.error || "ASSET_LIBRARY_LOAD_FAILED");
      setAssets(body.assets ?? []);
      setVariants(body.variants ?? []);
    } catch {
      setError("Non riesco a caricare la libreria immagini.");
    } finally { setBusy(false); }
  },[selectedProfile?.id,query,provider,quality]);

  useEffect(()=>{ void load(); },[load]);

  const availableVariants = useMemo(() => variants.filter((item)=>!item.image_asset_id),[variants]);

  async function upload(files: FileList|null) {
    if (!selectedProfile?.id || !files?.length || busy) return;
    setBusy(true); setError(null);
    try {
      const token = await authenticatedApiToken();
      const form = new FormData();
      form.set("profileId",selectedProfile.id);
      [...files].forEach((file)=>form.append("images",file));
      const response = await fetch("/api/assets",{
        method:"POST",
        headers:{authorization:`Bearer ${token}`},
        body:form,
      });
      const body = await response.json().catch(()=>({})) as {error?:string};
      if (!response.ok) {
        const message = body.error === "ASSET_FILE_SIZE_INVALID" ? "Ogni immagine deve pesare massimo 4 MB."
          : body.error === "ASSET_DIMENSIONS_INVALID" ? "L'immagine è troppo piccola o ha dimensioni non valide."
          : body.error === "ASSET_MIME_INVALID" ? "Usa JPG, PNG o WebP."
          : "Upload non riuscito.";
        throw new Error(message);
      }
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Upload non riuscito.");
    } finally { setBusy(false); }
  }

  async function linkAsset(assetId:string) {
    const variantId = selectedVariants[assetId];
    if (!selectedProfile?.id || !variantId || busy) return;
    setBusy(true); setError(null);
    try {
      const token = await authenticatedApiToken();
      const response = await fetch("/api/assets",{
        method:"POST",
        headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},
        body:JSON.stringify({action:"LINK_TO_VARIANT",profileId:selectedProfile.id,assetId,variantId}),
      });
      const body = await response.json().catch(()=>({})) as {error?:string};
      if (!response.ok) throw new Error(body.error === "ASSET_QUALITY_BLOCKED" ? "Questa immagine è bloccata dai controlli qualità." : "Non riesco a collegare l'immagine.");
      setSelectedVariants((current)=>({...current,[assetId]:""}));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Collegamento non riuscito.");
    } finally { setBusy(false); }
  }

  async function removeAsset(assetId:string) {
    if (!selectedProfile?.id || busy) return;
    setBusy(true); setError(null);
    try {
      const token = await authenticatedApiToken();
      const response = await fetch("/api/assets",{
        method:"DELETE",
        headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},
        body:JSON.stringify({profileId:selectedProfile.id,assetId}),
      });
      const body = await response.json().catch(()=>({})) as {error?:string};
      if (!response.ok) throw new Error(body.error === "ASSET_ALREADY_PUBLISHED" ? "Non puoi eliminare un'immagine già usata in una pubblicazione reale." : "Eliminazione non riuscita.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Eliminazione non riuscita.");
    } finally { setBusy(false); }
  }

  if (!selectedProfile) return null;

  return <div className="page-content asset-library-page">
    <header className="page-header">
      <div><p className="eyebrow">Libreria · {selectedProfile.name}</p><h1>Immagini</h1><p>Foto reali e visual generati restano separati per attività e possono essere riutilizzati quando sono adatti.</p></div>
      <label className="primary-button asset-upload-button">
        <Upload size={16}/> Aggiungi immagini
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={(event)=>{void upload(event.target.files);event.currentTarget.value="";}}/>
      </label>
    </header>

    <section className="panel asset-library-toolbar">
      <label className="asset-search"><Search size={16}/><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Cerca immagini…"/></label>
      <select value={provider} onChange={(event)=>setProvider(event.target.value)}>
        <option value="">Tutte le origini</option><option value="real_asset">Foto reali</option><option value="openai">OpenAI</option><option value="higgsfield">Higgsfield</option>
      </select>
      <select value={quality} onChange={(event)=>setQuality(event.target.value)}>
        <option value="">Tutti gli stati</option><option value="pass">Pronte</option><option value="pending">Da verificare</option><option value="block">Bloccate</option><option value="failed">Errore</option>
      </select>
      <button className="compact-action" type="button" disabled={busy} onClick={()=>void load()}><RefreshCw size={15}/> Aggiorna</button>
    </section>

    {error && <p className="form-error" role="alert">{error}</p>}
    {!busy && assets.length===0 && <section className="panel asset-empty"><Images size={26}/><h2>Nessuna immagine ancora</h2><p>Puoi caricare foto reali adesso. I visual generati dai contenuti appariranno qui automaticamente.</p></section>}

    <section className="asset-grid">
      {assets.map((asset)=><article className="asset-card" key={asset.id}>
        <div className="asset-preview"><img src={asset.storage_url} alt={asset.name}/></div>
        <div className="asset-card-body">
          <div className="asset-card-title"><strong>{asset.name}</strong><span>{PROVIDER_LABELS[asset.provider ?? ""] ?? "Immagine"}</span></div>
          <div className="asset-meta">
            <span>{asset.width&&asset.height ? `${asset.width}×${asset.height}` : "Dimensioni n/d"}</span>
            <span>{asset.format ?? "Formato n/d"}</span>
            <span>{qualityLabel(asset.quality_status)}</span>
            <span>{asset.cost_eur > 0 ? `${Number(asset.cost_eur).toFixed(2)} €` : "0 €"}</span>
          </div>
          <p className="asset-usage">Riutilizzi: {asset.reuse_count} · Pubblicazioni: {asset.publication_usage}</p>
          {availableVariants.length>0 && <div className="asset-reuse">
            <select value={selectedVariants[asset.id] ?? ""} onChange={(event)=>setSelectedVariants((current)=>({...current,[asset.id]:event.target.value}))}>
              <option value="">Scegli contenuto…</option>
              {availableVariants.map((variant)=><option key={variant.id} value={variant.id}>{variant.topic} · {variant.provider} {variant.format}</option>)}
            </select>
            <button className="compact-action" type="button" disabled={busy||!selectedVariants[asset.id]} onClick={()=>void linkAsset(asset.id)}><Link2 size={14}/> Usa</button>
          </div>}
          <button className="asset-delete" type="button" disabled={busy||asset.publication_usage>0} onClick={()=>void removeAsset(asset.id)}><Trash2 size={14}/> Elimina</button>
        </div>
      </article>)}
    </section>
  </div>;
}
