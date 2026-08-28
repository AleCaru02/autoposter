import { useState, type FormEvent, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { NavLink, useNavigate, useSearchParams } from "react-router-dom";
import { authClient } from "../lib/neon-client";

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

async function accountExists(email: string) {
  const response = await withAuthTimeout(fetch("/api/auth/account-exists", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  }));

  if (!response.ok) throw new Error("ACCOUNT_CHECK_FAILED");
  const payload = await response.json() as { exists?: boolean };
  return payload.exists === true;
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
  return <main className="auth-page"><section className="auth-card">{title && <h1>{title}</h1>}{subtitle && <p className="auth-subtitle">{subtitle}</p>}{children}</section></main>;
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
      callbackURL: `${window.location.origin}/app/dashboard`,
    }));
    if (result?.error) {
      setError(result.error.message ?? "Accesso con Google non riuscito.");
      setBusy(false);
    }
  } catch (reason) {
    setError(readableAuthError(reason, "Accesso con Google non riuscito. Riprova."));
    setBusy(false);
  }
}

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      if (!await accountExists(email.trim())) {
        setError("Non esiste un account con questa email. Registrati prima di accedere.");
        return;
      }

      const result = await withAuthTimeout(authClient.signIn.email({ email: email.trim(), password }));
      if (result.error) {
        setError("Password non corretta.");
        return;
      }
      navigate("/app/dashboard", { replace: true });
    } catch (reason) {
      setError(readableAuthError(reason, "Accesso non riuscito. Riprova."));
    } finally {
      setBusy(false);
    }
  }

  return <AuthLayout><button className="google-auth-button" disabled={busy} type="button" onClick={() => void startGoogleAccess(setError, setBusy)}><GoogleMark /> Continua con Google</button><div className="auth-divider"><span>oppure</span></div><form onSubmit={submit} className="auth-form"><label>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" /><p className="auth-switch"><NavLink to="/password-dimenticata">Password dimenticata?</NavLink></p>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy} type="submit">{busy ? "Accesso…" : "Accedi"}</button></form><p className="auth-switch">Non hai un account? <NavLink to="/registrazione">Registrati</NavLink></p></AuthLayout>;
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
      const normalizedEmail = email.trim();
      if (!await accountExists(normalizedEmail)) {
        setError("Non esiste un account con questa email. Crea prima il tuo account.");
        return;
      }

      const result = await withAuthTimeout(authClient.requestPasswordReset({
        email: normalizedEmail,
        redirectTo: `${window.location.origin}/reimposta-password`,
      }));
      if (result.error) {
        setError(result.error.message ?? "Non è stato possibile richiedere il recupero password.");
        return;
      }
      setSent(true);
    } catch (reason) {
      setError(readableAuthError(reason, "Non è stato possibile richiedere il recupero password."));
    } finally {
      setBusy(false);
    }
  }

  return <AuthLayout title="Password dimenticata" subtitle="Inserisci la tua email per ricevere il link di recupero.">{sent ? <><p className="auth-subtitle">Richiesta inviata. Controlla la posta in arrivo e anche la cartella spam.</p><p className="auth-switch"><NavLink to="/login">Torna all'accesso</NavLink></p></> : <><form onSubmit={submit} className="auth-form"><label>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy} type="submit">{busy ? "Invio…" : "Invia link di recupero"}</button></form><p className="auth-switch"><NavLink to="/login">Torna all'accesso</NavLink></p></>}</AuthLayout>;
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
        setError(result.error.message ?? "Non è stato possibile reimpostare la password.");
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
        setError(result.error.message ?? "Registrazione non riuscita.");
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
