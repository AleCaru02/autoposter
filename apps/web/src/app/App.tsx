import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from '../components/AppShell';
import { LocalE2EProvider } from '../services/local-e2e';
import { RealDataGate } from '../services/RealDataGate';
import { OnboardingPage } from '../pages/OnboardingPage';
import { PostEditorPage } from '../pages/PostEditorPage';
import { PersonalApprovalsPage } from '../pages/PersonalApprovalsPage';
import { PersonalAnalyticsPage, PersonalStrategyPage } from '../pages/PersonalInsightPages';
import { PersonalSupportPage } from '../pages/PersonalSupportPage';
import { AutomaticSocialManagementPage, FaqPage, FeaturesPage, HowItWorksPage, LandingPage, PricingPage, SocialMediaManagerAiPage } from '../pages/PublicPages';
import { LoginPage, RegisterPage, ResetPasswordPage } from '../pages/AuthPages';
import { NotificationsPage } from '../pages/NotificationsPage';
import { DashboardPage } from '../pages/DashboardPage';
import { CalendarPage } from '../pages/BrandCalendarPages';
import { BrandVisualPage, VisualAssetsPage } from '../pages/VisualWorkflowPages';
import { ContentsPage, PersonalSettingsPage, SitePage, SocialConnectionsPage } from '../pages/PersonalWorkspacePages';
import { AiBudgetPage } from '../pages/AiBudgetPage';
import { AdminCustomersPage } from '../pages/AdminCustomersPage';
import { CookiePolicyPage, PrivacyPage, TermsPage } from '../pages/LegalPages';

export function App() {
  const protectedData=(element:ReactNode)=><RealDataGate>{element}</RealDataGate>;
  return <LocalE2EProvider><Routes>
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
      <Route path="/app" element={protectedData(<DashboardPage />)} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/app/site" element={protectedData(<SitePage />)} />
      <Route path="/app/contents" element={protectedData(<ContentsPage />)} />
      <Route path="/app/brand" element={protectedData(<BrandVisualPage />)} />
      <Route path="/app/assets" element={protectedData(<VisualAssetsPage />)} />
      <Route path="/app/strategy" element={protectedData(<PersonalStrategyPage />)} />
      <Route path="/app/calendar" element={protectedData(<CalendarPage />)} />
      <Route path="/app/posts/:id" element={protectedData(<PostEditorPage />)} />
      <Route path="/app/approvals" element={protectedData(<PersonalApprovalsPage />)} />
      <Route path="/approvals" element={protectedData(<PersonalApprovalsPage />)} />
      <Route path="/app/connections" element={protectedData(<SocialConnectionsPage />)} />
      <Route path="/app/analytics" element={protectedData(<PersonalAnalyticsPage />)} />
      <Route path="/app/notifications" element={protectedData(<NotificationsPage />)} />
      <Route path="/app/budget-ai" element={protectedData(<AiBudgetPage />)} />
      <Route path="/app/support" element={protectedData(<PersonalSupportPage />)} />
      <Route path="/app/billing" element={<Navigate to="/app/settings" replace />} />
      <Route path="/app/settings" element={protectedData(<PersonalSettingsPage />)} />
      <Route path="/admin" element={protectedData(<AdminCustomersPage />)} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></LocalE2EProvider>;
}
