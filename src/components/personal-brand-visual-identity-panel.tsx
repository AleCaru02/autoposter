import { useCallback, useEffect, useState } from "react";
import { ImagePlus, RefreshCw, Trash2, UserRoundCheck } from "lucide-react";
import { authenticatedApiToken } from "../lib/auth-token";

type ReferenceItem = {
  id: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  qualityScore: number | null;
  qualityStatus: "PASS" | "REJECTED" | "PENDING";
  qualityReasons: string[];
  createdAt: string;
  previewUrl: string | null;
};

type ReferenceState = {
  references: ReferenceItem[];
  minimumRequired: number;
  maximumAllowed: number;
  passed: number;
  identityStatus: string;
};

type VisualIdentityState = {
  provider: "HIGGSFIELD";
  configured: boolean;
  capabilityStatus: "LIVE_NOT_RUNTIME_VERIFIED";
  identity?: {
    status?: string;
    soul_id?: string | null;
  };
};

type SoulPreflight = {
  operation: "CREATE_SOUL_ID";
  provider: "HIGGSFIELD";
  billable: true;
  providerCallExecuted: false;
  requiresExplicitConfirmation: true;
  canProceed: boolean;
  blockers: string[];
  references: {
    passed: number;
    required: number;
    fingerprint: string | null;
    averageTechnicalQuality: number | null;
  };
  estimatedCost: { usd: number; eur: number };
  budget: {
    higgsfieldCapEur: number;
    higgsfieldSpendEur: number;
    higgsfieldRemainingEur: number;
    projectedRemainingAfterEur: number;
  };
};

function blockerLabel(code: string) {
  if (code === "HIGGSFIELD_NOT_CONFIGURED") return "Higgsfield non configurato";
  if (code === "REFERENCE_IMAGES_INSUFFICIENT") return "Servono altre foto di riferimento valide";
  if (code === "USAGE_LIMIT_REACHED") return "Limite mensile Soul ID raggiunto";
  if (code === "ENTITLEMENT_DISABLED") return "Creazione Soul ID non abilitata";
  if (code.startsWith("AI_BUDGET_")) return "Budget Higgsfield non sufficiente";
  return code;
}

export function PersonalBrandVisualIdentityPanel(props: { profileId: string }) {
  const [state, setState] = useState<ReferenceState | null>(null);
  const [visual, setVisual] = useState<VisualIdentityState | null>(null);
  const [preflight, setPreflight] = useState<SoulPreflight | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const token = await authenticatedApiToken();
    const [refsResponse, visualResponse] = await Promise.all([
      fetch(`/api/personal-brand/reference-images?profileId=${encodeURIComponent(props.profileId)}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      fetch(`/api/personal-brand/visual-identity?profileId=${encodeURIComponent(props.profileId)}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    ]);
    const refs = await refsResponse.json().catch(() => ({})) as ReferenceState & { error?: string };
    const visualBody = await visualResponse.json().catch(() => ({})) as VisualIdentityState & { error?: string };
    if (!refsResponse.ok || !visualResponse.ok) throw new Error(refs.error || visualBody.error || "IDENTITY_LOAD_FAILED");
    setState(refs);
    setVisual(visualBody);
  }, [props.profileId]);

  useEffect(() => { void load().catch(() => setError("Non riesco a caricare l’identità fotografica.")); }, [load]);

  async function upload(files: FileList | null) {
    if (!files?.length || busy) return;
    setBusy(true); setError(null); setPreflight(null);
    try {
      const token = await authenticatedApiToken();
      const form = new FormData();
      form.set("profileId", props.profileId);
      [...files].forEach((file) => form.append("images", file));
      const response = await fetch("/api/personal-brand/reference-images", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "REFERENCE_UPLOAD_FAILED");
      await load();
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "";
      setError(code === "REFERENCE_IMAGE_LIMIT"
        ? "Hai raggiunto il numero massimo di foto di riferimento."
        : code === "REFERENCE_FILE_SIZE_INVALID"
          ? "Una foto supera 5 MB oppure è vuota."
          : "Upload non riuscito. Usa JPG, PNG o WebP fino a 5 MB.");
    } finally { setBusy(false); }
  }

  async function remove(referenceId: string) {
    if (busy) return;
    setBusy(true); setError(null); setPreflight(null);
    try {
      const token = await authenticatedApiToken();
      const response = await fetch("/api/personal-brand/reference-images", {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ profileId: props.profileId, referenceId }),
      });
      if (!response.ok) throw new Error("REFERENCE_DELETE_FAILED");
      await load();
    } catch {
      setError("Non sono riuscito a rimuovere la foto.");
    } finally { setBusy(false); }
  }

  async function checkSoulId() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const token = await authenticatedApiToken();
      const response = await fetch("/api/personal-brand/soul-id/preflight", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ profileId: props.profileId }),
      });
      const body = await response.json().catch(() => ({})) as SoulPreflight & { error?: string };
      if (!response.ok) throw new Error(body.error || "SOUL_PREFLIGHT_FAILED");
      setPreflight(body);
    } catch {
      setError("Non riesco a verificare la preparazione della Soul ID.");
    } finally { setBusy(false); }
  }

  const references = state?.references ?? [];
  const passed = state?.passed ?? 0;
  const required = state?.minimumRequired ?? 3;
  return <section className="panel">
    <div className="panel-heading">
      <div>
        <h2>Identità fotografica</h2>
        <p>Foto private associate solo a questo Personal Brand. Servono per mantenere volto e aspetto coerenti nelle future immagini Higgsfield.</p>
      </div>
      <UserRoundCheck size={20} />
    </div>

    <div className="status-rows">
      <div><span>Higgsfield</span><strong className={visual?.configured ? "status-ok" : "status-wait"}>{visual?.configured ? "Configurato" : "Da configurare"}</strong></div>
      <div><span>Reference valide</span><strong>{passed} / {required} minime</strong></div>
      <div><span>Soul ID</span><strong>{visual?.identity?.status === "COMPLETED" ? "Pronta" : state?.identityStatus === "READY_TO_CREATE" ? "Pronta per la creazione" : "Non ancora pronta"}</strong></div>
      <div><span>Stato runtime</span><strong>{visual?.capabilityStatus ?? "Verifica in corso"}</strong></div>
    </div>

    <p className="field-help">Carica almeno {required} foto nitide e diverse, con il volto ben visibile. La verifica qui è tecnica; la coerenza dell’identità verrà controllata anche sulle immagini generate.</p>
    <div className="form-actions">
      <label className="compact-action" style={{ cursor: busy ? "wait" : "pointer" }}>
        <ImagePlus size={15} /> {busy ? "Elaborazione…" : "Aggiungi foto"}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={busy || references.length >= (state?.maximumAllowed ?? 12)}
          style={{ display: "none" }}
          onChange={(event) => { void upload(event.target.files); event.currentTarget.value = ""; }}
        />
      </label>
      <button className="compact-action" type="button" disabled={busy} onClick={() => void load()}><RefreshCw size={15} /> Aggiorna</button>
      <button className="compact-action" type="button" disabled={busy} onClick={() => void checkSoulId()}>Verifica Soul ID</button>
    </div>

    {error && <p className="form-error" role="alert">{error}</p>}

    {references.length > 0 && <div className="specific-goals-list">
      {references.map((item) => <div className="specific-goal-row" key={item.id}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
          {item.previewUrl && <img src={item.previewUrl} alt="" width={54} height={54} style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 10 }} />}
          <div style={{ minWidth: 0 }}>
            <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{item.filename}</strong>
            <small>{item.width && item.height ? `${item.width}×${item.height}` : "Dimensioni non disponibili"} · {item.qualityStatus === "PASS" ? "Valida" : "Da sostituire"}</small>
          </div>
        </div>
        <button className="icon-button" type="button" aria-label="Rimuovi foto" disabled={busy} onClick={() => void remove(item.id)}><Trash2 size={15} /></button>
      </div>)}
    </div>}

    {preflight && <div className="status-rows">
      <div><span>Provider call eseguita</span><strong>{preflight.providerCallExecuted ? "Sì" : "No"}</strong></div>
      <div><span>Costo stimato Soul ID</span><strong>{preflight.estimatedCost.eur.toFixed(2)} €</strong></div>
      <div><span>Budget Higgsfield residuo</span><strong>{preflight.budget.higgsfieldRemainingEur.toFixed(2)} €</strong></div>
      <div><span>Dopo la Soul ID</span><strong>{preflight.budget.projectedRemainingAfterEur.toFixed(2)} €</strong></div>
      <div><span>Esito preflight</span><strong className={preflight.canProceed ? "status-ok" : "status-wait"}>{preflight.canProceed ? "Pronta, serve conferma" : "Bloccata"}</strong></div>
      {preflight.blockers.map((item) => <p className="field-help" key={item}>{blockerLabel(item)}</p>)}
      {preflight.canProceed && <p className="field-help">Nessun costo è stato sostenuto. La creazione reale della Soul ID resta bloccata finché non viene data una conferma esplicita.</p>}
    </div>}
  </section>;
}
