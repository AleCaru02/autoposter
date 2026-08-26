import { Eye, EyeOff, KeyRound, Settings2, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { authClient } from "../lib/neon-client";
import { useAutoSaveDraft } from "../lib/use-autosave-draft";
import { useProfiles } from "../features/profiles/profile-context";

type SettingsDraft = {
  name: string;
  website: string;
  industry: string;
  timezone: string;
  locale: string;
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
      setPasswordError(/invalid|incorrect|password/i.test(message) ? "La password attuale non è corretta." : message);
    } finally {
      setPasswordBusy(false);
    }
  }

  if (!selectedProfile || !autosave.draft) return null;
  const draft = autosave.draft;
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

    <section className="panel"><div className="panel-heading"><div><h2>Account</h2><p>Dati dell’account con cui hai effettuato l’accesso.</p></div><KeyRound size={19} /></div><div className="form-grid"><label className="full">Email<input value={session.data?.user?.email ?? ""} readOnly /></label></div></section>

    <section className="panel"><div className="panel-heading"><div><h2>Sicurezza</h2><p>Per cambiare password devi confermare prima quella attuale.</p></div><ShieldCheck size={19} /></div><form className="form-grid" onSubmit={changePassword}>
      <label className="full">Password attuale<span className="password-input-wrap"><input type={showCurrentPassword ? "text" : "password"} autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /><button type="button" className="password-toggle" aria-label={showCurrentPassword ? "Nascondi password" : "Mostra password"} onClick={() => setShowCurrentPassword((value) => !value)}>{showCurrentPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
      <label>Nuova password<span className="password-input-wrap"><input type={showNewPassword ? "text" : "password"} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><button type="button" className="password-toggle" aria-label={showNewPassword ? "Nascondi password" : "Mostra password"} onClick={() => setShowNewPassword((value) => !value)}>{showNewPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></span></label>
      <label>Conferma nuova password<input type={showNewPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
      {passwordError && <p className="form-error full" role="alert">{passwordError}</p>}
      {passwordDone && <p className="field-help full" role="status">{passwordDone}</p>}
      <div className="full"><button className="compact-action" type="submit" disabled={passwordBusy}>{passwordBusy ? "Aggiornamento…" : "Aggiorna password"}</button></div>
    </form></section>
  </div>;
}
