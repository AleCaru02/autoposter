import { useState } from "react";
import { adminRequest } from "../lib/admin-api";
import "../admin-ban.css";

type BanState = {
  banned: boolean;
  reason: string | null;
  expiresAt: string | null;
};

type BanMutationResponse = {
  customer: {
    id: string;
    banned: boolean;
    reason: string | null;
    expiresAt: string | null;
  };
  auditRecorded?: boolean;
  sessionRevocation?: { ok: boolean; revokedCount: number };
};

type BanDialog = "BAN" | "UNBAN" | null;

function formatBanDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Rome",
  }).format(date);
}

function toDateTimeLocal(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function AdminBanPanel({
  customerId,
  customerName,
  initialBanned,
  initialReason,
  initialExpiresAt,
}: {
  customerId: string;
  customerName: string;
  initialBanned: boolean;
  initialReason: string | null;
  initialExpiresAt: string | null;
}) {
  const endpoint = customerId ? `/api/admin/customers/${encodeURIComponent(customerId)}` : null;
  const [state, setState] = useState<BanState>({ banned: initialBanned, reason: initialReason, expiresAt: initialExpiresAt });
  const [dialog, setDialog] = useState<BanDialog>(null);
  const [reason, setReason] = useState("");
  const [expiresAtLocal, setExpiresAtLocal] = useState("");
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const expiryLabel = formatBanDate(state.expiresAt);
  const minExpiry = toDateTimeLocal(new Date(Date.now() + 60_000));
  const maxExpiry = toDateTimeLocal(new Date(Date.now() + 366 * 24 * 60 * 60 * 1000));

  function openBanDialog() {
    if (!endpoint || busy) return;
    setMutationError(null);
    setFeedback(null);
    setReason("");
    setExpiresAtLocal("");
    setDialog("BAN");
  }

  function openUnbanDialog() {
    if (!endpoint || busy) return;
    setMutationError(null);
    setFeedback(null);
    setDialog("UNBAN");
  }

  function closeDialog() {
    if (!busy) setDialog(null);
  }

  async function confirmBan() {
    if (!endpoint || dialog !== "BAN" || busy) return;
    const trimmedReason = reason.trim();
    if (trimmedReason.length > 500) {
      setMutationError("Il motivo non può superare 500 caratteri.");
      return;
    }

    let expiresAt: string | null = null;
    if (expiresAtLocal) {
      const parsed = new Date(expiresAtLocal);
      if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now() || parsed.getTime() - Date.now() > 366 * 24 * 60 * 60 * 1000) {
        setMutationError("La scadenza deve essere futura e non oltre 366 giorni.");
        return;
      }
      expiresAt = parsed.toISOString();
    }

    setBusy(true);
    setMutationError(null);
    setFeedback(null);
    try {
      const body: { reason?: string; expiresAt?: string } = {};
      if (trimmedReason) body.reason = trimmedReason;
      if (expiresAt) body.expiresAt = expiresAt;
      const response = await adminRequest<BanMutationResponse>(`${endpoint}/ban`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!response.customer || response.customer.id !== customerId || response.customer.banned !== true) {
        throw new Error("BAN_STATE_NOT_CONFIRMED");
      }
      setState({
        banned: true,
        reason: response.customer.reason,
        expiresAt: response.customer.expiresAt,
      });
      setDialog(null);
      if (response.sessionRevocation?.ok === false || response.auditRecorded === false) {
        const missing = [response.sessionRevocation?.ok === false ? "revoca sessioni" : null, response.auditRecorded === false ? "audit" : null].filter(Boolean).join(" e ");
        setFeedback(`Account bloccato, ma ${missing} non è stato confermato. Controlla l’Audit prima di considerare conclusa l’operazione.`);
      } else {
        setFeedback("Account bloccato. Le nuove autenticazioni sono negate e le sessioni esistenti sono state revocate dal backend.");
      }
    } catch {
      setMutationError("Blocco non riuscito o non confermato dal backend. Lo stato mostrato non è stato modificato.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmUnban() {
    if (!endpoint || dialog !== "UNBAN" || busy) return;
    setBusy(true);
    setMutationError(null);
    setFeedback(null);
    try {
      const response = await adminRequest<BanMutationResponse>(`${endpoint}/unban`, { method: "POST" });
      if (!response.customer || response.customer.id !== customerId || response.customer.banned !== false) {
        throw new Error("UNBAN_STATE_NOT_CONFIRMED");
      }
      setState({ banned: false, reason: null, expiresAt: null });
      setDialog(null);
      setFeedback(response.auditRecorded === false
        ? "Account riattivato, ma la registrazione Audit non è stata confermata. Verifica l’Audit amministrativo."
        : "Account riattivato. Il cliente può autenticarsi di nuovo.");
    } catch {
      setMutationError("Riattivazione non riuscita o non confermata dal backend. Lo stato mostrato non è stato modificato.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="admin-section admin-ban-panel" aria-labelledby="account-access-title">
    <div className="admin-section-heading">
      <div>
        <h2 id="account-access-title">Accesso account</h2>
        <p>Ban/Unban usa esclusivamente lo stato nativo Neon Managed Auth. Il blocco non modifica attività, profili o membership del cliente.</p>
      </div>
      {state.banned
        ? <button type="button" className="admin-safe-button" onClick={openUnbanDialog} disabled={!endpoint || busy}>Riattiva account</button>
        : <button type="button" className="admin-danger-button" onClick={openBanDialog} disabled={!endpoint || busy}>Blocca account</button>}
    </div>

    {feedback ? <div className="admin-inline-success" role="status">{feedback}</div> : null}
    {mutationError ? <div className="admin-inline-error admin-ban-error" role="alert">{mutationError}</div> : null}

    <div className="admin-ban-state">
      <div className="admin-ban-status-line">
        <span>Stato</span>
        <span className={`admin-badge ${state.banned ? "danger" : "admin"}`}>{state.banned ? "Sospeso" : "Attivo"}</span>
      </div>
      {state.banned ? <div className="admin-ban-meta">
        <div><span>Durata</span><strong>{expiryLabel ? `Fino al ${expiryLabel}` : "Senza scadenza"}</strong></div>
        <div><span>Motivo</span><strong>{state.reason || "Non indicato"}</strong></div>
      </div> : <p className="admin-muted">L’account non è bloccato.</p>}
    </div>

    {dialog === "BAN" ? <div className="admin-modal-backdrop" role="presentation">
      <div className="admin-modal admin-ban-modal" role="dialog" aria-modal="true" aria-labelledby="ban-confirm-title" tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape" && !busy) closeDialog(); }}>
        <h2 id="ban-confirm-title">Blocca {customerName || "questo account"}</h2>
        <p>Il cliente verrà disconnesso e non potrà effettuare nuovi login finché il ban è attivo. L’operazione non elimina i suoi dati.</p>
        <div className="admin-ban-form">
          <label>Motivo opzionale<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={4} disabled={busy} placeholder="Motivo amministrativo, massimo 500 caratteri" /></label>
          <label>Scadenza opzionale<input type="datetime-local" value={expiresAtLocal} onChange={(event) => setExpiresAtLocal(event.target.value)} min={minExpiry} max={maxExpiry} disabled={busy} /></label>
          <span className="admin-ban-help">Lascia la scadenza vuota per un ban senza scadenza. Il backend valida comunque motivo e durata.</span>
        </div>
        <div className="admin-ban-warning">Conferma solo se vuoi realmente bloccare l’accesso dell’utente.</div>
        <div className="admin-modal-actions">
          <button type="button" className="secondary" onClick={closeDialog} disabled={busy} autoFocus>Annulla</button>
          <button type="button" className="danger" onClick={() => { void confirmBan(); }} disabled={busy}>{busy ? "Blocco in corso…" : "Conferma blocco"}</button>
        </div>
      </div>
    </div> : null}

    {dialog === "UNBAN" ? <div className="admin-modal-backdrop" role="presentation">
      <div className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="unban-confirm-title" tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape" && !busy) closeDialog(); }}>
        <h2 id="unban-confirm-title">Riattiva {customerName || "questo account"}</h2>
        <p>Il ban verrà rimosso. Il cliente potrà autenticarsi nuovamente; le vecchie sessioni revocate non vengono ripristinate.</p>
        <div className="admin-modal-actions">
          <button type="button" className="secondary" onClick={closeDialog} disabled={busy} autoFocus>Annulla</button>
          <button type="button" className="danger" onClick={() => { void confirmUnban(); }} disabled={busy}>{busy ? "Riattivazione in corso…" : "Conferma riattivazione"}</button>
        </div>
      </div>
    </div> : null}
  </section>;
}
