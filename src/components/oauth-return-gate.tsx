import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Hosted Neon Auth finishes Google OAuth by returning a short-lived
 * neon_auth_session_verifier on the app's callback URL. The browser must
 * exchange it with the challenge cookie before RequireAuth checks useSession().
 * No verifier is logged, persisted, or exposed to analytics.
 */
export function OAuthReturnGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"READY" | "EXCHANGING" | "FAILED">(() =>
    typeof window !== "undefined" && new URL(window.location.href).searchParams.has("neon_auth_session_verifier")
      ? "EXCHANGING"
      : "READY",
  );
  const started = useRef(false);

  useEffect(() => {
    if (state !== "EXCHANGING" || started.current) return;
    started.current = true;
    const url = new URL(window.location.href);
    const verifier = url.searchParams.get("neon_auth_session_verifier");
    if (!verifier || verifier.length > 4096) {
      setState("FAILED");
      return;
    }

    // Legacy Google callbacks might still land on /app/dashboard from a
    // browser tab opened before deployment. Complete them on the same server
    // endpoint, rather than issuing a get-session fetch inside React.
    const destination = new URL("/api/oauth/complete", url.origin);
    destination.searchParams.set("neon_auth_session_verifier", verifier);
    window.location.replace(destination.toString());
  }, [state]);

  if (state === "EXCHANGING") {
    return <main className="center-state" role="status" aria-live="polite">Completamento accesso Google…</main>;
  }
  if (state === "FAILED") {
    return <main className="center-state profile-load-error"><section>
      <h1>Accesso Google non completato</h1>
      <p>Il codice di Google non è stato convertito in una sessione valida. Nessun dato del tuo account è stato modificato.</p>
      <a className="primary-button" href="/login">Riprova l'accesso</a>
    </section></main>;
  }
  return <>{children}</>;
}
