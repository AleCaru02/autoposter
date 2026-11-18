import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { authClient } from "./lib/neon-client";
import { AppShell } from "./components/app-shell";
import { OAuthReturnGate } from "./components/oauth-return-gate";
import { AdminImpersonationRouteAction } from "./components/admin-impersonation-route-action";
import { ProfileProvider, useProfiles } from "./features/profiles/profile-context";

const LoginPage = lazy(() => import("./pages/auth-pages").then((module) => ({ default: module.LoginPage })));
const GoogleAccountLinkPage = lazy(() => import("./pages/google-account-link-page").then((module) => ({ default: module.GoogleAccountLinkPage })));
const RegisterPage = lazy(() => import("./pages/auth-pages").then((module) => ({ default: module.RegisterPage })));
const ForgotPasswordPage = lazy(() => import("./pages/auth-pages").then((module) => ({ default: module.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import("./pages/auth-pages").then((module) => ({ default: module.ResetPasswordPage })));
const OnboardingPage = lazy(() => import("./pages/onboarding-page").then((module) => ({ default: module.OnboardingPage })));
const DashboardPage = lazy(() => import("./pages/dashboard-page").then((module) => ({ default: module.DashboardPage })));
const ProfilesPage = lazy(() => import("./pages/profiles-page").then((module) => ({ default: module.ProfilesPage })));
const BrandPage = lazy(() => import("./pages/brand-page").then((module) => ({ default: module.BrandPage })));
const WebsiteScanPage = lazy(() => import("./pages/website-scan-page").then((module) => ({ default: module.WebsiteScanPage })));
const ContentGeneratorPage = lazy(() => import("./pages/content-generator-page").then((module) => ({ default: module.ContentGeneratorPage })));
const ApprovalsPage = lazy(() => import("./pages/approvals-page").then((module) => ({ default: module.ApprovalsPage })));
const CalendarPage = lazy(() => import("./pages/calendar-page").then((module) => ({ default: module.CalendarPage })));
const SocialPage = lazy(() => import("./pages/social-page").then((module) => ({ default: module.SocialPage })));
const SettingsPage = lazy(() => import("./pages/settings-page").then((module) => ({ default: module.SettingsPage })));
const AnalyticsPage = lazy(() => import("./pages/analytics-page").then((module) => ({ default: module.AnalyticsPage })));
const LearningPage = lazy(() => import("./pages/learning-page").then((module) => ({ default: module.LearningPage })));
const AssetsPage = lazy(() => import("./pages/assets-page").then((module) => ({ default: module.AssetsPage })));
const PrivacyPage = lazy(() => import("./pages/legal-pages").then((module) => ({ default: module.PrivacyPage })));
const TermsPage = lazy(() => import("./pages/legal-pages").then((module) => ({ default: module.TermsPage })));
const AdminBackoffice = lazy(() => import("./pages/admin-pages").then((module) => ({ default: module.AdminBackoffice })));

function PageFallback() {
  return <main className="center-state">Caricamento pagina…</main>;
}

/**
 * Right after sign-in the cached session can still be empty for a moment. Before bouncing to
 * /login, re-check the session once against the server; only a confirmed absence redirects.
 */
/** Longest wait for a session answer: after sign-out the client can stay "pending" and refetch forever. */
export const SESSION_CHECK_TIMEOUT_MS = 6000;

export function useConfirmedSession() {
  const session = authClient.useSession();
  const hasUser = Boolean(session.data?.user);
  const [rechecked, setRechecked] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  // After sign-out the session client keeps refetching (isRefetching flaps), so waiting for it to
  // settle always ran into the timeout. A direct, uncached server answer of "no session" is
  // authoritative and lets the guard redirect at once (verified on WebKit/Chromium, 16/11/2026).
  const [serverSignedOut, setServerSignedOut] = useState(false);
  useEffect(() => {
    if (session.isPending || hasUser || rechecked) return;
    let active = true;
    void Promise.resolve(session.refetch?.()).catch(() => undefined).finally(() => { if (active) setRechecked(true); });
    return () => { active = false; };
  }, [session.isPending, hasUser, rechecked, session]);
  // Independent of isPending, which also flaps while the client loops after sign-out.
  useEffect(() => {
    if (hasUser) return;
    let active = true;
    void fetch("/api/auth/get-session", { credentials: "include", cache: "no-store", headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) return;
        const body = await response.json().catch(() => undefined) as { user?: unknown } | null | undefined;
        if (active && body !== undefined && !body?.user) setServerSignedOut(true);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [hasUser]);
  useEffect(() => {
    if (hasUser) { setTimedOut(false); return; }
    const timer = window.setTimeout(() => setTimedOut(true), SESSION_CHECK_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [hasUser]);
  useEffect(() => { if (hasUser) setServerSignedOut(false); }, [hasUser]);
  const checking = !timedOut && !(serverSignedOut && !hasUser) && (session.isPending || session.isRefetching || (!hasUser && !rechecked));
  return { checking, user: session.data?.user ?? null };
}

function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { checking, user } = useConfirmedSession();
  if (checking && !user) return <main className="center-state">Verifica sessione…</main>;
  if (!user) return <Navigate to={location.pathname === "/collega-google" ? "/login?oauth=provider_account_not_linked" : "/login"} replace />;
  return children;
}

function RequireProfile() {
  const { profiles, loading, error, reload } = useProfiles();
  if (loading) return <main className="center-state">Caricamento attività…</main>;
  if (error) return <main className="center-state profile-load-error"><section><h1>Non riesco a caricare le tue attività</h1><p>I dati non sono stati cancellati. Controlla la sessione e riprova.</p><p role="status">{error}</p><button className="primary-button" type="button" onClick={() => void reload()}>Riprova</button></section></main>;
  if (profiles.length === 0) return <Navigate to="/onboarding" replace />;
  return <AppShell />;
}

function RootRedirect() {
  const { checking, user } = useConfirmedSession();
  if (checking && !user) return <main className="center-state">Caricamento…</main>;
  return <Navigate to={user ? "/app/dashboard" : "/login"} replace />;
}

export default function App() {
  return <Suspense fallback={<PageFallback />}><AdminImpersonationRouteAction /><OAuthReturnGate><Routes>
    <Route path="/" element={<RootRedirect />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/registrazione" element={<RegisterPage />} />
    <Route path="/collega-google" element={<RequireAuth><GoogleAccountLinkPage /></RequireAuth>} />
    <Route path="/password-dimenticata" element={<ForgotPasswordPage />} />
    <Route path="/reimposta-password" element={<ResetPasswordPage />} />
    <Route path="/privacy" element={<PrivacyPage />} />
    <Route path="/termini" element={<TermsPage />} />
    <Route path="/onboarding" element={<RequireAuth><ProfileProvider><OnboardingPage /></ProfileProvider></RequireAuth>} />
    <Route path="/admin/*" element={<RequireAuth><AdminBackoffice /></RequireAuth>} />
    <Route path="/app" element={<RequireAuth><ProfileProvider><RequireProfile /></ProfileProvider></RequireAuth>}>
      <Route index element={<Navigate to="dashboard" replace />} />
      <Route path="dashboard" element={<DashboardPage />} />
      <Route path="profili" element={<ProfilesPage />} />
      <Route path="brand" element={<BrandPage />} />
      <Route path="sito" element={<WebsiteScanPage />} />
      <Route path="contenuti" element={<ContentGeneratorPage />} />
      <Route path="approvazioni" element={<ApprovalsPage />} />
      <Route path="calendario" element={<CalendarPage />} />
      <Route path="social" element={<SocialPage />} />
      <Route path="analytics" element={<AnalyticsPage />} />
      <Route path="apprendimento" element={<LearningPage />} />
      <Route path="libreria" element={<AssetsPage />} />
      <Route path="impostazioni" element={<SettingsPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></OAuthReturnGate></Suspense>;
}
