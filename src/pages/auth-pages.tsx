import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { NavLink, useNavigate, useSearchParams } from "react-router-dom";
import { authClient } from "../lib/neon-client";
import { ProductBrand } from "../components/product-brand";

const AUTH_TIMEOUT_MS = 12_000;

async function withAuthTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("AUTH_TIMEOUT")), AUTH_TIMEOUT_MS);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function readableAuthError(reason: unknown, fallback: string) {
  if (reason instanceof Error && reason.message === "AUTH_TIMEOUT") {
    return "Il servizio di accesso non ha risposto in tempo. Riprova.";
  }
  return fallback;
}

function PasswordField({ label, value, onChange, autoComplete, minLength = 8, maxLength = 128 }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  minLength?: number;
  maxLength?: number;
}) {
  const [visible, setVisible] = useState(false);

  return <label>{label}<span className="password-input-wrap"><input required minLength={minLength} maxLength={maxLength} type={visible ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(event) => onChange(event.target.value)} /><button className="password-toggle" type="button" aria-label={visible ? "Nascondi password" : "Mostra password"} onClick={() => setVisible((current) => !current)}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>;
}

function AuthLayout({ children, title, subtitle }: { children: ReactNode; title?: string; subtitle?: string }) {
  return <main className="auth-page"><section className="auth-card"><div className="auth-brand"><ProductBrand /><p>Gestisci contenuti, calendario e risultati social con l’AI, in un unico posto.</p></div>{title && <h1>{title}</h1>}{subtitle && <p className="auth-subtitle">{subtitle}</p>}{children}</section></main>;
}

function GoogleMark() {
  return <span className="google-mark" aria-hidden="true">G</span>;
}

async function startGoogleAccess(setError: (message: string | null) => void, setBusy: (busy: boolean) => void) {
  setError(null);
  setBusy(true);
  try {
    const result = await withAuthTimeout(authClient.signIn.social({
      provider: "google",
      callbackURL: `${window.location.origin}/api/oauth/complete`,
    }));
    if (result?.error) {
      setError("Accesso con Google non riuscito. Riprova.");
      setBusy(false);
    }
  } catch (reason) {
    setError(readableAuthError(reason, "Accesso con Google non riuscito. Riprova."));
    setBusy(false);
  }
}

function googleOAuthFailureMessage(code: string) {
  switch (code) {
    case "provider_account_not_linked":
      return "Hai già un account creato con email e password. Accedi con quelle credenziali: potrai collegare Google in sicurezza all’account esistente, senza registrarti nuovamente.";
    case "provider_access_denied":
      return "L'autorizzazione Google è stata annullata o rifiutata. Ripeti l'accesso e conferma il consenso.";
    case "provider_invalid_client":
    case "provider_redirect_uri_mismatch":
    case "provider_unauthorized_client":
      return "Configurazione OAuth Google non valida: occorre verificare Client ID e URI di reindirizzamento nella console Google Cloud.";
    case "provider_state_mismatch":
    case "provider_invalid_state":
    case "provider_invalid_state_format":
    case "provider_state_integrity_check_failed":
    case "provider_invalid_code":
    case "provider_invalid_grant":
    case "provider_please_restart_the_process":
      return "Il flusso OAuth è scaduto o la verifica dello stato non è riuscita. Apri una finestra privata nuova e riprova una sola volta.";
    case "missing_challenge":
      return "Il browser non ha conservato il cookie temporaneo Google. Riprova senza blocchi ai cookie del sito.";
    case "session_cookie_missing":
    case "exchange_failed":
      return "La sessione Google non è stata emessa correttamente dal servizio di autenticazione.";
    default:
      return "Il servizio di autenticazione ha rifiutato l'accesso Google. Il codice indicato consente di distinguere il problema senza raccogliere dati personali.";
  }
}

export function LoginPage() {
  const navigate = useNavigate();
  const [loginSearch] = useSearchParams();
  const oauthError = loginSearch.get("oauth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const existingSession = authClient.useSession();
  const alreadySignedIn = Boolean(existingSession.data?.user) && !oauthError;

  // A signed-in user must never be stranded on the login form (e.g. after a session-cache race).
  useEffect(() => {
    if (alreadySignedIn && !busy) navigate("/app/dashboard", { replace: true });
  }, [alreadySignedIn, busy, navigate]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const result = await withAuthTimeout(authClient.signIn.email({ email: email.trim(), password }));
      if (result.error) {
        setError("Email o password non corretti.");
        return;
      }
      navigate(oauthError === "provider_account_not_linked" ? "/collega-google" : "/app/dashboard", { replace: true });
    } catch (reason) {
      setError(readableAuthError(reason, "Accesso non riuscito. Riprova."));
    } finally {
      setBusy(false);
    }
  }

  return <AuthLayout title="Bentornato" subtitle="Accedi per riprendere il lavoro sui tuoi social."><button className="google-auth-button" disabled={busy} type="button" onClick={() => void startGoogleAccess(setError, setBusy)}><GoogleMark /> Continua con Google</button>{oauthError && <p role="alert" className="form-error">{googleOAuthFailureMessage(oauthError)} <strong>Codice: {oauthError.replace(/[^a-z_]/g, "").slice(0, 60)}</strong>.</p>}<div className="auth-divider"><span>oppure</span></div><form onSubmit={submit} className="auth-form"><label>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" /><p className="auth-switch"><NavLink to="/password-dimenticata">Password dimenticata?</NavLink></p>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy} type="submit">{busy ? "Accesso…" : "Accedi"}</button></form><p className="auth-switch">Non hai un account? <NavLink to="/registrazione">Registrati</NavLink></p></AuthLayout>;
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const result = await withAuthTimeout(authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: `${window.location.origin}/reimposta-password`,
      }));
      if (result.error) {
        // Do not reveal whether the address is registered.
        setSent(true);
        return;
      }
      setSent(true);
    } catch (reason) {
      setError(readableAuthError(reason, "Il servizio di recupero non è disponibile in questo momento. Riprova."));
    } finally {
      setBusy(false);
    }
  }

  return <AuthLayout title="Password dimenticata" subtitle="Inserisci la tua email per ricevere il link di recupero.">{sent ? <><p className="auth-subtitle">Se esiste un account associato a questa email, riceverai le istruzioni per reimpostare la password. Controlla anche la cartella spam.</p><p className="auth-switch"><NavLink to="/login">Torna all'accesso</NavLink></p></> : <><form onSubmit={submit} className="auth-form"><label>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy} type="submit">{busy ? "Invio…" : "Invia link di recupero"}</button></form><p className="auth-switch"><NavLink to="/login">Torna all'accesso</NavLink></p></>}</AuthLayout>;
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const tokenError = searchParams.get("error");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!token || tokenError) {
      setError("Il link di recupero non è valido o è scaduto. Richiedine uno nuovo.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Le password non coincidono.");
      return;
    }

    setBusy(true);
    try {
      const result = await withAuthTimeout(authClient.resetPassword({ newPassword: password, token }));
      if (result.error) {
        setError("Non è stato possibile reimpostare la password. Richiedi un nuovo link e riprova.");
        return;
      }
      navigate("/login", { replace: true });
    } catch (reason) {
      setError(readableAuthError(reason, "Non è stato possibile reimpostare la password."));
    } finally {
      setBusy(false);
    }
  }

  return <AuthLayout title="Reimposta password" subtitle="Scegli una nuova password per il tuo account."><form onSubmit={submit} className="auth-form"><PasswordField label="Nuova password" value={password} onChange={setPassword} autoComplete="new-password" /><PasswordField label="Conferma password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />{(!token || tokenError) && <p className="form-error" role="alert">Il link di recupero non è valido o è scaduto.</p>}{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy || !token || Boolean(tokenError)} type="submit">{busy ? "Salvataggio…" : "Salva nuova password"}</button></form><p className="auth-switch"><NavLink to="/password-dimenticata">Richiedi un nuovo link</NavLink></p></AuthLayout>;
}

export function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const result = await withAuthTimeout(authClient.signUp.email({ name, email: email.trim(), password }));
      if (result.error) {
        setError("Registrazione non riuscita. Se hai già un account, prova ad accedere o a recuperare la password.");
        return;
      }
      navigate("/onboarding", { replace: true });
    } catch (reason) {
      setError(readableAuthError(reason, "Registrazione non riuscita. Riprova."));
    } finally {
      setBusy(false);
    }
  }

  return <AuthLayout title="Crea il tuo accesso"><button className="google-auth-button" disabled={busy} type="button" onClick={() => void startGoogleAccess(setError, setBusy)}><GoogleMark /> Continua con Google</button><div className="auth-divider"><span>oppure</span></div><form onSubmit={submit} className="auth-form"><label>Nome<input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label><label>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><PasswordField label="Password" value={password} onChange={setPassword} autoComplete="new-password" /><p className="field-help">Minimo 8 caratteri.</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy} type="submit">{busy ? "Creazione…" : "Crea account"}</button></form><p className="auth-switch">Hai già un account? <NavLink to="/login">Accedi</NavLink></p></AuthLayout>;
}
