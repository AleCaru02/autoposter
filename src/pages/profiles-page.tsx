import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Building2, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useProfiles } from "../features/profiles/profile-context";
import { adminRequest } from "../lib/admin-api";
import { clearNewActivityFlow } from "../lib/onboarding-flow";

export function ProfilesPage() {
  const navigate = useNavigate();
  const { profiles, selectedProfileId, setSelectedProfileId, loading, error: loadError, reload } = useProfiles();
  const [isAdmin, setIsAdmin] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const selectedProfile = useMemo(() => profiles.find((profile) => profile.id === selectedProfileId) ?? null, [profiles, selectedProfileId]);

  useEffect(() => {
    let active = true;
    void adminRequest<{ platformRole?: string }>("/api/admin/me")
      .then((body) => { if (active) setIsAdmin(body.platformRole === "SUPER_ADMIN"); })
      .catch(() => { if (active) setIsAdmin(false); });
    return () => { active = false; };
  }, []);

  function selectWithKeyboard(event: KeyboardEvent<HTMLElement>, id: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setSelectedProfileId(id);
  }

  async function archiveSelectedActivity() {
    if (!isAdmin || !selectedProfile || archiving) return;
    const confirmed = window.confirm(
      `Eliminare "${selectedProfile.name}" dall'app?\n\nL'attività verrà archiviata in modo protetto e i dati resteranno recuperabili.`,
    );
    if (!confirmed) return;
    setArchiving(true);
    setActionError(null);
    try {
      await adminRequest<{ archived: boolean; profileId: string }>(
        `/api/admin/activities/${encodeURIComponent(selectedProfile.id)}/archive`,
        { method: "POST" },
      );
      await reload();
    } catch {
      setActionError("Non sono riuscito a eliminare l’attività. Riprova.");
    } finally {
      setArchiving(false);
    }
  }

  return <div className="page-content"><header className="page-header"><div><p className="eyebrow">Attività</p><h1>Le tue attività</h1><p>Ogni attività mantiene separati brand, sito, social, contenuti, calendario, metriche e apprendimento.</p></div><div className="activity-header-actions">{isAdmin && <button className="compact-action activity-delete-action" type="button" disabled={!selectedProfile || archiving} onClick={() => void archiveSelectedActivity()}><Trash2 size={16} /> {archiving ? "Eliminazione…" : "Elimina attività"}</button>}<button className="compact-action" type="button" onClick={() => { clearNewActivityFlow(); navigate("/onboarding?new=1"); }}><Plus size={16} /> Nuova attività</button></div></header>{(loadError || actionError) && <p className="form-error" role="alert">{loadError || actionError}</p>}<section className="profiles-grid" aria-label="Attività disponibili">{loading ? <p>Caricamento…</p> : profiles.map((profile) => { const selected = selectedProfileId === profile.id; return <article className={`profile-card ${selected ? "selected" : ""}`} key={profile.id} role="button" tabIndex={0} aria-pressed={selected} onKeyDown={(event) => selectWithKeyboard(event, profile.id)} onClick={() => setSelectedProfileId(profile.id)}><div className="profile-card-icon"><Building2 size={20} /></div><div className="profile-card-copy"><div className="profile-card-title-row"><h2>{profile.name}</h2>{selected && <span className="profile-active-badge">Attiva</span>}</div><p>{profile.industry || "Settore da completare"}</p><small>{profile.website_url || "Sito non impostato"}</small></div></article>; })}</section></div>;
}
