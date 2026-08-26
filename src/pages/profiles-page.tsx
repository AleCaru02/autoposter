import { Building2, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useProfiles } from "../features/profiles/profile-context";

export function ProfilesPage() {
  const navigate = useNavigate();
  const { profiles, selectedProfileId, setSelectedProfileId, deleteProfile, loading, error: loadError } = useProfiles();
  const busy = false;

  async function remove(id: string, label: string) {
    if (!window.confirm(`Eliminare definitivamente “${label}” e tutti i suoi dati?`)) return;
    try { await deleteProfile(id); }
    catch (reason) { window.alert(reason instanceof Error ? reason.message : "Eliminazione non riuscita."); }
  }

  return <div className="page-content"><header className="page-header"><div><p className="eyebrow">Profili</p><h1>Le tue attività</h1><p>Ogni attività mantiene separati brand, sito, social, contenuti, calendario e dati.</p></div><button className="compact-action" type="button" onClick={() => navigate("/onboarding?new=1")}><Plus size={16} /> Nuova attività</button></header>{loadError && <p className="form-error">{loadError}</p>}<section className="profiles-grid">{loading ? <p>Caricamento…</p> : profiles.map((profile) => <article className={`profile-card ${selectedProfileId === profile.id ? "selected" : ""}`} key={profile.id} onClick={() => setSelectedProfileId(profile.id)}><div className="profile-card-icon"><Building2 size={20} /></div><div className="profile-card-copy"><h2>{profile.name}</h2><p>{profile.industry || "Settore da completare"}</p><small>{profile.website_url || "Sito non impostato"}</small></div><button className="icon-danger" type="button" aria-label={`Elimina ${profile.name}`} disabled={busy} onClick={(event) => { event.stopPropagation(); void remove(profile.id, profile.name); }}><Trash2 size={16} /></button></article>)}</section></div>;
}
