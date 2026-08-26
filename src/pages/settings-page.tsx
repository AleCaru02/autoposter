import { Check, Cloud, KeyRound, LoaderCircle, Settings2 } from "lucide-react";
import { useCallback, useEffect } from "react";
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

function SaveState({ status }: { status: "IDLE" | "WAITING" | "SAVING" | "SAVED" | "ERROR" }) {
  if (status === "SAVING" || status === "WAITING") return <span className="autosave-state saving"><LoaderCircle className="spin" size={14} /> Salvataggio…</span>;
  if (status === "ERROR") return <span className="autosave-state error">Salvataggio non riuscito</span>;
  return <span className="autosave-state saved"><Check size={14} /> Salvato automaticamente</span>;
}

export function SettingsPage() {
  const session = authClient.useSession();
  const { selectedProfile, updateProfile } = useProfiles();

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

  if (!selectedProfile || !autosave.draft) return null;
  const draft = autosave.draft;
  const patch = (field: keyof SettingsDraft, value: string) => autosave.setDraft((current) => ({ ...current, [field]: value }));

  return <div className="page-content">
    <header className="page-header"><div><p className="eyebrow">Impostazioni</p><h1>{selectedProfile.name}</h1><p>Le modifiche vengono salvate mentre le fai. Non esiste un pulsante Salva.</p></div><SaveState status={autosave.status} /></header>
    {autosave.error && <p className="form-error" role="alert">{autosave.error}</p>}

    <section className="panel"><div className="panel-heading"><div><h2>Attività</h2><p>Dati principali del profilo selezionato.</p></div><Settings2 size={19} /></div><div className="form-grid" onBlurCapture={() => void autosave.flush().catch(() => undefined)}>
      <label>Nome attività<input value={draft.name} onChange={(event) => patch("name", event.target.value)} /></label>
      <label>Settore<input value={draft.industry} onChange={(event) => patch("industry", event.target.value)} /></label>
      <label className="full">Sito web<input type="url" value={draft.website} onChange={(event) => patch("website", event.target.value)} /></label>
      <label>Fuso orario<input value={draft.timezone} onChange={(event) => patch("timezone", event.target.value)} /></label>
      <label>Lingua<input value={draft.locale} onChange={(event) => patch("locale", event.target.value)} /></label>
    </div></section>

    <section className="panel settings-account"><div><KeyRound size={18} /><div><h2>Account</h2><p>{session.data?.user?.email ?? "Account autenticato"}</p></div></div><small>Accesso e credenziali sono gestiti dall’autenticazione del sistema.</small></section>

    <section className="panel settings-account"><div><Cloud size={18} /><div><h2>OpenAI</h2><p>Gestito centralmente da Post Automatici.</p></div></div><small>Gli account non devono inserire né conoscere una chiave API. Testi e immagini usano la configurazione server-side del prodotto.</small></section>
  </div>;
}
