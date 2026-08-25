import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from '../components/AppShell';
import { SaasServicesProvider } from '../services/SaasServicesProvider';
import { LocalE2EProvider } from '../services/local-e2e';
import { RealDataGate } from '../services/RealDataGate';
import { OnboardingPage } from '../pages/OnboardingPage';
import { PostEditorPage } from '../pages/PostEditorPage';
import { AutomaticSocialManagementPage, FaqPage, FeaturesPage, HowItWorksPage, LandingPage, PricingPage, SocialMediaManagerAiPage } from '../pages/PublicPages';
import { LoginPage, RegisterPage, ResetPasswordPage } from '../pages/AuthPages';
import { NotificationsPage } from '../pages/NotificationsPage';
import { BillingPage, StrategyPage, SupportPage } from '../pages/WorkspacePages';
import { ProviderTestConsolePage } from '../pages/ProviderReadinessPages';
import { PremiumAnalyticsPage, PremiumApprovalsPage, PremiumAssetsPage, PremiumBrandPage, PremiumCalendarPage, PremiumDashboardPage } from '../pages/PremiumPreviewPages';
import { ContentsPage, PersonalSettingsPage, SitePage, SocialConnectionsPage } from '../pages/PersonalWorkspacePages';
import { AdminCustomersPage } from '../pages/AdminCustomersPage';
import { CookiePolicyPage, PrivacyPage, TermsPage } from '../pages/LegalPages';

export function App() {
  const protectedData=(element:ReactNode)=><RealDataGate>{element}</RealDataGate>;
  return <LocalE2EProvider><SaasServicesProvider><Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/come-funziona" element={<HowItWorksPage />} />
    <Route path="/funzionalita" element={<FeaturesPage />} />
    <Route path="/prezzi" element={<PricingPage />} />
    <Route path="/pricing" element={<Navigate to="/prezzi" replace />} />
    <Route path="/faq" element={<FaqPage />} />
    <Route path="/social-media-manager-ai" element={<SocialMediaManagerAiPage />} />
    <Route path="/gestione-social-automatica" element={<AutomaticSocialManagementPage />} />
    <Route path="/privacy" element={<PrivacyPage />} />
    <Route path="/termini" element={<TermsPage />} />
    <Route path="/cookie-policy" element={<CookiePolicyPage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />
    <Route element={<AppShell />}>
      <Route path="/app" element={protectedData(<PremiumDashboardPage />)} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/app/site" element={protectedData(<SitePage />)} />
      <Route path="/app/contents" element={protectedData(<ContentsPage />)} />
      <Route path="/app/brand" element={protectedData(<PremiumBrandPage />)} />
      <Route path="/app/assets" element={protectedData(<PremiumAssetsPage />)} />
      <Route path="/app/strategy" element={protectedData(<StrategyPage />)} />
      <Route path="/app/calendar" element={protectedData(<PremiumCalendarPage />)} />
      <Route path="/app/posts/:id" element={protectedData(<PostEditorPage />)} />
      <Route path="/app/approvals" element={protectedData(<PremiumApprovalsPage />)} />
      <Route path="/approvals" element={protectedData(<PremiumApprovalsPage />)} />
      <Route path="/app/connections" element={protectedData(<SocialConnectionsPage />)} />
      <Route path="/app/analytics" element={protectedData(<PremiumAnalyticsPage />)} />
      <Route path="/app/notifications" element={protectedData(<NotificationsPage />)} />
      <Route path="/app/support" element={protectedData(<SupportPage />)} />
      <Route path="/app/billing" element={protectedData(<BillingPage />)} />
      <Route path="/app/settings" element={protectedData(<PersonalSettingsPage />)} />
      <Route path="/admin" element={protectedData(<AdminCustomersPage />)} />
      <Route path="/admin/providers" element={protectedData(<ProviderTestConsolePage />)} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></SaasServicesProvider></LocalE2EProvider>;
}
