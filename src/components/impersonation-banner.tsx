import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { authClient } from "../lib/neon-client";

type SessionSnapshot = {
  active: boolean;
  userId: string | null;
  name: string | null;
  email: string | null;
  impersonatedBy: string | null;
};

type StopResponse = {
  impersonation?: {
    active?: boolean;
    actor?: { id?: string };
    target?: { id?: string };
  };
  auditRecorded?: boolean;
};

function snapshotFromBody(body: unknown): SessionSnapshot {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const root = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : record;
  const session = root.session && typeof root.session === "object" ? root.session as Record<string, unknown> : null;
  const user = root.user && typeof root.user === "object" ? root.user as Record<string, unknown> : null;
  const userId = typeof user?.id === "string" ? user.id : null;
  const name = typeof user?.name === "string" && user.name.trim() ? user.name.trim() : null;
  const email = typeof user?.email === "string" && user.email.trim() ? user.email.trim() : null;
  const impersonatedBy = typeof session?.impersonatedBy === "string"
    ? session.impersonatedBy
    : typeof session?.impersonated_by === "string"
      ? session.impersonated_by
      : null;
  return { active: Boolean(session && userId), userId, name, email, impersonatedBy };
}

async function readManagedSession() {
  const response = await fetch("/api/auth/get-session", {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { accept: "application/json", "X-Force-Fetch": "1" },
  });
  if (!response.ok) return { active: false, userId: null, name: null, email: null, impersonatedBy: null } satisfies SessionSnapshot;
  return snapshotFromBody(await response.json());
}

export function ImpersonationBanner() {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void readManagedSession().then((next) => { if (active) setSnapshot(next); }).catch(() => { if (active) setSnapshot(null); });
    return () => { active = false; };
  }, []);

  async function stopImpersonation() {
    if (!snapshot?.active || !snapshot.userId || !snapshot.impersonatedBy || busy) return;
    const targetId = snapshot.userId;
    setBusy(true);
    setError(null);
    try {
      const tokenResult = await authClient.token({ fetchOptions: { headers: { "X-Force-Fetch": "1" } } });
      const token = tokenResult.data?.token;
      if (tokenResult.error || !token) throw new Error("TOKEN_UNAVAILABLE");

      const response = await fetch("/api/admin/impersonation/stop", {
        method: "POST",
        credentials: "include",
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
      const body = await response.json().catch(() => null) as StopResponse | null;
      if (!response.ok || body?.impersonation?.active !== false || !body.impersonation.actor?.id || body.impersonation.target?.id !== targetId) {
        throw new Error("STOP_FAILED");
      }

      const restored = await readManagedSession();
      if (!restored.active || restored.userId !== body.impersonation.actor.id || restored.impersonatedBy) {
        throw new Error("RESTORE_FAILED");
      }

      window.location.assign(`/admin/clienti/${encodeURIComponent(targetId)}`);
    } catch {
      setError("Non è stato possibile terminare la visualizzazione. La sessione resta invariata: riprova.");
      setBusy(false);
    }
  }

  if (!snapshot?.active || !snapshot.userId || !snapshot.impersonatedBy) return null;
  const customerLabel = snapshot.email || snapshot.name || "cliente";

  return <section className="impersonation-banner" role="status" aria-live="polite">
    <div className="impersonation-banner-copy"><ShieldAlert size={20} aria-hidden="true" /><div><strong>Stai visualizzando l'account di {customerLabel}</strong><span>Le azioni di impersonation sono tracciate. L'accesso Admin resta sospeso finché non termini la visualizzazione.</span></div></div>
    <div className="impersonation-banner-actions">
      {error ? <span className="impersonation-stop-error" role="alert">{error}</span> : null}
      <button type="button" onClick={() => { void stopImpersonation(); }} disabled={busy}>{busy ? "Terminazione in corso…" : "Termina visualizzazione"}</button>
    </div>
  </section>;
}
