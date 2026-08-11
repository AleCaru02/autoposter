import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from '../components/AppShell';
import { SaasServicesProvider } from '../services/SaasServicesProvider';
import { LocalE2EProvider } from '../services/local-e2e';
import { OnboardingPage } from '../pages/OnboardingPage';
import { PostEditorPage } from '../pages/PostEditorPage';
import { AutomaticSocialManagementPage, FaqPage, FeaturesPage, HowItWorksPage, LandingPage, PricingPage, SocialMediaManagerAiPage } from '../pages/PublicPages';
import { LoginPage, RegisterPage, ResetPasswordPage } from '../pages/AuthPages';
import { NotificationsPage } from '../pages/NotificationsPage';
import { AdminPage, BillingPage, SettingsPage, StrategyPage, SupportPage } from '../pages/WorkspacePages';
import { ProviderTestConsolePage } from '../pages/ProviderReadinessPages';
import { PremiumAnalyticsPage, PremiumApprovalsPage, PremiumAssetsPage, PremiumBrandPage, PremiumCalendarPage, PremiumConnectionsPage, PremiumDashboardPage } from '../pages/PremiumPreviewPages';

export function App() {
  return <LocalE2EProvider><SaasServicesProvider><Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/come-funziona" element={<HowItWorksPage />} />
    <Route path="/funzionalita" element={<FeaturesPage />} />
    <Route path="/prezzi" element={<PricingPage />} />
    <Route path="/pricing" element={<Navigate to="/prezzi" replace />} />
    <Route path="/faq" element={<FaqPage />} />
    <Route path="/social-media-manager-ai" element={<SocialMediaManagerAiPage />} />
    <Route path="/gestione-social-automatica" element={<AutomaticSocialManagementPage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />
    <Route element={<AppShell />}>
      <Route path="/app" element={<PremiumDashboardPage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/app/brand" element={<PremiumBrandPage />} />
      <Route path="/app/assets" element={<PremiumAssetsPage />} />
      <Route path="/app/strategy" element={<StrategyPage />} />
      <Route path="/app/calendar" element={<PremiumCalendarPage />} />
      <Route path="/app/posts/:id" element={<PostEditorPage />} />
      <Route path="/app/approvals" element={<PremiumApprovalsPage />} />
      <Route path="/approvals" element={<PremiumApprovalsPage />} />
      <Route path="/app/connections" element={<PremiumConnectionsPage />} />
      <Route path="/app/analytics" element={<PremiumAnalyticsPage />} />
      <Route path="/app/notifications" element={<NotificationsPage />} />
      <Route path="/app/support" element={<SupportPage />} />
      <Route path="/app/billing" element={<BillingPage />} />
      <Route path="/app/settings" element={<SettingsPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/admin/providers" element={<ProviderTestConsolePage />} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></SaasServicesProvider></LocalE2EProvider>;
}
