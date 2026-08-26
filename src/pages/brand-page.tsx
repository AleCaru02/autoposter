import { useEffect, useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { neonClient } from "../lib/neon-client";
import { useProfiles } from "../features/profiles/profile-context";

type BrandRow = {
  profile_id: string;
  description: string | null;
  business_model: string | null;
  location: string | null;
  service_area: string | null;
  target_audience: unknown;
  tone_of_voice: unknown;
  social_links: unknown;
  goals: unknown;
};

export function BrandPage() {
  const { selectedProfile, reload } = useProfiles();
  const [description, setDescription] = useState("");
  const [businessModel, setBusinessModel] = useState("");
  const [location, setLocation] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [target, setTarget] = useState("");
  const [tone, setTone] = useState("");
  const [goals, setGoals] = useState("");
  const [instagram, setInstagram] = useState("");
  const [facebook, setFacebook] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [gbp, setGbp] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const profile = selectedProfile;
    if (!profile) return;
    let active = true;
    async function load() {
      setLoading(true); setError(null); setSaved(false);
      setWebsite(profile.website_url ?? ""); setIndustry(profile.industry ?? "");
      const result = await neonClient.from("brand_profiles").select("profile_id,description,business_model,location,service_area,target_audience,tone_of_voice,social_links,goals").eq("profile_id", profile.id).maybeSingle();
      if (!active) return;
      setLoading(false);
      if (result.error) { setError(result.error.message); return; }
      const row = result.data as BrandRow | null;
      setDescription(row?.description ?? ""); setBusinessModel(row?.business_model ?? ""); setLocation(row?.location ?? ""); setServiceArea(row?.service_area ?? "");
      const targetValue = row?.target_audience && typeof row.target_audience === "object" && "summary" in (row.target_audience as Record<string, unknown>) ? String((row.target_audience as Record<string, unknown>).summary ?? "") : "";
      const toneValue = row?.tone_of_voice && typeof row.tone_of_voice === "object" && "summary" in (row.tone_of_voice as Record<string, unknown>) ? String((row.tone_of_voice as Record<string, unknown>).summary ?? "") : "";
      setTarget(targetValue); setTone(toneValue); setGoals(Array.isArray(row?.goals) ? row!.goals.join(", ") : "");
      const socials = row?.social_links && typeof row.social_links === "object" ? row.social_links as Record<string, unknown> : {};
      setInstagram(String(socials.instagram ?? "")); setFacebook(String(socials.facebook ?? "")); setLinkedin(String(socials.linkedin ?? "")); setGbp(String(socials.googleBusinessProfile ?? ""));
    }
    void load(); return () => { active = false; };
  }, [selectedProfile?.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const profile = selectedProfile;
    if (!profile) return;
    setBusy(true); setError(null); setSaved(false);
    const profileUpdate = await neonClient.from("profiles").update({ website_url: website.trim() || null, industry: industry.trim() || null, updated_at: new Date().toISOString() }).eq("id", profile.id).select("id");
    if (profileUpdate.error) { setBusy(false); setError(profileUpdate.error.message); return; }
    const payload = { profile_id: profile.id, description: description.trim() || null, business_model: businessModel.trim() || null, location: location.trim() || null, service_area: serviceArea.trim() || null, target_audience: { summary: target.trim() }, tone_of_voice: { summary: tone.trim() }, social_links: { instagram: instagram.trim(), facebook: facebook.trim(), linkedin: linkedin.trim(), googleBusinessProfile: gbp.trim() }, goals: goals.split(",").map((item) => item.trim()).filter(Boolean), updated_at: new Date().toISOString() };
    const existing = await neonClient.from("brand_profiles").select("profile_id").eq("profile_id", profile.id).maybeSingle();
    if (existing.error) { setBusy(false); setError(existing.error.message); return; }
    const write = existing.data ? await neonClient.from("brand_profiles").update(payload).eq("profile_id", profile.id).select("profile_id") : await neonClient.from("brand_profiles").insert(payload).select("profile_id");
    setBusy(false);
    if (write.error) { setError(write.error.message); return; }
    await reload(); setSaved(true);
  }

  if (!selectedProfile) return null;
  return <div className="page-content"><header className="page-header"><div><p className="eyebrow">Brand · {selectedProfile.name}</p><h1>Dati attività e brand</h1><p>Questi dati sono persistenti e appartengono esclusivamente al profilo selezionato.</p></div></header>{error && <p className="form-error">{error}</p>}{saved && <p className="save-success">Salvataggio completato nel PostgreSQL.</p>}{loading ? <section className="panel">Caricamento…</section> : <form className="brand-form" onSubmit={submit}><section className="panel"><h2>Attività</h2><div className="form-grid"><label>Nome attività<input value={selectedProfile.name} disabled /></label><label>Settore<input value={industry} onChange={(event) => setIndustry(event.target.value)} /></label><label className="full">Sito web<input type="url" value={website} onChange={(event) => setWebsite(event.target.value)} /></label><label>Località<input value={location} onChange={(event) => setLocation(event.target.value)} /></label><label>Area servita<input value={serviceArea} onChange={(event) => setServiceArea(event.target.value)} /></label><label className="full">Descrizione<textarea rows={5} value={description} onChange={(event) => setDescription(event.target.value)} /></label><label className="full">Modello di business<textarea rows={3} value={businessModel} onChange={(event) => setBusinessModel(event.target.value)} /></label></div></section><section className="panel"><h2>Strategia di base</h2><div className="form-grid"><label className="full">Target<textarea rows={4} value={target} onChange={(event) => setTarget(event.target.value)} /></label><label className="full">Tono di voce<textarea rows={4} value={tone} onChange={(event) => setTone(event.target.value)} /></label><label className="full">Obiettivi, separati da virgola<input value={goals} onChange={(event) => setGoals(event.target.value)} /></label></div></section><section className="panel"><h2>Social dell’attività</h2><div className="form-grid"><label>Instagram<input type="url" value={instagram} onChange={(event) => setInstagram(event.target.value)} /></label><label>Facebook<input type="url" value={facebook} onChange={(event) => setFacebook(event.target.value)} /></label><label>LinkedIn<input type="url" value={linkedin} onChange={(event) => setLinkedin(event.target.value)} /></label><label>Google Business Profile<input type="url" value={gbp} onChange={(event) => setGbp(event.target.value)} /></label></div></section><div className="sticky-save"><button className="primary-button" disabled={busy} type="submit"><Save size={16} /> {busy ? "Salvataggio…" : "Salva dati attività"}</button></div></form>}</div>;
}
