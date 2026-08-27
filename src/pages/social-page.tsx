import { AlertTriangle, CheckCircle2, Link2, LoaderCircle, RefreshCw, Share2, Unplug } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { authClient } from "../lib/neon-client";
import { useProfiles } from "../features/profiles/profile-context";

type Provider = "INSTAGRAM" | "FACEBOOK" | "LINKEDIN" | "GBP";
type Candidate = { id: string; name: string; accountId?: string; pageId?: string; username?: string; kind?: string };
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
};
type StatusResponse = {
  providers: ProviderStatus[];
  linkedinOrganizationMode?: boolean;
  publishingBaseUrlConfigured?: boolean;
  error?: string;
};

type JwtAuth = { getJWTToken?: () => Promise<string | null> };
type SessionData = { session?: { token?: string | null }; token?: string | null; access_token?: string | null };

const PROVIDER_LABELS: Record<Provider, string> = {
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  LINKEDIN: "LinkedIn",
  GBP: "Google Business Profile",
};

const PROVIDER_DESCRIPTIONS: Record<Provider, string> = {
  INSTAGRAM: "Account professionale collegato a Meta. Pubblicazione tramite API ufficiale.",
  FACEBOOK: "Pagina Facebook che amministri. Pubblicazione tramite API ufficiale Meta.",
  LINKEDIN: "Profilo LinkedIn oppure Pagina aziendale quando l’accesso Community Management è abilitato.",
  GBP: "Sede Google Business Profile che gestisci con il tuo account Google.",
};

const PROVIDER_CAPABILITIES: Record<Provider, ProviderStatus["capabilities"]> = {
  INSTAGRAM: { publish: ["POST", "STORY"], note: "Carosello disponibile quando il contenuto contiene più media reali." },
  FACEBOOK: { publish: ["POST"], note: "Storie e caroselli non vengono dichiarati disponibili finché non esistono gli asset richiesti dalle API." },
  LINKEDIN: { publish: ["POST"], note: "I caroselli organici richiedono più immagini; le storie non sono un formato LinkedIn." },
  GBP: { publish: ["POST"], note: "Google Business Profile pubblica Local Posts; storie e caroselli non esistono nell’API GBP." },
};

const UNAVAILABLE_PROVIDERS: ProviderStatus[] = (Object.keys(PROVIDER_LABELS) as Provider[]).map((provider) => ({
  provider,
  configured: false,
  status: "STATUS_UNAVAILABLE",
  accountId: null,
  accountName: null,
  permissions: [],
  expiresAt: null,
  lastValidatedAt: null,
  candidates: [],
  accountType: null,
  capabilities: PROVIDER_CAPABILITIES[provider],
}));

function readableError(value: string) {
  const normalized = value.replace(/_/g, " ").trim();
  const map: Record<string, string> = {
    PROVIDER_NOT_CONFIGURED: "Questo provider non è ancora configurato lato server.",
    PROFILE_NOT_FOUND: "Il server non riesce a verificare l’attività selezionata. Ricarica la sessione e riprova.",
    PROFILE_ACCESS_CHECK_FAILED: "Il server non riesce a verificare la sessione con il database. Riprova tra poco.",
    SOCIAL_SECURITY_NOT_CONFIGURED: "Manca la configurazione sicura delle credenziali social sul server.",
    NESSUN_ACCOUNT_INSTAGRAM_PROFESSIONALE_COLLEGATO_A_UNA_PAGINA: "Non trovo un account Instagram professionale collegato a una Pagina Facebook gestibile.",
    NESSUNA_PAGINA_FACEBOOK_GESTIBILE: "Non trovo Pagine Facebook gestibili con questo account.",
    NESSUNA_PAGINA_LINKEDIN_AMMINISTRATA_O_ACCESSO_COMMUNITY_MANAGEMENT_NON_ATTIVO: "Non trovo una Pagina LinkedIn amministrata oppure l’app non ha ancora l’accesso Community Management.",
    NESSUNA_SEDE_GOOGLE_BUSINESS_PROFILE_ACCESSIBILE_O_QUOTA_API_NON_ATTIVA: "Non trovo sedi Google Business Profile accessibili oppure l’API GBP non è ancora abilitata per il progetto Google.",
    access_denied: "Autorizzazione annullata dal provider.",
  };
  return map[value] ?? (normalized || "Collegamento non riuscito.");
}

function tokenFromSession(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const data = value as SessionData;
  return data.session?.token || data.token || data.access_token || null;
}

async function jwt(sessionToken?: string | null) {
  if (sessionToken) return sessionToken;
  const token = await (authClient as typeof authClient & JwtAuth).getJWTToken?.();
  if (!token) throw new Error("Sessione scaduta. Accedi di nuovo.");
  return token;
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
  const { selectedProfile } = useProfiles();
  const authSession = authClient.useSession();
  const sessionToken = tokenFromSession(authSession.data);
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyProvider, setBusyProvider] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const profileId = selectedProfile?.id;
    if (!profileId) return;
    setLoading(true);
    setError(null);
    try {
      const token = await jwt(sessionToken);
      const body = await apiJson<StatusResponse>(`/api/social/status?profileId=${encodeURIComponent(profileId)}`, token);
      setStatus(body);
    } catch (reason) {
      setError(readableError(reason instanceof Error ? reason.message : "SOCIAL_STATUS_FAILED"));
    } finally {
      setLoading(false);
    }
  }, [selectedProfile?.id, sessionToken]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const connected = searchParams.get("connected") as Provider | null;
    const selection = searchParams.get("selection") as Provider | null;
    const socialError = searchParams.get("social_error");
    if (connected && PROVIDER_LABELS[connected]) setNotice(`${PROVIDER_LABELS[connected]} collegato correttamente.`);
    else if (selection && PROVIDER_LABELS[selection]) setNotice(`Autorizzazione completata. Scegli quale account ${PROVIDER_LABELS[selection]} usare per questa attività.`);
    if (socialError) setError(readableError(socialError));
    if (connected || selection || socialError) {
      setSearchParams({}, { replace: true });
      void load();
    }
  }, [searchParams, setSearchParams, load]);

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

  const connectedCount = useMemo(() => status?.providers.filter((provider) => provider.status === "ACTIVE").length ?? 0, [status]);
  const providers = status?.providers?.length ? status.providers : UNAVAILABLE_PROVIDERS;

  if (!selectedProfile) return null;
  return <div className="page-content social-page">
    <header className="page-header"><div><p className="eyebrow">Social · {selectedProfile.name}</p><h1>Collegamenti social</h1><p>Collega solo gli account che appartengono a questa attività. I token restano sul server e non vengono mostrati nel browser.</p></div><button className="compact-action" type="button" disabled={loading} onClick={() => void load()}><RefreshCw size={15} className={loading ? "spin" : ""} /> Aggiorna</button></header>

    {notice && <p className="form-success social-message" role="status"><CheckCircle2 size={17} /> {notice}</p>}
    {error && <p className="form-error social-message" role="alert"><AlertTriangle size={17} /> {error}</p>}

    <section className="social-summary"><div><Share2 size={20} /><span>Account collegati</span><strong>{connectedCount}/4</strong></div><p>La pubblicazione automatica parte soltanto per provider realmente collegati e contenuti approvati.</p></section>

    {loading && !status ? <section className="panel social-loading"><LoaderCircle className="spin" size={22} /> Caricamento collegamenti…</section> : <div className="social-grid">
      {providers.map((provider) => {
        const busy = busyProvider === provider.provider;
        const active = provider.status === "ACTIVE";
        const pending = provider.status === "PENDING_SELECTION";
        const unavailable = provider.status === "STATUS_UNAVAILABLE";
        return <article className={`panel social-card ${active ? "connected" : ""}`} key={provider.provider}>
          <div className="social-card-head"><div className="social-provider-icon"><Share2 size={19} /></div><div><h2>{PROVIDER_LABELS[provider.provider]}</h2><p>{PROVIDER_DESCRIPTIONS[provider.provider]}</p></div><span className={`social-status ${active ? "active" : pending ? "pending" : "idle"}`}>{active ? "Collegato" : pending ? "Scegli account" : unavailable ? "Stato non disponibile" : provider.configured ? "Non collegato" : "Da configurare"}</span></div>

          {active && <div className="social-account"><small>Account utilizzato</small><strong>{provider.accountName || provider.accountId}</strong>{provider.accountType && <span>{provider.accountType === "ORGANIZATION" ? "Pagina aziendale" : provider.accountType === "MEMBER" ? "Profilo personale" : provider.accountType}</span>}</div>}

          {pending && provider.candidates.length > 0 && <div className="social-candidates"><p>Scegli l’account corretto per questa attività:</p>{provider.candidates.map((candidate) => <button type="button" key={candidate.id} disabled={busy} onClick={() => void selectAccount(provider.provider, candidate.id)}><span><strong>{candidate.name}</strong>{candidate.username && <small>@{candidate.username}</small>}</span><CheckCircle2 size={17} /></button>)}</div>}

          <div className="social-capabilities"><small>Pubblicazione disponibile</small><div>{provider.capabilities.publish.map((format) => <span key={format}>{format === "POST" ? "Post" : format === "STORY" ? "Storie" : format}</span>)}</div><p>{provider.capabilities.note}</p></div>

          {unavailable ? <p className="social-config-warning"><AlertTriangle size={15} /> Il server non ha restituito lo stato di questo collegamento. Premi Aggiorna per riprovare.</p> : !provider.configured && <p className="social-config-warning"><AlertTriangle size={15} /> Le credenziali sviluppatore di questo provider non sono ancora configurate sul server.</p>}

          <div className="social-actions">{active ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void disconnect(provider.provider)}>{busy ? <LoaderCircle className="spin" size={16} /> : <Unplug size={16} />} Scollega</button> : !pending && !unavailable && <button type="button" className="primary-button" disabled={busy} onClick={() => void connect(provider.provider)}>{busy ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />} Collega</button>}</div>
        </article>;
      })}
    </div>}

  </div>;
}
