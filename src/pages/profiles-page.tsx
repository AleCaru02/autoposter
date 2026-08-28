import { useState, type KeyboardEvent } from "react";
import { Building2, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useProfiles } from "../features/profiles/profile-context";

export function ProfilesPage() {
  const navigate = useNavigate();
  const { profiles, selectedProfileId, setSelectedProfileId, deleteProfile, loading, error: loadError } = useProfiles();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function remove(id: string, label: string) {
    if (busyId) return;
    if (!window.confirm(`Eliminare definitivamente “${label}” e tutti i suoi dati?`)) return;
    setBusyId(id);
    try { await deleteProfile(id); }
    catch (reason) { window.alert(reason instanceof Error ? reason.message : "Eliminazione non riuscita."); }
    finally { setBusyId(null); }
  }

  function selectWithKeyboard(event: KeyboardEvent<HTMLElement>, id: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setSelectedProfileId(id);
  }

  return <div className="page-content"><header className="page-header"><div><p className="eyebrow">Profili</p><h1>Le tue attività</h1><p>Ogni attività mantiene separati brand, sito, social, contenuti, calendario e dati.</p></div><button className="compact-action" type="button" onClick={() => navigate("/onboarding?new=1")}><Plus size={16} /> Nuova attività</button></header>{loadError && <p className="form-error" role="alert">{loadError}</p>}<section className="profiles-grid">{loading ? <p>Caricamento…</p> : profiles.map((profile) => <article className={`profile-card ${selectedProfileId === profile.id ? "selected" : ""}`} key={profile.id} role="button" tabIndex={0} aria-pressed={selectedProfileId === profile.id} onKeyDown={(event) => selectWithKeyboard(event, profile.id)} onClick={() => setSelectedProfileId(profile.id)}><div className="profile-card-icon"><Building2 size={20} /></div><div className="profile-card-copy"><h2>{profile.name}</h2><p>{profile.industry || "Settore da completare"}</p><small>{profile.website_url || "Sito non impostato"}</small></div><button className="icon-danger" type="button" aria-label={`Elimina ${profile.name}`} disabled={Boolean(busyId)} onClick={(event) => { event.stopPropagation(); void remove(profile.id, profile.name); }}>{busyId === profile.id ? "…" : <Trash2 size={16} />}</button></article>)}</section></div>;
}
