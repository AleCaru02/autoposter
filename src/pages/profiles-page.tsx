import type { KeyboardEvent } from "react";
import { Building2, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useProfiles } from "../features/profiles/profile-context";

export function ProfilesPage() {
  const navigate = useNavigate();
  const { profiles, selectedProfileId, setSelectedProfileId, loading, error: loadError } = useProfiles();

  function selectWithKeyboard(event: KeyboardEvent<HTMLElement>, id: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setSelectedProfileId(id);
  }

  return <div className="page-content"><header className="page-header"><div><p className="eyebrow">Attività</p><h1>Le tue attività</h1><p>Ogni attività mantiene separati brand, sito, social, contenuti, calendario, metriche e apprendimento.</p></div><button className="compact-action" type="button" onClick={() => navigate("/onboarding?new=1")}><Plus size={16} /> Nuova attività</button></header>{loadError && <p className="form-error" role="alert">{loadError}</p>}<section className="profiles-grid" aria-label="Attività disponibili">{loading ? <p>Caricamento…</p> : profiles.map((profile) => { const selected = selectedProfileId === profile.id; return <article className={`profile-card ${selected ? "selected" : ""}`} key={profile.id} role="button" tabIndex={0} aria-pressed={selected} onKeyDown={(event) => selectWithKeyboard(event, profile.id)} onClick={() => setSelectedProfileId(profile.id)}><div className="profile-card-icon"><Building2 size={20} /></div><div className="profile-card-copy"><div className="profile-card-title-row"><h2>{profile.name}</h2>{selected && <span className="profile-active-badge">Attiva</span>}</div><p>{profile.industry || "Settore da completare"}</p><small>{profile.website_url || "Sito non impostato"}</small></div></article>; })}</section></div>;
}
