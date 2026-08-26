import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { authClient } from "./lib/neon-client";
import { AppShell } from "./components/app-shell";
import { ProfileProvider, useProfiles } from "./features/profiles/profile-context";
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from "./pages/auth-pages";
import { OnboardingPage } from "./pages/onboarding-page";
import { DashboardPage } from "./pages/dashboard-page";
import { ProfilesPage } from "./pages/profiles-page";
import { BrandPage } from "./pages/brand-page";
import { WebsiteScanPage } from "./pages/website-scan-page";
import { ApprovalsPage } from "./pages/approvals-page";
import { CalendarPage } from "./pages/calendar-page";
import { SocialPage } from "./pages/social-page";
import { SettingsPage } from "./pages/settings-page";
import { PlaceholderPage } from "./pages/placeholder-page";

function RequireAuth({ children }: { children: ReactNode }) {
  const session = authClient.useSession();
  if (session.isPending) return <main className="center-state">Verifica sessione…</main>;
  if (!session.data?.user) return <Navigate to="/login" replace />;
  return children;
}

function RequireProfile() {
  const { profiles, loading } = useProfiles();
  if (loading) return <main className="center-state">Caricamento attività…</main>;
  if (profiles.length === 0) return <Navigate to="/onboarding" replace />;
  return <AppShell />;
}

function RootRedirect() {
  const session = authClient.useSession();
  if (session.isPending) return <main className="center-state">Caricamento…</main>;
  return <Navigate to={session.data?.user ? "/app/dashboard" : "/login"} replace />;
}

export default function App() {
  return <Routes>
    <Route path="/" element={<RootRedirect />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/registrazione" element={<RegisterPage />} />
    <Route path="/password-dimenticata" element={<ForgotPasswordPage />} />
    <Route path="/reimposta-password" element={<ResetPasswordPage />} />
    <Route path="/onboarding" element={<RequireAuth><ProfileProvider><OnboardingPage /></ProfileProvider></RequireAuth>} />
    <Route path="/app" element={<RequireAuth><ProfileProvider><RequireProfile /></ProfileProvider></RequireAuth>}>
      <Route index element={<Navigate to="dashboard" replace />} />
      <Route path="dashboard" element={<DashboardPage />} />
      <Route path="profili" element={<ProfilesPage />} />
      <Route path="brand" element={<BrandPage />} />
      <Route path="sito" element={<WebsiteScanPage />} />
      <Route path="contenuti" element={<Navigate to="/app/calendario" replace />} />
      <Route path="approvazioni" element={<ApprovalsPage />} />
      <Route path="calendario" element={<CalendarPage />} />
      <Route path="social" element={<SocialPage />} />
      <Route path="analytics" element={<PlaceholderPage title="Analytics" description="Metriche provenienti esclusivamente dalle API dei provider." dependency="social collegati" />} />
      <Route path="apprendimento" element={<PlaceholderPage title="Apprendimento" description="Ottimizzazione progressiva di temi, giorni, orari e formati." dependency="metriche reali" />} />
      <Route path="impostazioni" element={<SettingsPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
