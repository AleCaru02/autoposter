import { useEffect, useMemo, useState } from "react";
import { Eye } from "lucide-react";
import { useLocation } from "react-router-dom";
import { adminRequest } from "../lib/admin-api";
import { authClient } from "../lib/neon-client";

type Customer = {
  auth_user_id: string;
  name: string | null;
  email: string | null;
  platform_role: "CUSTOMER" | "SUPER_ADMIN";
  banned: boolean | null;
};

type CustomerDetailResponse = { customer: Customer };
type StartResponse = {
  impersonation?: {
    active?: boolean;
    actor?: { id?: string };
    target?: { id?: string; email?: string | null; name?: string | null };
  };
  auditRecorded?: boolean;
};

function customerIdFromPath(pathname: string) {
  const match = pathname.match(/^\/admin\/clienti\/([^/]+)\/?$/);
  if (!match?.[1]) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

export function AdminImpersonationRouteAction() {
  const location = useLocation();
  const session = authClient.useSession();
  const targetId = useMemo(() => customerIdFromPath(location.pathname), [location.pathname]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setCustomer(null);
    setDialogOpen(false);
    setError(null);
    if (!targetId) return () => { active = false; };
    void adminRequest<CustomerDetailResponse>(`/api/admin/customers/${encodeURIComponent(targetId)}`)
      .then((body) => { if (active && body.customer?.auth_user_id === targetId) setCustomer(body.customer); })
      .catch(() => { if (active) setCustomer(null); });
    return () => { active = false; };
  }, [targetId]);

  const currentAdminId = typeof session.data?.user?.id === "string" ? session.data.user.id : null;
  const visible = Boolean(
    targetId &&
    customer &&
    currentAdminId &&
    customer.auth_user_id === targetId &&
    customer.auth_user_id !== currentAdminId &&
    customer.platform_role === "CUSTOMER" &&
    customer.banned !== true,
  );

  async function confirmStart() {
    if (!visible || !targetId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await adminRequest<StartResponse>(`/api/admin/customers/${encodeURIComponent(targetId)}/impersonate`, { method: "POST" });
      if (response.impersonation?.active !== true || response.impersonation.target?.id !== targetId || response.impersonation.actor?.id !== currentAdminId) {
        throw new Error("IMPERSONATION_START_MISMATCH");
      }
      window.location.assign("/app/dashboard");
    } catch {
      setError("Impossibile avviare la visualizzazione cliente. La sessione Admin non è stata presentata come modificata.");
      setBusy(false);
    }
  }

  if (!visible || !customer) return null;
  const label = customer.name || customer.email || "questo cliente";

  return <>
    <button type="button" className="admin-impersonation-launcher" onClick={() => { if (!busy) { setError(null); setDialogOpen(true); } }}><Eye size={18} aria-hidden="true" />Visualizza come cliente</button>
    {dialogOpen ? <div className="admin-modal-backdrop" role="presentation">
      <div className="admin-modal admin-impersonation-modal" role="dialog" aria-modal="true" aria-labelledby="impersonation-confirm-title" tabIndex={-1} onKeyDown={(event) => { if (event.key === "Escape" && !busy) setDialogOpen(false); }}>
        <h2 id="impersonation-confirm-title">Visualizza come questo cliente?</h2>
        <p>Entrerai temporaneamente nell'account di <strong>{label}</strong>. Le azioni relative all'impersonation sono tracciate e puoi terminare la visualizzazione in qualsiasi momento.</p>
        {error ? <div className="admin-inline-error admin-impersonation-error" role="alert">{error}</div> : null}
        <div className="admin-modal-actions">
          <button type="button" className="secondary" onClick={() => { if (!busy) setDialogOpen(false); }} disabled={busy} autoFocus>Annulla</button>
          <button type="button" className="admin-impersonation-confirm" onClick={() => { void confirmStart(); }} disabled={busy}>{busy ? "Accesso in corso…" : "Visualizza come cliente"}</button>
        </div>
      </div>
    </div> : null}
  </>;
}
