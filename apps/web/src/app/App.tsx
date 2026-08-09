import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from '../components/AppShell';
import { DashboardPage } from '../pages/DashboardPage';
import { OnboardingPage } from '../pages/OnboardingPage';
import { BrandPage, CalendarPage } from '../pages/BrandCalendarPages';
import { LandingPage, PricingPage } from '../pages/PublicPages';
import { AdminPage, AnalyticsPage, ApprovalsPage, AssetsPage, BillingPage, ConnectionsPage, SettingsPage, StrategyPage, SupportPage } from '../pages/WorkspacePages';

export function App() {
  return <Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/pricing" element={<PricingPage />} />
    <Route element={<AppShell />}>
      <Route path="/app" element={<DashboardPage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/app/brand" element={<BrandPage />} />
      <Route path="/app/assets" element={<AssetsPage />} />
      <Route path="/app/strategy" element={<StrategyPage />} />
      <Route path="/app/calendar" element={<CalendarPage />} />
      <Route path="/app/approvals" element={<ApprovalsPage />} />
      <Route path="/app/connections" element={<ConnectionsPage />} />
      <Route path="/app/analytics" element={<AnalyticsPage />} />
      <Route path="/app/support" element={<SupportPage />} />
      <Route path="/app/billing" element={<BillingPage />} />
      <Route path="/app/settings" element={<SettingsPage />} />
      <Route path="/admin" element={<AdminPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
