import { CreditCard, Eye, EyeOff, KeyRound, RefreshCw, Settings2, Share2, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { authClient, neonClient, NEON_DATA_API_URL } from "../lib/neon-client";
import { authenticatedApiToken } from "../lib/auth-token";
import { useAutoSaveDraft } from "../lib/use-autosave-draft";
import { useProfiles } from "../features/profiles/profile-context";
import { buildCustomerPlan, customerSocialState, type CustomerEntitlement, type CustomerPlan, type CustomerUsageBucket, type SettingsSocialStatus } from "../features/settings/customer-settings";

type SettingsDraft = {
  name: string;
  website: string;
  industry: string;
  timezone: string;
  locale: string;
};

type AiBudgetOverview = {
  account_hard_cap_eur: number | string;
  account_spend_eur: number | string;
  account_remaining_eur: number | string;
  activity_hard_cap_eur: number | string;
  activity_spend_eur: number | string;
  activity_remaining_eur: number | string;
};

type AiBudgetRecommendation = {
  mode: "ESTIMATED" | "DATA_DRIVEN";
  activeSocials: number;
  monthlyChannelSlots: number;
  plannedImageOperations: number;
  minimumOperationalEur: number;
  recommendedEur: number;
  intensiveEur: number;
  breakdown: {
    strategyPlanningEur: number;
    copyAdaptationsEur: number;
    researchFactCheckEur: number;
    visualAiEur: number;
    qaEur: number;
    reserveEur: number;
  };
  explanation: string;
  assumptions: string[];
};

export function SettingsPage() {
  const session = authClient.useSession();
  const { selectedProfile, updateProfile } = useProfiles();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordDone, setPasswordDone] = useState<string | null>(null);
  const [accountName, setAccountName] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountDone, setAccountDone] = useState<string | null>(null);
  const [overview, setOverview] = useState<{ profileId: string; plan: CustomerPlan; social: ReturnType<typeof customerSocialState>[] } | null>(null);
  const [overviewBusy, setOverviewBusy] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [aiBudget, setAiBudget] = useState<AiBudgetOverview | null>(null);
  const [accountBudgetInput, setAccountBudgetInput] = useState("");
  const [activityBudgetInput, setActivityBudgetInput] = useState("");
  const [budgetBusy, setBudgetBusy] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [budgetDone, setBudgetDone] = useState<string | null>(null);
  const [budgetRecommendation, setBudgetRecommendation] = useState<AiBudgetRecommendation | null>(null);
  const [budgetRecommendationOpen, setBudgetRecommendationOpen] = useState(false);

  useEffect(() => {
    setAccountName(session.data?.user?.name?.trim() ?? "");
  }, [session.data?.user?.name]);

  const save = useCallback(async (next: SettingsDraft) => {
    if (!selectedProfile) return;
    await updateProfile(selectedProfile.id, {
      name: next.name,
      website_url: next.website,
      industry: next.industry,
      timezone: next.timezone,
      locale: next.locale,
    });
  }, [selectedProfile?.id, updateProfile]);

  const autosave = useAutoSaveDraft<SettingsDraft>(save, 500);

  useEffect(() => {
    if (!selectedProfile) return;
    autosave.replaceDraft({
      name: selectedProfile.name,
      website: selectedProfile.website_url ?? "",
      industry: selectedProfile.industry ?? "",
      timezone: selectedProfile.timezone || "Europe/Rome",
      locale: selectedProfile.locale || "it-IT",
    });
  }, [selectedProfile?.id]);

  const loadOverview = useCallback(async () => {
    if (!selectedProfile?.id) return;
    const profileId = selectedProfile.id;
    setOverviewBusy(true);
    setOverviewError(null);
    try {
      const now = new Date().toISOString();
      const [entitlements, usage, token] = await Promise.all([
        neonClient.from("profile_entitlements").select("capability_key,enabled,limit_value,period_type,source").eq("profile_id", profileId),
        neonClient.from("capability_usage_buckets").select("capability_key,committed_quantity,reserved_quantity").eq("profile_id", profileId).lte("period_start", now).gt("period_end", now),
        authenticatedApiToken(),
      ]);
      if (entitlements.error || usage.error) throw new Error("SETTINGS_DATA_FAILED");
      const response = await fetch(`/api/social/status?profileId=${encodeURIComponent(profileId)}`, { headers: { authorization: `Bearer ${token}` } });
      const socialBody = await response.json().catch(() => ({})) as { providers?: SettingsSocialStatus[] };
      if (!response.ok || !socialBody.providers) throw new Error("SOCIAL_STATUS_FAILED");
      setOverview({
        profileId,
        plan: buildCustomerPlan((entitlements.data ?? []) as CustomerEntitlement[], (usage.data ?? []) as CustomerUsageBucket[]),
        social: socialBody.providers.map(customerSocialState),
      });
    } catch {
      setOverviewError("Non è stato possibile caricare piano e collegamenti. Riprova.");
    } finally {
      setOverviewBusy(false);
    }
  }, [selectedProfile?.id]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  const loadAiBudget = useCallback(async () => {
    if (!selectedProfile?.id) return;
    setBudgetError(null);
    try {
      const token = await authenticatedApiToken();
      const response = await fetch(`${NEON_DATA_API_URL}/rpc/customer_ai_budget_overview`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ p_profile_id: selectedProfile.id }),
      });
      const body = await response.json().catch(() => null) as AiBudgetOverview[] | null;
      if (!response.ok || !body?.[0]) throw new Error("AI_BUDGET_LOAD_FAILED");
      setAiBudget(body[0]);
      setAccountBudgetInput(String(Number(body[0].account_hard_cap_eur)));
      setActivityBudgetInput(String(Number(body[0].activity_hard_cap_eur)));
      const recommendationResponse = await fetch(`/api/ai-budget-recommendation?profileId=${encodeURIComponent(selectedProfile.id)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const recommendationBody = await recommendationResponse.json().catch(() => ({})) as { recommendation?: AiBudgetRecommendation };
      setBudgetRecommendation(recommendationResponse.ok ? recommendationBody.recommendation ?? null : null);
    } catch {
      setBudgetError("Non è stato possibile caricare il budget AI.");
    }
  }, [selectedProfile?.id]);

  useEffect(() => { void loadAiBudget(); }, [loadAiBudget]);

  async function saveAiBudget(event: FormEvent) {
    event.preventDefault();
    if (!selectedProfile?.id) return;
    const accountCap = Number(accountBudgetInput.replace(",", "."));
    const activityCap = Number(activityBudgetInput.replace(",", "."));
    setBudgetError(null);
    setBudgetDone(null);
    if (!Number.isFinite(accountCap) || accountCap <= 0 || !Number.isFinite(activityCap) || activityCap <= 0) {
      setBudgetError("Inserisci budget validi maggiori di 0 €.");
      return;
    }
    if (activityCap > accountCap) {
      setBudgetError("Il budget dell’attività non può superare il budget globale dell’account.");
      return;
    }
    setBudgetBusy(true);
    try {
      const token = await authenticatedApiToken();
      const callRpc = async (name: string, payload: Record<string, unknown>) => {
        const response = await fetch(`${NEON_DATA_API_URL}/rpc/${name}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(await response.text());
      };
      await callRpc("set_account_ai_budget", { p_hard_cap_eur: accountCap });
      await callRpc("set_activity_ai_budget", { p_profile_id: selectedProfile.id, p_hard_cap_eur: activityCap });
      await loadAiBudget();
      setBudgetDone("Budget AI aggiornato. I nuovi hard cap sono già applicati server-side.");
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : "";
      setBudgetError(detail.includes("ACTIVITY_AI_BUDGET_EXCEEDS_ACCOUNT_CAP")
        ? "Il budget dell’attività non può superare il budget globale."
        : detail.includes("ACCOUNT_AI_BUDGET_BELOW_ACTIVITY_CAPS")
          ? "Prima riduci i budget delle altre attività che superano il nuovo limite globale."
          : "Non è stato possibile aggiornare il budget AI.");
    } finally {
      setBudgetBusy(false);
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordDone(null);
    if (!currentPassword) { setPasswordError("Inserisci la password attuale."); return; }
    if (newPassword.length < 8) { setPasswordError("La nuova password deve avere almeno 8 caratteri."); return; }
    if (newPassword !== confirmPassword) { setPasswordError("Le nuove password non coincidono."); return; }
    setPasswordBusy(true);
    try {
      const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
      if (result.error) throw new Error(result.error.message || "Cambio password non riuscito.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordDone("Password aggiornata.");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Cambio password non riuscito.";
      setPasswordError(/invalid|incorrect|password/i.test(message) ? "La password attuale non è corretta." : "Cambio password non riuscito. Riprova.");
    } finally {
      setPasswordBusy(false);
    }
  }

  async function saveAccount(event: FormEvent) {
    event.preventDefault();
    const name = accountName.trim();
    setAccountError(null);
    setAccountDone(null);
    if (!name) { setAccountError("Inserisci il tuo nome."); return; }
    setAccountBusy(true);
    try {
      const result = await authClient.updateUser({ name });
      if (result.error) throw new Error(result.error.message || "Aggiornamento non riuscito.");
      setAccountName(name);
      setAccountDone("Dati account aggiornati.");
    } catch {
      setAccountError("Non è stato possibile aggiornare il nome. Riprova.");
    } finally {
      setAccountBusy(false);
    }
  }

  if (!selectedProfile || !autosave.draft) return null;
  const draft = autosave.draft;
  const currentOverview = overview?.profileId === selectedProfile.id ? overview : null;
  const patch = (field: keyof SettingsDraft, value: string) => autosave.setDraft((current) => ({ ...current, [field]: value }));

  return <div className="page-content">
    <header className="page-header"><div><p className="eyebrow">Impostazioni</p><h1>{selectedProfile.name}</h1><p>Gestisci attività, account e sicurezza.</p></div></header>
    {autosave.error && <p className="form-error" role="alert">Salvataggio non riuscito: {autosave.error}</p>}

    <section className="panel"><div className="panel-heading"><div><h2>Attività</h2><p>Dati principali del profilo selezionato.</p></div><Settings2 size={19} /></div><div className="form-grid" onBlurCapture={() => void autosave.flush().catch(() => undefined)}>
      <label>Nome attività<input value={draft.name} onChange={(event) => patch("name", event.target.value)} /></label>
      <label>Settore<input value={draft.industry} onChange={(event) => patch("industry", event.target.value)} /></label>
      <label className="full">Sito web<input type="url" value={draft.website} onChange={(event) => patch("website", event.target.value)} /></label>
      <label>Fuso orario<input value={draft.timezone} onChange={(event) => patch("timezone", event.target.value)} /></label>
      <label>Lingua<input value={draft.locale} onChange={(event) => patch("locale", event.target.value)} /></label>
    </div></section>

    <section className="panel"><div className="panel-heading"><div><h2>Account</h2><p>Dati dell’account con cui hai effettuato l’accesso.</p></div><KeyRound size={19} /></div><form className="form-grid" onSubmit={saveAccount}>
      <label>Nome<input autoComplete="name" value={accountName} onChange={(event) => setAccountName(event.target.value)} /></label>
      <label>Email<input type="email" value={session.data?.user?.email ?? ""} readOnly /></label>
      {accountError && <p className="form-error full" role="alert">{accountError}</p>}
      {accountDone && <p className="field-help full" role="status">{accountDone}</p>}
      <div className="full"><button className="compact-action" type="submit" disabled={accountBusy}>{accountBusy ? "Salvataggio…" : "Salva dati account"}</button></div>
    </form></section>

    <section className="panel"><div className="panel-heading"><div><h2>Sicurezza</h2><p>Per cambiare password devi confermare prima quella attuale.</p></div><ShieldCheck size={19} /></div><form className="form-grid" onSubmit={changePassword}>
      <label className="full">Password attuale<span className="password-input-wrap"><input type={showCurrentPassword ? "text" : "password"} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /><button type="button" className="password-toggle" aria-label={showCurrentPassword ? "Nascondi password" : "Mostra password"} onClick={() => setShowCurrentPassword((value) => !value)}>{showCurrentPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
      <label>Nuova password<span className="password-input-wrap"><input type={showNewPassword ? "text" : "password"} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><button type="button" className="password-toggle" aria-label={showNewPassword ? "Nascondi password" : "Mostra password"} onClick={() => setShowNewPassword((value) => !value)}>{showNewPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
      <label>Conferma nuova password<input type={showNewPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
      {passwordError && <p className="form-error full" role="alert">{passwordError}</p>}
      {passwordDone && <p className="field-help full" role="status">{passwordDone}</p>}
      <div className="full"><button className="compact-action" type="submit" disabled={passwordBusy}>{passwordBusy ? "Aggiornamento…" : "Aggiorna password"}</button></div>
    </form></section>

    <section className="panel"><div className="panel-heading"><div><h2>Budget AI</h2><p>Limiti massimi mensili reali. Il sistema può spendere meno, ma non può superare questi valori.</p></div><CreditCard size={19} /></div>
      <form className="form-grid" onSubmit={saveAiBudget}>
        <label>Budget globale account (€)<input inputMode="decimal" value={accountBudgetInput} onChange={(event) => setAccountBudgetInput(event.target.value)} /></label>
        <label>Budget attività (€)<input inputMode="decimal" value={activityBudgetInput} onChange={(event) => setActivityBudgetInput(event.target.value)} /></label>
        {aiBudget && <div className="full status-rows">
          <div><span>Spesa account questo mese</span><strong>{Number(aiBudget.account_spend_eur).toFixed(2)} € / {Number(aiBudget.account_hard_cap_eur).toFixed(2)} €</strong></div>
          <div><span>Residuo account</span><strong>{Number(aiBudget.account_remaining_eur).toFixed(2)} €</strong></div>
          <div><span>Spesa attività questo mese</span><strong>{Number(aiBudget.activity_spend_eur).toFixed(2)} € / {Number(aiBudget.activity_hard_cap_eur).toFixed(2)} €</strong></div>
          <div><span>Residuo attività</span><strong>{Number(aiBudget.activity_remaining_eur).toFixed(2)} €</strong></div>
          {budgetRecommendation && <div><span>Budget consigliato</span><strong>{budgetRecommendation.recommendedEur.toFixed(2)} €/mese</strong></div>}
        </div>}
        {budgetRecommendation && <>
          <p className="field-help full">Minimo operativo: <strong>{budgetRecommendation.minimumOperationalEur.toFixed(2)} €</strong> · Consigliato: <strong>{budgetRecommendation.recommendedEur.toFixed(2)} €</strong> · Intensivo: <strong>{budgetRecommendation.intensiveEur.toFixed(2)} €</strong> · {budgetRecommendation.mode === "DATA_DRIVEN" ? "basato sui dati reali" : "stima pre-storico"}</p>
          {Number(activityBudgetInput.replace(",", ".")) < budgetRecommendation.recommendedEur && <p className="field-help full">Con il budget attuale il sistema deve ottimizzare riuso, varianti e volume. Veridicità, fact-check e sicurezza non vengono sacrificati; se necessario produrrà meno contenuti.</p>}
          <div className="full"><button className="compact-action" type="button" onClick={() => setBudgetRecommendationOpen((value) => !value)}>{budgetRecommendationOpen ? "Nascondi calcolo" : "Perché questo budget?"}</button></div>
          {budgetRecommendationOpen && <div className="full status-rows">
            <div><span>Strategia e planning</span><strong>{budgetRecommendation.breakdown.strategyPlanningEur.toFixed(2)} €</strong></div>
            <div><span>Copy e adattamenti</span><strong>{budgetRecommendation.breakdown.copyAdaptationsEur.toFixed(2)} €</strong></div>
            <div><span>Research / fact-check</span><strong>{budgetRecommendation.breakdown.researchFactCheckEur.toFixed(2)} €</strong></div>
            <div><span>Visual AI</span><strong>{budgetRecommendation.breakdown.visualAiEur.toFixed(2)} €</strong></div>
            <div><span>QA</span><strong>{budgetRecommendation.breakdown.qaEur.toFixed(2)} €</strong></div>
            <div><span>Riserva operativa</span><strong>{budgetRecommendation.breakdown.reserveEur.toFixed(2)} €</strong></div>
            <p className="field-help">{budgetRecommendation.explanation}</p>
            {budgetRecommendation.assumptions.map((item) => <p className="field-help" key={item}>{item}</p>)}
          </div>}
        </>}
        {budgetError && <p className="form-error full" role="alert">{budgetError}</p>}
        {budgetDone && <p className="field-help full" role="status">{budgetDone}</p>}
        <div className="full"><button className="compact-action" type="submit" disabled={budgetBusy}>{budgetBusy ? "Salvataggio…" : "Modifica budget"}</button></div>
      </form>
    </section>

    <section className="panel"><div className="panel-heading"><div><h2>Piano e utilizzo</h2><p>Funzionalità e consumi dell’attività selezionata.</p></div><CreditCard size={19} /></div>
      {overviewBusy && !currentOverview ? <p>Caricamento piano…</p> : overviewError ? <div><p className="form-error" role="alert">{overviewError}</p><button className="compact-action" type="button" onClick={() => void loadOverview()}><RefreshCw size={15} /> Riprova</button></div> : currentOverview && <><p><strong>{currentOverview.plan.name}</strong></p><div className="status-rows">{currentOverview.plan.features.length ? currentOverview.plan.features.map((feature) => <div key={feature}><span>{feature}</span><strong className="status-ok">Disponibile</strong></div>) : <p className="field-help">Nessuna funzionalità attiva per questa attività.</p>}</div><div className="status-rows">{currentOverview.plan.usage.map((item) => <div key={item.label}><span>{item.label.charAt(0).toUpperCase() + item.label.slice(1)}</span><strong>{item.limit === null ? `${item.used} utilizzati ${item.periodLabel}` : `${item.used} di ${item.limit} utilizzati ${item.periodLabel}`}</strong></div>)}</div></>}
    </section>

    <section className="panel"><div className="panel-heading"><div><h2>Collegamenti social</h2><p>Stato di pubblicazione e Analytics, senza dettagli tecnici.</p></div><Share2 size={19} /></div>
      {currentOverview?.social && <div className="status-rows">{currentOverview.social.map((provider) => <div key={provider.label}><span>{provider.label}</span><strong className={provider.state === "Collegato" ? "status-ok" : "status-wait"}>{provider.state}</strong></div>)}</div>}
      <p><a className="compact-action" href="/app/social">Gestisci collegamenti</a></p>
    </section>

    <section className="panel"><h2>Cancellazione account</h2><p className="field-help">La cancellazione definitiva dell’account non è ancora disponibile. Prima devono essere verificati proprietà delle attività, collegamenti social e conservazione dei dati.</p></section>
  </div>;
}
