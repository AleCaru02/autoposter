import { useState, type FormEvent } from "react";
import { Building2, Plus, Trash2 } from "lucide-react";
import { useProfiles } from "../features/profiles/profile-context";

export function ProfilesPage() {
  const { profiles, selectedProfileId, setSelectedProfileId, createProfile, deleteProfile, loading, error: loadError } = useProfiles();
  const [name, setName] = useState(""); const [website, setWebsite] = useState(""); const [industry, setIndustry] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try { await createProfile({ name, websiteUrl: website, industry }); setName(""); setWebsite(""); setIndustry(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Creazione non riuscita."); }
    finally { setBusy(false); }
  }

  async function remove(id: string, label: string) {
    if (!window.confirm(`Eliminare definitivamente “${label}” e tutti i suoi dati?`)) return;
    setBusy(true); setError(null);
    try { await deleteProfile(id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Eliminazione non riuscita."); }
    finally { setBusy(false); }
  }

  return <div className="page-content"><header className="page-header"><div><p className="eyebrow">Profili</p><h1>Le tue attività</h1><p>Puoi creare tutti i profili necessari. I dati restano isolati per attività.</p></div></header>{(error || loadError) && <p className="form-error">{error || loadError}</p>}<section className="profiles-grid">{loading ? <p>Caricamento…</p> : profiles.map((profile) => <article className={`profile-card ${selectedProfileId === profile.id ? "selected" : ""}`} key={profile.id} onClick={() => setSelectedProfileId(profile.id)}><div className="profile-card-icon"><Building2 size={20} /></div><div className="profile-card-copy"><h2>{profile.name}</h2><p>{profile.industry || "Settore non impostato"}</p><small>{profile.website_url || "Sito non impostato"}</small></div><button className="icon-danger" type="button" aria-label={`Elimina ${profile.name}`} disabled={busy} onClick={(event) => { event.stopPropagation(); void remove(profile.id, profile.name); }}><Trash2 size={16} /></button></article>)}</section><section className="panel"><h2>Aggiungi attività</h2><form className="inline-create wide" onSubmit={submit}><input required placeholder="Nome attività" value={name} onChange={(event) => setName(event.target.value)} /><input type="url" placeholder="https://sito.it" value={website} onChange={(event) => setWebsite(event.target.value)} /><input placeholder="Settore" value={industry} onChange={(event) => setIndustry(event.target.value)} /><button className="primary-button" disabled={busy} type="submit"><Plus size={16} /> {busy ? "Creazione…" : "Aggiungi"}</button></form></section></div>;
}
