import { AlertTriangle, CheckCircle2, Link2, LoaderCircle, RefreshCw, Share2, Unplug } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { authClient } from "../lib/neon-client";
import { authenticatedApiToken } from "../lib/auth-token";
import { socialProviderUiLabel, socialProviderUiState } from "../lib/social-status-view";
import { useProfiles } from "../features/profiles/profile-context";

type Provider = "INSTAGRAM" | "FACEBOOK" | "LINKEDIN" | "GBP";
type Candidate = { id: string; name: string; accountId?: string; accountType?: string; pageId?: string; username?: string; kind?: string };
type ProviderStatus = {
  provider: Provider;
  configured: boolean;
  status: string;
  accountId: string | null;
  accountName: string | null;
  permissions: string[];
  expiresAt: string | null;
  lastValidatedAt: string | null;
  candidates: Candidate[];
  accountType: string | null;
  capabilities: { publish: string[]; note: string };
  readiness: { state: "PASS_REAL" | "USER_ACTION_REQUIRED" | "BLOCKED_PROVIDER" | "NOT_SUPPORTED_BY_PROVIDER" | "FAIL"; detail: string };
};
type StatusResponse = {
  providers: ProviderStatus[];
  linkedinOrganizationMode?: boolean;
  publishingBaseUrlConfigured?: boolean;
  error?: string;
};

type SessionData = { session?: { token?: string | null }; token?: string | null; access_token?: string | null };

const PROVIDER_LABELS: Record<Provider, string> = {
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  LINKEDIN: "LinkedIn",
  GBP: "Google Business Profile",
};

const PROVIDER_DESCRIPTIONS: Record<Provider, string> = {
  INSTAGRAM: "Account professionale Instagram collegato a Meta.",
  FACEBOOK: "Pagina Facebook che amministri.",
  LINKEDIN: "Profilo LinkedIn oppure Pagina aziendale quando l’accesso Community Management è abilitato.",
  GBP: "Sede Google Business Profile che gestisci.",
};

const READINESS_LABELS: Record<ProviderStatus["readiness"]["state"], string> = { PASS_REAL: "PASS REAL", USER_ACTION_REQUIRED: "AZIONE RICHIESTA", BLOCKED_PROVIDER: "BLOCCATO PROVIDER", NOT_SUPPORTED_BY_PROVIDER: "NON SUPPORTATO", FAIL: "ERRORE REALE" };

function readableError(value: string) {
  if (value === "MISSING_PERMISSIONS" || value.startsWith("MISSING_PERMISSIONS:")) return "Non hai autorizzato tutti i permessi richiesti. Premi Ricollega e accettali per attivare anche Analytics.";
  const map: Record<string, string> = {
    PROVIDER_NOT_CONFIGURED: "Questo collegamento non è ancora disponibile. Contatta l’assistenza.",
    PROFILE_NOT_FOUND: "Non riesco a trovare l’attività selezionata. Ricarica la pagina e riprova.",
    PROFILE_ACCESS_CHECK_FAILED: "Non riesco a verificare l’attività in questo momento. Riprova tra poco.",
    SOCIAL_SECURITY_NOT_CONFIGURED: "Questo collegamento non è ancora disponibile. Contatta l’assistenza.",
    NESSUN_ACCOUNT_INSTAGRAM_PROFESSIONALE_COLLEGATO_A_UNA_PAGINA: "Non trovo un account Instagram professionale collegato a una Pagina Facebook gestibile.",
    NESSUNA_PAGINA_FACEBOOK_GESTIBILE: "Non trovo Pagine Facebook gestibili con questo account.",
    NESSUNA_PAGINA_LINKEDIN_AMMINISTRATA_O_ACCESSO_COMMUNITY_MANAGEMENT_NON_ATTIVO: "Non trovo una Pagina LinkedIn amministrata oppure l’app non ha ancora l’accesso Community Management.",
    NESSUNA_SEDE_GOOGLE_BUSINESS_PROFILE_ACCESSIBILE_O_QUOTA_API_NON_ATTIVA: "Non trovo sedi Google Business Profile accessibili con questo account.",
    GBP_API_NOT_ENABLED: "Nel progetto Google Cloud manca una delle API necessarie: abilita Account Management e Business Information, poi riprova.",
    GBP_NO_ACCESSIBLE_ACCOUNT: "L'account Google scelto non gestisce alcun profilo dell'attività. Premi Ricollega e scegli l'account Google corretto.",
    GBP_ACCOUNT_WITHOUT_LOCATIONS: "L'account Google è accessibile, ma non contiene sedi Google Business Profile gestibili.",
    GBP_LOCATION_DISCOVERY_DEFECT: "Google ha restituito gli account, ma non ha permesso di leggere tutte le sedi. Riprova; se continua, verifica la Business Information API.",
    GBP_OAUTH_ACCOUNT_MISMATCH: "La sessione Google non corrisponde a un account autorizzato. Premi Ricollega e scegli l'account che gestisce la sede.",
    GBP_RATE_LIMITED: "Google Business Profile non è disponibile in questo momento per un limite del servizio. Riprova più tardi; se il problema continua, contatta l’assistenza.",
    GBP_ACCESS_DENIED: "Google Business Profile non ha autorizzato l’accesso richiesto. Verifica di gestire almeno una sede e riprova.",
    FACEBOOK_OAUTH_FAILED: "Il collegamento Facebook non è riuscito. Riprova; se continua, contatta l’assistenza.",
    INSTAGRAM_OAUTH_FAILED: "Il collegamento Instagram non è riuscito. Riprova; se continua, contatta l’assistenza.",
    LINKEDIN_OAUTH_FAILED: "Il collegamento LinkedIn non è riuscito. Riprova; se continua, contatta l’assistenza.",
    GBP_OAUTH_FAILED: "Il collegamento Google Business Profile non è riuscito. Riprova; se continua, contatta l’assistenza.",
    SOCIAL_SELECTION_FAILED: "Non riesco a salvare l’account scelto. Riprova tra poco.",
    SOCIAL_STATUS_FAILED: "Non riesco a caricare i collegamenti social. Riprova tra poco.",
    OAUTH_CALLBACK_IN_PROGRESS: "Il collegamento è già in corso. Attendi qualche secondo e aggiorna la pagina.",
    OAUTH_CALLBACK_ALREADY_USED: "Questo tentativo di collegamento è già terminato. Avvia nuovamente il collegamento.",
    access_denied: "Autorizzazione annullata.",
    DEMO_EXTERNAL_CONNECTION_DISABLED: "Nel profilo demo non è possibile collegare account social reali.",
  };
  return map[value] ?? "Collegamento non riuscito. Riprova tra poco.";
}

function analyticsPermissionMissing(provider: ProviderStatus) {
  if (provider.provider === "INSTAGRAM") return !provider.permissions.includes("instagram_manage_insights");
  if (provider.provider === "LINKEDIN") return provider.accountType === "ORGANIZATION"
    ? !provider.permissions.includes("rw_organization_admin")
    : !provider.permissions.includes("r_member_postAnalytics");
  return false;
}

function tokenFromSession(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const data = value as SessionData;
  return data.session?.token || data.token || data.access_token || null;
}

async function jwt(sessionToken?: string | null) {
  if (sessionToken) return sessionToken;
  return authenticatedApiToken();
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function apiJson<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string; detail?: string };
  if (!response.ok) throw new Error(body.detail || body.error || `HTTP ${response.status}`);
  return body;
}

export function SocialPage() {
  const { selectedProfile, setSelectedProfileId } = useProfiles();
  const authSession = authClient.useSession();
  const sessionToken = tokenFromSession(authSession.data);
  const sessionPending = authSession.isPending;
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyProvider, setBusyProvider] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const profileId = selectedProfile?.id;
    if (!profileId || sessionPending) return;
    setLoading(true);
    setError(null);
    let lastError: unknown = new Error("SOCIAL_STATUS_FAILED");
    const retryDelays = [0, 300, 900];
    for (const delay of retryDelays) {
      if (delay) await wait(delay);
      try {
        const token = await jwt(sessionToken);
        const body = await apiJson<StatusResponse>(`/api/social/status?profileId=${encodeURIComponent(profileId)}`, token);
        setStatus(body);
        setLoading(false);
        return;
      } catch (reason) {
        lastError = reason;
      }
    }
    setError(readableError(lastError instanceof Error ? lastError.message : "SOCIAL_STATUS_FAILED"));
    setLoading(false);
  }, [selectedProfile?.id, sessionPending, sessionToken]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const connected = searchParams.get("connected") as Provider | null;
    const selection = searchParams.get("selection") as Provider | null;
    const socialError = searchParams.get("social_error");
    const oauthProfileId = searchParams.get("profileId");
    if (oauthProfileId && oauthProfileId !== selectedProfile?.id) setSelectedProfileId(oauthProfileId);
    if (connected && PROVIDER_LABELS[connected]) setNotice(`${PROVIDER_LABELS[connected]} collegato correttamente.`);
    else if (selection && PROVIDER_LABELS[selection]) setNotice(`Autorizzazione completata. Scegli quale account ${PROVIDER_LABELS[selection]} usare per questa attività.`);
    if (socialError) setError(readableError(socialError));
    if (connected || selection || socialError || oauthProfileId) {
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams, selectedProfile?.id, setSelectedProfileId]);

  async function connect(provider: Provider) {
    if (!selectedProfile?.id || busyProvider) return;
    setBusyProvider(provider);
    setError(null);
    setNotice(null);
    try {
      const token = await jwt(sessionToken);
      const body = await apiJson<{ url: string }>("/api/social/connect", token, {
        method: "POST",
        body: JSON.stringify({ profileId: selectedProfile.id, provider }),
      });
      if (!body.url) throw new Error("OAUTH_URL_MISSING");
      window.location.assign(body.url);
    } catch (reason) {
      setError(readableError(reason instanceof Error ? reason.message : "SOCIAL_CONNECT_FAILED"));
      setBusyProvider(null);
    }
  }

  async function selectAccount(provider: Provider, candidateId: string) {
    if (!selectedProfile?.id || busyProvider) return;
    setBusyProvider(provider);
    setError(null);
    try {
      const token = await jwt(sessionToken);
      await apiJson("/api/social/select", token, {
        method: "POST",
        body: JSON.stringify({ profileId: selectedProfile.id, provider, candidateId }),
      });
      setNotice(`${PROVIDER_LABELS[provider]} collegato correttamente.`);
      await load();
    } catch (reason) {
      setError(readableError(reason instanceof Error ? reason.message : "SOCIAL_SELECTION_FAILED"));
    } finally {
      setBusyProvider(null);
    }
  }

  async function disconnect(provider: Provider) {
    if (!selectedProfile?.id || busyProvider) return;
    setBusyProvider(provider);
    setError(null);
    setNotice(null);
    try {
      const token = await jwt(sessionToken);
      await apiJson("/api/social/disconnect", token, {
        method: "POST",
        body: JSON.stringify({ profileId: selectedProfile.id, provider }),
      });
      setNotice(`${PROVIDER_LABELS[provider]} scollegato da questa attività.`);
      await load();
    } catch (reason) {
      setError(readableError(reason instanceof Error ? reason.message : "SOCIAL_DISCONNECT_FAILED"));
    } finally {
      setBusyProvider(null);
    }
  }

  const providers = status?.providers ?? [];
  const connectedCount = useMemo(() => providers.filter((provider) => socialProviderUiState(provider) === "ACTIVE").length, [providers]);

  if (!selectedProfile) return null;
  const demo = selectedProfile.tenant_type === "DEMO_PERSISTENT";
  return <div className="page-content social-page">
    <header className="page-header"><div><p className="eyebrow">Social · {selectedProfile.name}</p><h1>Collegamenti social</h1><p>Collega gli account che appartengono a questa attività. Le credenziali restano protette e non vengono mai mostrate.</p></div><button className="compact-action" type="button" disabled={loading} onClick={() => void load()}><RefreshCw size={15} className={loading ? "spin" : ""} /> Aggiorna</button></header>

    {notice && <p className="form-success social-message" role="status"><CheckCircle2 size={17} /> {notice}</p>}
    {demo && <p className="form-success social-message" role="status"><CheckCircle2 size={17} /> DEMO DATA · Nessun social reale collegato. La pubblicazione esterna è disabilitata lato server.</p>}
    {error && <p className="form-error social-message" role="alert"><AlertTriangle size={17} /> {error}</p>}

    {status && <section className={`social-summary ${connectedCount === 0 ? "empty" : ""}`}><div><Share2 size={20} /><span>{connectedCount === 0 ? "Nessun social collegato" : "Account collegati"}</span><strong>{connectedCount}/4</strong></div><p>{connectedCount === 0 ? "Collega almeno un account per iniziare a pubblicare." : "La pubblicazione automatica parte soltanto sui social collegati e per contenuti approvati."}</p></section>}

    {loading && !status ? <section className="panel social-loading"><LoaderCircle className="spin" size={22} /> Caricamento collegamenti…</section>
      : !status ? <section className="unavailable-panel social-status-load-error"><AlertTriangle size={24} /><div><h2>Stato social non disponibile</h2><p>Non riesco a leggere i collegamenti dal backend. Questo è un errore temporaneo reale, non significa che gli account siano scollegati.</p><button className="compact-action" type="button" onClick={() => void load()}><RefreshCw size={15} /> Riprova</button></div></section>
        : <div className="social-grid">
          {providers.map((provider) => {
            const busy = busyProvider === provider.provider;
            const uiState = socialProviderUiState(provider);
            const active = uiState === "ACTIVE";
            const connecting = uiState === "CONNECTING";
            const reconnect = uiState === "RECONNECT";
            const providerError = uiState === "ERROR";
            const unavailable = uiState === "UNAVAILABLE";
            const disconnected = uiState === "DISCONNECTED";
            const analyticsMissing = active && analyticsPermissionMissing(provider);
            const accountPresent = Boolean(provider.accountName || provider.accountId);
            return <article className={`panel social-card ${active ? "connected" : reconnect ? "reconnect" : providerError ? "provider-error" : ""}`} key={provider.provider}>
              <div className="social-card-head"><div className="social-provider-icon"><Share2 size={19} /></div><div><h2>{PROVIDER_LABELS[provider.provider]}</h2><p>{PROVIDER_DESCRIPTIONS[provider.provider]}</p></div><span className={`social-status ${uiState.toLowerCase()}`}>{READINESS_LABELS[provider.readiness.state]}</span></div>

              {accountPresent && (active || reconnect || providerError) && <div className="social-account"><small>Account utilizzato</small><strong>{provider.accountName || provider.accountId}</strong>{provider.accountType && <span>{provider.accountType === "ORGANIZATION" ? "Pagina aziendale" : provider.accountType === "MEMBER" ? "Profilo personale" : provider.accountType}</span>}</div>}

              {connecting && provider.status === "PENDING_SELECTION" && provider.candidates.length > 0 && <div className="social-candidates"><p>Puoi collegare un solo account a questa attività. Scegli quale usare:</p>{provider.candidates.map((candidate) => <button type="button" key={candidate.id} disabled={busy} onClick={() => void selectAccount(provider.provider, candidate.id)}><span><strong>{candidate.name}</strong>{candidate.username && <small>@{candidate.username}</small>}</span><CheckCircle2 size={17} /></button>)}</div>}

              {connecting && provider.status !== "PENDING_SELECTION" && <p className="social-config-info"><LoaderCircle className="spin" size={15} /> Connessione in corso. Lo stato si aggiornerà al termine dell’autorizzazione.</p>}
              {analyticsMissing && <p className="social-config-warning"><AlertTriangle size={15} /> Permesso Analytics mancante. Ricollega l’account e autorizza tutti i permessi richiesti.</p>}
              <p className={provider.readiness.state === "PASS_REAL" ? "social-config-info" : provider.readiness.state === "FAIL" ? "social-config-error" : "social-config-warning"}>{provider.readiness.detail}</p>
              {unavailable && <p className="social-config-info"><Link2 size={15} /> Questo provider deve essere configurato sul server prima di poterlo collegare.</p>}
              {reconnect && <p className="social-config-warning"><AlertTriangle size={15} /> L’autorizzazione non è più valida. Ricollega l’account per continuare.</p>}
              {providerError && <p className="social-config-error"><AlertTriangle size={15} /> Il provider ha restituito un errore reale. Ricollega l’account o riprova dopo aver verificato il servizio.</p>}

              <div className="social-actions">
                {active ? <><button type="button" className={analyticsMissing ? "primary-button" : "secondary-button"} disabled={busy || demo} onClick={() => void connect(provider.provider)}>{busy ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />} Ricollega</button><button type="button" className="secondary-button" disabled={busy || demo} onClick={() => void disconnect(provider.provider)}><Unplug size={16} /> Scollega</button></>
                  : reconnect || providerError ? <><button type="button" className="primary-button" disabled={busy || demo || unavailable} onClick={() => void connect(provider.provider)}>{busy ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />} Ricollega</button>{accountPresent && <button type="button" className="secondary-button" disabled={busy || demo} onClick={() => void disconnect(provider.provider)}><Unplug size={16} /> Scollega</button>}</>
                    : disconnected ? <button type="button" className="primary-button" disabled={busy || demo} onClick={() => void connect(provider.provider)}>{busy ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />} Collega account</button>
                      : null}
              </div>
            </article>;
          })}
        </div>}
  </div>;
}
