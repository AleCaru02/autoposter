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

  return <div className="page-content"><header className="page-header"><div><p className="eyebrow">Profili</p><h1>Le tue attività</h1><p>Ogni attività mantiene separati brand, sito, social, contenuti, calendario e dati.</p></div><button className="compact-action" type="button" onClick={() => navigate("/onboarding?new=1")}><Plus size={16} /> Nuova attività</button></header>{loadError && <p className="form-error" role="alert">{loadError}</p>}<section className="profiles-grid">{loading ? <p>Caricamento…</p> : profiles.map((profile) => <article className={`profile-card ${selectedProfileId === profile.id ? "selected" : ""}`} key={profile.id} role="button" tabIndex={0} aria-pressed={selectedProfileId === profile.id} onKeyDown={(event) => selectWithKeyboard(event, profile.id)} onClick={() => setSelectedProfileId(profile.id)}><div className="profile-card-icon"><Building2 size={20} /></div><div className="profile-card-copy"><h2>{profile.name}</h2><p>{profile.industry || "Settore da completare"}</p><small>{profile.website_url || "Sito non impostato"}</small></div></article>)}</section><section className="panel"><h2>Cancellazione attività</h2><p className="field-help">La cancellazione definitiva non è ancora disponibile: richiede una verifica protetta di contenuti, pubblicazioni, collegamenti social e conservazione dei dati.</p></section></div>;
}
