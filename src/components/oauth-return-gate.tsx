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

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    void (async () => {
      try {
        const request = new URL("/api/auth/get-session", url.origin);
        request.searchParams.set("neon_auth_session_verifier", verifier);
        const response = await fetch(request.pathname + request.search, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) {
          setState("FAILED");
          return;
        }
        // The verifier exchange can succeed even without returning the final
        // session JSON. Check the actual first-party cookie in a fresh read.
        const check = await fetch("/api/auth/get-session?disableCookieCache=true", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        const confirmed = await check.json().catch(() => null) as { session?: unknown; user?: unknown } | null;
        if (!check.ok || !confirmed?.session || !confirmed.user) {
          setState("FAILED");
          return;
        }
        // Remove the one-time verifier before the app, analytics or any
        // protected routes render; a full navigation refreshes useSession().
        url.searchParams.delete("neon_auth_session_verifier");
        window.location.replace(url.toString());
      } catch {
        setState("FAILED");
      } finally {
        window.clearTimeout(timeout);
      }
    })();

    return () => window.clearTimeout(timeout);
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
