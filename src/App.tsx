import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { authClient } from "./lib/neon-client";
import { AppShell } from "./components/app-shell";
import { ProfileProvider, useProfiles } from "./features/profiles/profile-context";

const LoginPage = lazy(() => import("./pages/auth-pages").then((module) => ({ default: module.LoginPage })));
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
const AdminBackoffice = lazy(() => import("./pages/admin-pages").then((module) => ({ default: module.AdminBackoffice })));

function PageFallback() {
  return <main className="center-state">Caricamento pagina…</main>;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const session = authClient.useSession();
  if (session.isPending) return <main className="center-state">Verifica sessione…</main>;
  if (!session.data?.user) return <Navigate to="/login" replace />;
  return children;
}

function RequireProfile() {
  const { profiles, loading, error, reload } = useProfiles();
  if (loading) return <main className="center-state">Caricamento attività…</main>;
  if (error) return <main className="center-state profile-load-error"><section><h1>Non riesco a caricare le tue attività</h1><p>I dati non sono stati cancellati. Controlla la sessione e riprova.</p><button className="primary-button" type="button" onClick={() => void reload()}>Riprova</button></section></main>;
  if (profiles.length === 0) return <Navigate to="/onboarding" replace />;
  return <AppShell />;
}

function RootRedirect() {
  const session = authClient.useSession();
  if (session.isPending) return <main className="center-state">Caricamento…</main>;
  return <Navigate to={session.data?.user ? "/app/dashboard" : "/login"} replace />;
}

export default function App() {
  return <Suspense fallback={<PageFallback />}><Routes>
    <Route path="/" element={<RootRedirect />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/registrazione" element={<RegisterPage />} />
    <Route path="/password-dimenticata" element={<ForgotPasswordPage />} />
    <Route path="/reimposta-password" element={<ResetPasswordPage />} />
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
      <Route path="impostazioni" element={<SettingsPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense>;
}
