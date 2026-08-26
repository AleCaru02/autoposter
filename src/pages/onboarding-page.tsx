import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useProfiles } from "../features/profiles/profile-context";

export function OnboardingPage() {
  const { profiles, loading, createProfile } = useProfiles();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <main className="center-state">Caricamento profili…</main>;
  if (profiles.length > 0) return <Navigate to="/app/dashboard" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null); setBusy(true);
    try {
      await createProfile({ name, websiteUrl: website, industry });
      navigate("/app/brand", { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Creazione profilo non riuscita.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="onboarding-page"><section className="onboarding-card"><p className="eyebrow">Configurazione iniziale</p><h1>Crea la prima attività</h1><p>Ogni attività avrà dati, sito, brand, social, contenuti, calendario, metriche e apprendimento separati.</p><form className="auth-form" onSubmit={submit}><label>Nome attività<input required value={name} onChange={(event) => setName(event.target.value)} /></label><label>Sito web<input type="url" placeholder="https://..." value={website} onChange={(event) => setWebsite(event.target.value)} /></label><label>Settore<input placeholder="Es. Property management" value={industry} onChange={(event) => setIndustry(event.target.value)} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy} type="submit">{busy ? "Creazione…" : "Crea attività e continua"}</button></form></section></main>;
}
