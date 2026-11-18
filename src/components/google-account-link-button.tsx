import { useEffect, useRef, useState } from "react";
import { authClient } from "../lib/neon-client";

type GoogleIdentity = {
  initialize(options: { client_id: string; nonce: string; auto_select: false; callback: (response: { credential?: string }) => void }): void;
  renderButton(container: HTMLElement, options: { type: "standard"; theme: "outline"; size: "large"; text: "continue_with"; width: number }): void;
};
type GoogleWindow = Window & { google?: { accounts?: { id?: GoogleIdentity } } };
let sdkPromise: Promise<GoogleIdentity> | null = null;

function googleIdentity() {
  const existing = (window as GoogleWindow).google?.accounts?.id;
  if (existing) return Promise.resolve(existing);
  if (!sdkPromise) sdkPromise = new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    const timeout = window.setTimeout(() => finish(), 15000);
    const finish = (identity?: GoogleIdentity) => {
      window.clearTimeout(timeout);
      script.onload = null;
      script.onerror = null;
      if (identity) resolve(identity);
      else { script.remove(); reject(new Error("GOOGLE_IDENTITY_UNAVAILABLE")); }
    };
    script.onload = () => finish((window as GoogleWindow).google?.accounts?.id);
    script.onerror = () => finish();
    document.head.append(script);
  }).catch((error: unknown) => { sdkPromise = null; throw error; });
  return sdkPromise;
}

export function GoogleAccountLinkButton({ onLinked }: { onLinked: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const [phase, setPhase] = useState<"loading" | "ready" | "linking" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const clientId = import.meta.env.VITE_GOOGLE_AUTH_CLIENT_ID as string | undefined;

  useEffect(() => {
    let active = true;
    if (!clientId || !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) return;
    setPhase("loading");
    setError(null);
    const nonce = crypto.randomUUID();
    void googleIdentity().then((identity) => {
      if (!active || !container.current) return;
      identity.initialize({
        client_id: clientId, nonce, auto_select: false,
        callback: (response) => {
          if (!active || busy.current) return;
          if (!response.credential) { setError("Google non ha restituito una conferma valida. Riprova."); return; }
          busy.current = true;
          setPhase("linking");
          setError(null);
          void (async () => {
            try {
              const result = await authClient.linkSocial({ provider: "google", idToken: { token: response.credential!, nonce } });
              if (result.error) throw new Error("GOOGLE_LINK_REJECTED");
              const accounts = await authClient.listAccounts();
              if (accounts.error || !Array.isArray(accounts.data) || !accounts.data.some((account) => account.providerId === "google")) throw new Error("GOOGLE_LINK_UNCONFIRMED");
              if (active) onLinked();
            } catch {
              if (active) { setPhase("ready"); setError("Collegamento non confermato. Usa lo stesso indirizzo Google dell’account e riprova. L’account esistente rimane disponibile."); }
            } finally { busy.current = false; }
          })();
        },
      });
      container.current.replaceChildren();
      identity.renderButton(container.current, { type: "standard", theme: "outline", size: "large", text: "continue_with", width: Math.min(320, container.current.clientWidth) });
      setPhase("ready");
    }).catch(() => { if (active) { setPhase("error"); setError("Impossibile caricare il pulsante Google. Controlla la connessione e riprova."); } });
    return () => { active = false; };
  }, [clientId, onLinked, retry]);

  if (!clientId || !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) return <p role="status">Accesso Google: Da configurare.</p>;
  return <div aria-busy={phase === "linking"}>
    {phase === "loading" && <p role="status">Caricamento del pulsante Google…</p>}
    <div ref={container} inert={phase === "linking"} aria-label="Collega Google al mio account" />
    {phase === "linking" && <p role="status">Verifica del collegamento Google…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {phase === "error" && <button type="button" className="secondary-button" onClick={() => setRetry((value) => value + 1)}>Riprova Google</button>}
  </div>;
}
