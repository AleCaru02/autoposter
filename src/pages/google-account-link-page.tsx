import { useEffect, useState } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import { authClient } from "../lib/neon-client";
import { ProductBrand } from "../components/product-brand";

type AccountStatus = "loading" | "linked" | "unlinked" | "error";

export function GoogleAccountLinkPage() {
  const [query] = useSearchParams();
  const [status, setStatus] = useState<AccountStatus>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const callbackFailure = query.get("oauth");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await authClient.listAccounts();
        if (!active) return;
        if (result.error || !Array.isArray(result.data)) {
          setStatus("error");
          return;
        }
        const connected = result.data.some((account) => account.providerId === "google");
        setStatus(connected ? "linked" : "unlinked");
      } catch {
        if (active) setStatus("error");
      }
    })();
    return () => { active = false; };
  }, []);

  async function connectGoogle() {
    if (busy || status !== "unlinked") return;
    setBusy(true);
    setError(null);
    try {
      // Linking requires a *current authenticated session*. Unlike signIn.social,
      // this attaches Google to the verified identity already signed in.
      // We never auto-link merely because Google returns the same email.
      const result = await authClient.linkSocial({
        provider: "google",
        callbackURL: `${window.location.origin}/api/oauth/complete?after=link`,
      });
      if (result.error) {
        setError("Il provider non ha consentito il collegamento. L'account originale rimane invariato.");
        setBusy(false);
      }
    } catch {
      setError("Non è stato possibile avviare Google. Riprova senza creare nuovi account.");
      setBusy(false);
    }
  }

  return <main className="auth-page">
    <section className="auth-card">
      <div className="auth-brand">
        <ProductBrand />
        <p>Collega Google al tuo account esistente.</p>
      </div>
      <h1>Collega il tuo account Google</h1>
      <p className="auth-subtitle">
        Hai già effettuato l'accesso con email e password. Puoi aggiungere Google allo stesso account
        senza cancellare progetti, cambiare password o creare una seconda identità.
      </p>
      {callbackFailure && <p className="form-error" role="alert">
        Il collegamento Google non è riuscito (codice: {callbackFailure.replace(/[^a-z_]/g, "").slice(0, 60)}).
        Nessun account è stato cancellato.
      </p>}
      {status === "loading" && <p role="status">Verifica dei metodi di accesso…</p>}
      {status === "error" && <p className="form-error" role="alert">
        Impossibile leggere i metodi di accesso dal servizio Neon. Non viene effettuato alcun collegamento.
      </p>}
      {status === "linked" && <p role="status">
        Google risulta collegato al tuo account. Ora puoi accedere anche con Continua con Google.
      </p>}
      {status === "unlinked" && <>
        <p>Google non è ancora collegato. Premi il pulsante e conferma l'accesso con lo stesso indirizzo Google.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button" type="button" disabled={busy} onClick={() => void connectGoogle()}>
          {busy ? "Collegamento a Google…" : "Collega Google al mio account"}
        </button>
      </>}
      <p className="auth-switch"><NavLink to="/app/impostazioni">Torna alle impostazioni</NavLink></p>
      <p className="auth-switch"><NavLink to="/app/dashboard">Apri dashboard</NavLink></p>
    </section>
  </main>;
}
