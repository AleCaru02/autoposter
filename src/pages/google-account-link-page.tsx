import { useCallback, useEffect, useState } from "react";
import { NavLink, useSearchParams } from "react-router-dom";
import { authClient } from "../lib/neon-client";
import { ProductBrand } from "../components/product-brand";
import { GoogleAccountLinkButton } from "../components/google-account-link-button";

type AccountStatus = "loading" | "linked" | "unlinked" | "error";

export function GoogleAccountLinkPage() {
  const [query] = useSearchParams();
  const [status, setStatus] = useState<AccountStatus>("loading");
  const onLinked = useCallback(() => setStatus("linked"), []);
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
      {callbackFailure && status !== "linked" && <p className="form-error" role="alert">
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
        <GoogleAccountLinkButton onLinked={onLinked} />
      </>}
      <p className="auth-switch"><NavLink to="/app/impostazioni">Torna alle impostazioni</NavLink></p>
      <p className="auth-switch"><NavLink to="/app/dashboard">Apri dashboard</NavLink></p>
    </section>
  </main>;
}
