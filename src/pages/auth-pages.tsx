import { useState, type FormEvent, type ReactNode } from "react";
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

function AuthLayout({ children, title, subtitle }: { children: ReactNode; title?: string; subtitle?: string }) {
  return <main className="auth-page"><section className="auth-card">{title && <h1>{title}</h1>}{subtitle && <p className="auth-subtitle">{subtitle}</p>}{children}</section></main>;
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
      const result = await withAuthTimeout(authClient.signIn.email({ email, password }));
      if (result.error) {
        setError(result.error.message ?? "Email o password non corretti.");
        return;
      }
      navigate("/app/dashboard", { replace: true });
    } catch (reason) {
      setError(readableAuthError(reason, "Accesso non riuscito. Riprova."));
    } finally {
      setBusy(false);
    }
  }

  return <AuthLayout><form onSubmit={submit} className="auth-form"><label>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input required minLength={8} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><p className="auth-switch"><NavLink to="/password-dimenticata">Password dimenticata?</NavLink></p>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy} type="submit">{busy ? "Accesso…" : "Accedi"}</button></form><p className="auth-switch">Non hai un account? <NavLink to="/registrazione">Registrati</NavLink></p></AuthLayout>;
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
        email,
        redirectTo: `${window.location.origin}/reimposta-password`,
      }));
      if (result.error) {
        setError(result.error.message ?? "Non è stato possibile inviare l'email di recupero.");
        return;
      }
      setSent(true);
    } catch (reason) {
      setError(readableAuthError(reason, "Non è stato possibile inviare l'email di recupero."));
    } finally {
      setBusy(false);
    }
  }

  return <AuthLayout title="Password dimenticata" subtitle="Inserisci la tua email per ricevere il link di recupero.">{sent ? <><p className="auth-subtitle">Se l'indirizzo è registrato, riceverai un'email con le istruzioni per reimpostare la password.</p><p className="auth-switch"><NavLink to="/login">Torna all'accesso</NavLink></p></> : <><form onSubmit={submit} className="auth-form"><label>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy} type="submit">{busy ? "Invio…" : "Invia link di recupero"}</button></form><p className="auth-switch"><NavLink to="/login">Torna all'accesso</NavLink></p></>}</AuthLayout>;
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

  return <AuthLayout title="Reimposta password" subtitle="Scegli una nuova password per il tuo account."><form onSubmit={submit} className="auth-form"><label>Nuova password<input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><label>Conferma password<input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>{(!token || tokenError) && <p className="form-error" role="alert">Il link di recupero non è valido o è scaduto.</p>}{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy || !token || Boolean(tokenError)} type="submit">{busy ? "Salvataggio…" : "Salva nuova password"}</button></form><p className="auth-switch"><NavLink to="/password-dimenticata">Richiedi un nuovo link</NavLink></p></AuthLayout>;
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
      const result = await withAuthTimeout(authClient.signUp.email({ name, email, password }));
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

  return <AuthLayout title="Crea il tuo accesso"><form onSubmit={submit} className="auth-form"><label>Nome<input required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label><label>Email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><p className="field-help">Minimo 8 caratteri.</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy} type="submit">{busy ? "Creazione…" : "Crea account"}</button></form><p className="auth-switch">Hai già un account? <NavLink to="/login">Accedi</NavLink></p></AuthLayout>;
}
