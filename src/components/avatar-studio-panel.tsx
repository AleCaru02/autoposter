import { useCallback, useEffect, useRef, useState } from "react";
import { BadgeCheck, Camera, LoaderCircle, Mic, ShieldCheck, Trash2, UserRound, Video } from "lucide-react";
import { uploadPresigned } from "@vercel/blob/client";
import { authenticatedApiToken } from "../lib/auth-token";
import { identityConsentText, IDENTITY_CONSENT_VERSION } from "../../api/_lib/avatar/consent-text";
import "../avatar-studio.css";

type Kind = "PHOTO" | "VIDEO" | "VOICE";
type SetupState = "NOT_STARTED" | "MATERIALS_READY" | "SUBMITTED" | "TRAINING" | "READY" | "FAILED" | "REVOKED";
type Asset = { id: string; kind: Kind; status: "PENDING_UPLOAD" | "READY" | "REJECTED"; size_bytes: number | null; duration_seconds: number | null; rejection_reason: string | null; retention_until: string; created_at: string; width: number | null; height: number | null; media?: { checks?: Array<{ code: string; ok: boolean; blocking: boolean; message: string }> } };
type Provider = { id: "HEYGEN" | "HIGGSFIELD_INTONE"; label: string; integrated: boolean; role: string; priceSource: string; materials: string[]; estimate30sUsd: number | null };
type Status = {
  storage: { configured: boolean };
  consent: { subjectName: string; scopes: Array<"FACE" | "VOICE">; grantedAt: string; version: string } | null;
  assets: Asset[];
  setup: { provider: Provider["id"]; face_status: SetupState; voice_status: SetupState; missing: string[]; cost_usd: number; live: { live: boolean; missing: string[] } };
  providers: Provider[];
};

const STATE_LABEL: Record<SetupState, string> = {
  NOT_STARTED: "Da iniziare", MATERIALS_READY: "Materiali pronti", SUBMITTED: "Inviato al provider", TRAINING: "In addestramento", READY: "Pronto", FAILED: "Non riuscito", REVOKED: "Consenso revocato",
};
const MISSING_LABEL: Record<string, string> = {
  CONSENT: "consenso", CONSENT_FACE: "consenso per il volto", CONSENT_VOICE: "consenso per la voce", VIDEO: "video di addestramento", PHOTO: "foto frontale", VOICE: "registrazione della voce",
};
const KIND_LABEL: Record<Kind, string> = { VIDEO: "Video", PHOTO: "Foto", VOICE: "Voce" };
const ACCEPT: Record<Kind, string> = { VIDEO: "video/mp4,video/quicktime,video/webm", PHOTO: "image/jpeg,image/png,image/heic,image/heif,image/webp", VOICE: "audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/aac,audio/webm" };

async function api(path: string, init?: RequestInit) {
  const token = await authenticatedApiToken();
  const response = await fetch(path, { ...init, headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, body };
}

function errorText(code: string) {
  const map: Record<string, string> = {
    IDENTITY_CONSENT_REQUIRED: "Prima registra il consenso.",
    IDENTITY_CONSENT_SCOPE_MISSING: "Il consenso attivo non copre questo tipo di materiale.",
    IDENTITY_CONSENT_ALREADY_ACTIVE: "Esiste già un consenso attivo.",
    IDENTITY_CONSENT_NOT_ACCEPTED: "Devi leggere e accettare il testo del consenso.",
    IDENTITY_CONTENT_TYPE_NOT_ALLOWED: "Formato non supportato.",
    IDENTITY_FILE_TOO_LARGE: "File troppo grande.",
    IDENTITY_STORAGE_NOT_CONFIGURED: "Archivio privato non configurato in questo ambiente.",
    IDENTITY_TOO_MANY_PENDING_UPLOADS: "Troppi caricamenti in sospeso: riprova tra poco.",
  };
  return map[code] ?? `Operazione non riuscita (${code || "errore"}).`;
}

function formatSize(bytes: number | null) {
  if (!bytes) return "";
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function AvatarStudioPanel({ profileId }: { profileId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [subjectName, setSubjectName] = useState("");
  const [scopes, setScopes] = useState<Array<"FACE" | "VOICE">>(["FACE", "VOICE"]);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ kind: Kind; percent: number } | null>(null);
  const [preview, setPreview] = useState<{ assetId: string; kind: Kind; url: string } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);
  const current = useRef(profileId);
  current.current = profileId;

  const refresh = useCallback(async () => {
    const requested = profileId;
    const result = await api(`/api/avatar/status?profileId=${encodeURIComponent(requested)}`);
    if (current.current !== requested) return;
    if (!result.ok) { setLoadError(errorText(String(result.body.error ?? ""))); return; }
    setLoadError(null);
    setStatus(result.body as unknown as Status);
  }, [profileId]);

  useEffect(() => {
    setStatus(null); setPreview(null); setMessage(null); setError(null); setConfirmRevoke(false); setConfirmErase(false);
    void refresh().catch(() => setLoadError("Impossibile caricare lo stato dell'avatar."));
  }, [profileId, refresh]);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label); setError(null); setMessage(null);
    try { await action(); } catch (reason) { setError(reason instanceof Error ? errorText(reason.message) : "Operazione non riuscita."); } finally { setBusy(null); }
  }

  const grant = () => run("consent", async () => {
    const result = await api("/api/avatar/consent", { method: "POST", body: JSON.stringify({ profileId, subjectName, scopes, accepted, version: IDENTITY_CONSENT_VERSION }) });
    if (!result.ok) throw new Error(String(result.body.error ?? ""));
    await refresh();
    setMessage("Consenso registrato. Ora puoi caricare i materiali.");
  });

  const revoke = (deleteMaterials: boolean) => run("revoke", async () => {
    const result = await api("/api/avatar/consent/revoke", { method: "POST", body: JSON.stringify({ profileId, deleteMaterials }) });
    if (!result.ok) throw new Error(String(result.body.error ?? ""));
    setConfirmRevoke(false); setPreview(null);
    await refresh();
    setMessage(deleteMaterials ? `Consenso revocato e ${String(result.body.deletedFiles ?? 0)} file eliminati.` : "Consenso revocato: nessuna nuova generazione è possibile.");
  });

  const chooseProvider = (provider: Provider["id"]) => run("provider", async () => {
    const result = await api("/api/avatar/provider", { method: "POST", body: JSON.stringify({ profileId, provider }) });
    if (!result.ok) throw new Error(String(result.body.error ?? ""));
    await refresh();
  });

  const upload = (kind: Kind, file: File) => run(`upload-${kind}`, async () => {
    const contentType = (file.type || "").toLowerCase();
    const prepared = await api("/api/avatar/assets/prepare", { method: "POST", body: JSON.stringify({ profileId, kind, contentType, sizeBytes: file.size }) });
    if (!prepared.ok) throw new Error(String(prepared.body.error ?? ""));
    const { assetId, pathname } = prepared.body as { assetId: string; pathname: string };
    const token = await authenticatedApiToken();
    setProgress({ kind, percent: 0 });
    await uploadPresigned(pathname, file, {
      access: "private",
      handleUploadUrl: "/api/avatar/upload",
      headers: { authorization: `Bearer ${token}` },
      clientPayload: JSON.stringify({ profileId, assetId }),
      contentType,
      multipart: file.size > 50 * 1024 * 1024,
      onUploadProgress: (event) => setProgress({ kind, percent: Math.round(event.percentage) }),
    });
    setProgress(null);
    const completed = await api("/api/avatar/assets/complete", { method: "POST", body: JSON.stringify({ profileId, assetId }) });
    if (!completed.ok) throw new Error(String(completed.body.error ?? ""));
    await refresh();
    setMessage(completed.body.status === "READY" ? `${KIND_LABEL[kind]} caricato e verificato.` : `${KIND_LABEL[kind]} caricato ma non idoneo: ${String(completed.body.rejection ?? "")}`);
  }).finally(() => setProgress(null));

  const showPreview = (asset: Asset) => run(`preview-${asset.id}`, async () => {
    const result = await api("/api/avatar/assets/url", { method: "POST", body: JSON.stringify({ profileId, assetId: asset.id }) });
    if (!result.ok) throw new Error(String(result.body.error ?? ""));
    setPreview({ assetId: asset.id, kind: asset.kind, url: String(result.body.url) });
  });

  const remove = (asset: Asset) => run(`delete-${asset.id}`, async () => {
    const result = await api("/api/avatar/assets/delete", { method: "POST", body: JSON.stringify({ profileId, assetId: asset.id }) });
    if (!result.ok) throw new Error(String(result.body.error ?? ""));
    if (preview?.assetId === asset.id) setPreview(null);
    await refresh();
    setMessage(`${KIND_LABEL[asset.kind]} eliminato dall'archivio privato.`);
  });

  const erase = () => run("erase", async () => {
    const result = await api("/api/avatar/erase", { method: "POST", body: JSON.stringify({ profileId }) });
    if (!result.ok) throw new Error(String(result.body.error ?? ""));
    setConfirmErase(false); setPreview(null);
    await refresh();
    setMessage(`Eliminati ${String(result.body.deletedFiles ?? 0)} file dall'archivio privato.`);
  });

  const consent = status?.consent ?? null;
  const consentText = identityConsentText(subjectName || "…", scopes.length ? scopes : ["FACE"]);
  const provider = status?.providers.find((item) => item.id === status.setup.provider);

  return <section className="panel avatar-studio" aria-labelledby="avatar-studio-title">
    <header className="avatar-studio-header">
      <UserRound size={22} aria-hidden="true" />
      <div>
        <p className="eyebrow">Personal brand · avatar</p>
        <h2 id="avatar-studio-title">Il tuo avatar con volto e voce</h2>
        <p>Consenso esplicito e revocabile, materiali in un archivio privato separato per questa attività, nessuna generazione a pagamento senza la tua autorizzazione.</p>
      </div>
    </header>

    {loadError && <p className="form-error" role="alert">{loadError}</p>}
    {!status && !loadError && <p className="field-help"><LoaderCircle className="spin" size={14} /> Caricamento…</p>}

    {status && <>
      <div className="avatar-status-grid" role="status">
        <div><span>Volto</span><strong className={`avatar-state avatar-state-${status.setup.face_status.toLowerCase()}`}>{STATE_LABEL[status.setup.face_status]}</strong></div>
        <div><span>Voce</span><strong className={`avatar-state avatar-state-${status.setup.voice_status.toLowerCase()}`}>{STATE_LABEL[status.setup.voice_status]}</strong></div>
        <div><span>Spesa avatar</span><strong>{status.setup.cost_usd.toFixed(2).replace(".", ",")} $</strong></div>
      </div>
      {status.setup.missing.length > 0 && <p className="field-help">Manca: {status.setup.missing.map((item) => MISSING_LABEL[item] ?? item).join(", ")}.</p>}
      {!status.storage.configured && <p className="manual-warning">Archivio privato non configurato in questo ambiente: il caricamento è disattivato.</p>}

      <div className="avatar-block">
        <h3><ShieldCheck size={16} aria-hidden="true" /> 1. Consenso</h3>
        {consent ? <div className="avatar-consent-active">
          <p><BadgeCheck size={15} aria-hidden="true" /> Consenso attivo di <strong>{consent.subjectName}</strong> per {consent.scopes.map((scope) => (scope === "FACE" ? "volto" : "voce")).join(" e ")} · {new Date(consent.grantedAt).toLocaleDateString("it-IT")} · versione {consent.version}</p>
          {!confirmRevoke ? <button className="secondary-button" type="button" onClick={() => setConfirmRevoke(true)} disabled={Boolean(busy)}>Revoca consenso</button> : <div className="avatar-confirm">
            <p>La revoca blocca subito nuove generazioni e annulla i Reel avatar in corso.</p>
            <button className="danger-button" type="button" onClick={() => void revoke(true)} disabled={Boolean(busy)}>Revoca ed elimina materiali e video avatar</button>
            <button className="secondary-button" type="button" onClick={() => void revoke(false)} disabled={Boolean(busy)}>Revoca e conserva i materiali</button>
            <button className="text-button" type="button" onClick={() => setConfirmRevoke(false)}>Annulla</button>
          </div>}
        </div> : <form className="avatar-consent-form" onSubmit={(event) => { event.preventDefault(); void grant(); }}>
          <label>Nome e cognome della persona ritratta
            <input value={subjectName} onChange={(event) => setSubjectName(event.target.value)} autoComplete="name" required minLength={2} maxLength={120} />
          </label>
          <fieldset><legend>Autorizzo l'uso di</legend>
            {(["FACE", "VOICE"] as const).map((scope) => <label className="avatar-check" key={scope}>
              <input type="checkbox" checked={scopes.includes(scope)} onChange={(event) => setScopes((value) => event.target.checked ? [...new Set([...value, scope])] : value.filter((item) => item !== scope))} />
              {scope === "FACE" ? "il mio volto" : "la mia voce"}
            </label>)}
          </fieldset>
          <p className="avatar-consent-text">{consentText}</p>
          <label className="avatar-check"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /> Ho letto e accetto (versione {IDENTITY_CONSENT_VERSION})</label>
          <button className="primary-button" type="submit" disabled={!accepted || subjectName.trim().length < 2 || !scopes.length || Boolean(busy)}>{busy === "consent" ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />} Registra consenso</button>
        </form>}
      </div>

      <div className="avatar-block">
        <h3>2. Provider</h3>
        <div className="avatar-providers">
          {status.providers.map((item) => <label key={item.id} className={`avatar-provider ${status.setup.provider === item.id ? "is-selected" : ""}`}>
            <input type="radio" name={`provider-${profileId}`} checked={status.setup.provider === item.id} onChange={() => void chooseProvider(item.id)} disabled={Boolean(busy)} />
            <span><strong>{item.label}</strong>{item.role === "PRIMARY" ? " · prima scelta" : " · alternativa"}<small>{item.estimate30sUsd !== null ? `circa ${item.estimate30sUsd.toFixed(2).replace(".", ",")} $ per 30 s (riserva con margine)` : "prezzo in crediti, non pubblicato"} · {item.integrated ? "collegamento pronto, disattivato" : "non integrato"}</small></span>
          </label>)}
        </div>
        {provider && <ul className="avatar-requirements">{provider.materials.map((item) => <li key={item}>{item}</li>)}</ul>}
        <p className="field-help">Generazione con il provider: {status.setup.live.live ? "attiva" : "disattivata finché non la autorizzi"}. Nessun credito o abbonamento viene usato.</p>
      </div>

      <div className="avatar-block">
        <h3>3. Materiali privati</h3>
        <div className="avatar-uploads">
          {(["VIDEO", "PHOTO", "VOICE"] as const).map((kind) => {
            const allowed = Boolean(consent) && status.storage.configured && (kind === "VOICE" ? consent?.scopes.includes("VOICE") : consent?.scopes.includes("FACE"));
            const Icon = kind === "VIDEO" ? Video : kind === "PHOTO" ? Camera : Mic;
            return <label key={kind} className={`avatar-upload ${allowed ? "" : "is-disabled"}`}>
              <Icon size={18} aria-hidden="true" />
              <span>{KIND_LABEL[kind]}{kind === "VIDEO" ? " (2–5 min, 1080p)" : kind === "PHOTO" ? " (frontale)" : " (parlato pulito)"}</span>
              <input type="file" accept={ACCEPT[kind]} disabled={!allowed || Boolean(busy)} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(kind, file); }} />
            </label>;
          })}
        </div>
        {progress && <div className="reel-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-label={`Caricamento ${KIND_LABEL[progress.kind]}`}>
          <div className="reel-progress-bar"><span style={{ width: `${progress.percent}%` }} /></div>
          <small>Caricamento {KIND_LABEL[progress.kind].toLowerCase()} · {progress.percent}%</small>
        </div>}
        {!status.assets.length && <p className="field-help">Nessun materiale caricato.</p>}
        <ul className="avatar-assets">
          {status.assets.map((asset) => <li key={asset.id} className={`avatar-asset avatar-asset-${asset.status.toLowerCase()}`}>
            <div>
              <strong>{KIND_LABEL[asset.kind]}</strong>
              <small>{asset.status === "READY" ? "Verificato" : asset.status === "REJECTED" ? "Non idoneo" : "Caricamento incompleto"}{asset.duration_seconds ? ` · ${Math.round(asset.duration_seconds)} s` : ""}{asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}{asset.size_bytes ? ` · ${formatSize(asset.size_bytes)}` : ""} · conservato fino al {new Date(asset.retention_until).toLocaleDateString("it-IT")}</small>
              {asset.rejection_reason && <small className="form-error">{asset.rejection_reason}</small>}
              {asset.media?.checks?.filter((check) => !check.ok && !check.blocking).map((check) => <small key={check.code} className="field-help">Consiglio: {check.message}</small>)}
            </div>
            <div className="avatar-asset-actions">
              {asset.status !== "PENDING_UPLOAD" && <button className="secondary-button" type="button" onClick={() => void showPreview(asset)} disabled={Boolean(busy)}>Anteprima</button>}
              <button className="icon-button" type="button" aria-label={`Elimina ${KIND_LABEL[asset.kind]}`} onClick={() => void remove(asset)} disabled={Boolean(busy)}><Trash2 size={16} /></button>
            </div>
          </li>)}
        </ul>
        {preview && <figure className="avatar-preview">
          {preview.kind === "VIDEO" && <video src={preview.url} controls playsInline preload="metadata" />}
          {preview.kind === "PHOTO" && <img src={preview.url} alt="Anteprima della foto caricata" />}
          {preview.kind === "VOICE" && <audio src={preview.url} controls preload="metadata" />}
          <figcaption>Link temporaneo valido 5 minuti · archivio privato</figcaption>
        </figure>}
        {status.assets.length > 0 && (!confirmErase ? <button className="text-button" type="button" onClick={() => setConfirmErase(true)} disabled={Boolean(busy)}>Elimina tutti i materiali</button> : <div className="avatar-confirm">
          <p>Elimina definitivamente dall'archivio privato tutti i materiali e i video avatar generati per questa attività.</p>
          <button className="danger-button" type="button" onClick={() => void erase()} disabled={Boolean(busy)}>Conferma eliminazione</button>
          <button className="text-button" type="button" onClick={() => setConfirmErase(false)}>Annulla</button>
        </div>)}
      </div>

      <p className="field-help">4. Anteprima: nel pannello Reel qui sotto scegli "Con il mio avatar". In questo ambiente l'anteprima è simulata con il tuo video caricato (costo 0) e passa da Revisioni prima di qualsiasi approvazione.</p>
    </>}

    {message && <p className="avatar-message" role="status">{message}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
