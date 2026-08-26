import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, RefreshCw, Save, Sparkles } from "lucide-react";
import { authClient, neonClient } from "../lib/neon-client";
import { useProfiles } from "../features/profiles/profile-context";

type JwtAuth = { getJWTToken?: () => Promise<string | null> };
type BrandRow = {
  profile_id: string;
  description: string | null;
  business_model: string | null;
  location: string | null;
  service_area: string | null;
  target_audience: unknown;
  tone_of_voice: unknown;
  visual_identity: unknown;
  services: unknown;
  differentiators: unknown;
  value_propositions: unknown;
  goals: unknown;
};
type VisualHints = { colors: string[]; socialLinks: Record<string, string>; logoUrl: string | null };

const STANDARD_GOALS = ["Più richieste", "Più prenotazioni", "Notorietà locale", "Educare il pubblico", "Fiducia nel brand", "Traffico al sito"];

function summary(value: unknown) {
  return value && typeof value === "object" && "summary" in (value as Record<string, unknown>) ? String((value as Record<string, unknown>).summary ?? "") : "";
}
function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
function nestedList(value: unknown, key: string) {
  return value && typeof value === "object" && Array.isArray((value as Record<string, unknown>)[key]) ? ((value as Record<string, unknown>)[key] as unknown[]).filter((item): item is string => typeof item === "string") : [];
}

export function BrandPage() {
  const { selectedProfile, reload } = useProfiles();
  const [description, setDescription] = useState("");
  const [businessModel, setBusinessModel] = useState("");
  const [location, setLocation] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [website, setWebsite] = useState("");
  const [industry, setIndustry] = useState("");
  const [target, setTarget] = useState("");
  const [targetSegments, setTargetSegments] = useState<string[]>([]);
  const [tone, setTone] = useState("");
  const [toneTraits, setToneTraits] = useState<string[]>([]);
  const [goals, setGoals] = useState<string[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [differentiators, setDifferentiators] = useState<string[]>([]);
  const [valuePropositions, setValuePropositions] = useState<string[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [visualSummary, setVisualSummary] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const profile = selectedProfile;
    if (!profile) return;
    setLoading(true); setError(null); setSaved(false);
    setWebsite(profile.website_url ?? ""); setIndustry(profile.industry ?? "");
    const result = await neonClient.from("brand_profiles").select("profile_id,description,business_model,location,service_area,target_audience,tone_of_voice,visual_identity,services,differentiators,value_propositions,goals").eq("profile_id", profile.id).maybeSingle();
    setLoading(false);
    if (result.error) { setError(result.error.message); return; }
    const row = result.data as BrandRow | null;
    setDescription(row?.description ?? ""); setBusinessModel(row?.business_model ?? ""); setLocation(row?.location ?? ""); setServiceArea(row?.service_area ?? "");
    setTarget(summary(row?.target_audience)); setTargetSegments(nestedList(row?.target_audience, "segments"));
    setTone(summary(row?.tone_of_voice)); setToneTraits(nestedList(row?.tone_of_voice, "traits"));
    setGoals(stringList(row?.goals)); setServices(stringList(row?.services)); setDifferentiators(stringList(row?.differentiators)); setValuePropositions(stringList(row?.value_propositions));
    const visual = row?.visual_identity && typeof row.visual_identity === "object" ? row.visual_identity as Record<string, unknown> : {};
    setColors(Array.isArray(visual.observedColors) ? visual.observedColors.filter((item): item is string => typeof item === "string") : []);
    setVisualSummary(typeof visual.summary === "string" ? visual.summary : "");
  }, [selectedProfile]);

  useEffect(() => { void load(); }, [load]);

  async function jwt() {
    const token = await (authClient as typeof authClient & JwtAuth).getJWTToken?.();
    if (!token) throw new Error("Sessione non valida. Accedi di nuovo.");
    return token;
  }

  async function analyzeWebsite() {
    if (!selectedProfile?.id || !selectedProfile.website_url || analyzing) return;
    setAnalyzing(true); setError(null); setSaved(false);
    try {
      const token = await jwt();
      const scanResponse = await fetch("/api/website-scan", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ profileId: selectedProfile.id, pageLimit: 500 }) });
      const scanBody = await scanResponse.json() as { visualHints?: VisualHints; error?: string; detail?: string };
      if (!scanResponse.ok) throw new Error(scanBody.detail || scanBody.error || "Analisi sito non riuscita.");
      const analysisResponse = await fetch("/api/onboarding-analyze", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ profileId: selectedProfile.id, visualHints: scanBody.visualHints ?? { colors: [], socialLinks: {}, logoUrl: null } }) });
      const body = await analysisResponse.json() as { error?: string; detail?: string };
      if (!analysisResponse.ok) throw new Error(body.detail || body.error || "Analisi brand non riuscita.");
      await reload();
      await load();
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Analisi non riuscita.");
    } finally { setAnalyzing(false); }
  }

  function toggleGoal(goal: string) {
    setGoals((current) => current.includes(goal) ? current.filter((item) => item !== goal) : [...current, goal]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const profileId = selectedProfile?.id;
    if (!profileId) return;
    setBusy(true); setError(null); setSaved(false);
    const profileUpdate = await neonClient.from("profiles").update({ website_url: website.trim() || null, industry: industry.trim() || null, updated_at: new Date().toISOString() }).eq("id", profileId).select("id");
    if (profileUpdate.error) { setBusy(false); setError(profileUpdate.error.message); return; }
    const current = await neonClient.from("brand_profiles").select("profile_id,visual_identity,services,differentiators,value_propositions").eq("profile_id", profileId).maybeSingle();
    if (current.error) { setBusy(false); setError(current.error.message); return; }
    const payload = { profile_id: profileId, description: description.trim() || null, business_model: businessModel.trim() || null, location: location.trim() || null, service_area: serviceArea.trim() || null, target_audience: { summary: target.trim(), segments: targetSegments }, tone_of_voice: { summary: tone.trim(), traits: toneTraits }, goals, updated_at: new Date().toISOString() };
    const write = current.data ? await neonClient.from("brand_profiles").update(payload).eq("profile_id", profileId).select("profile_id") : await neonClient.from("brand_profiles").insert({ ...payload, services, differentiators, value_propositions: valuePropositions, visual_identity: { observedColors: colors, summary: visualSummary } }).select("profile_id");
    setBusy(false);
    if (write.error) { setError(write.error.message); return; }
    await reload(); setSaved(true);
  }

  const goalOptions = useMemo(() => [...new Set([...STANDARD_GOALS, ...goals])], [goals]);
  if (!selectedProfile) return null;

  return <div className="page-content"><header className="page-header"><div><p className="eyebrow">Brand · {selectedProfile.name}</p><h1>Identità dell’attività</h1><p>Il sistema usa il sito come base e tu correggi solo ciò che serve.</p></div>{selectedProfile.website_url && <button className="compact-action" type="button" disabled={analyzing} onClick={() => void analyzeWebsite()}><RefreshCw size={15} className={analyzing ? "spin" : ""} /> {analyzing ? "Analisi in corso…" : "Analizza di nuovo il sito"}</button>}</header>{error && <p className="form-error">{error}</p>}{saved && <p className="save-success"><Check size={14} /> Dati aggiornati.</p>}{loading ? <section className="panel">Caricamento…</section> : <form className="brand-form" onSubmit={submit}>
    <section className="panel brand-intelligence"><div className="panel-heading"><div><h2>Brand rilevato</h2><p>Informazioni ricavate dalle pagine del sito, modificabili in qualsiasi momento.</p></div><Sparkles size={19} /></div>{colors.length > 0 && <div className="brand-colors">{colors.slice(0, 8).map((color) => <span key={color} title={color} style={{ background: color }} />)}</div>}{visualSummary && <p className="brand-summary">{visualSummary}</p>}<div className="insight-groups">{toneTraits.length > 0 && <div><small>Tono</small><div className="insight-chips">{toneTraits.map((item) => <span key={item}>{item}</span>)}</div></div>}{targetSegments.length > 0 && <div><small>Pubblico</small><div className="insight-chips">{targetSegments.map((item) => <span key={item}>{item}</span>)}</div></div>}{services.length > 0 && <div><small>Servizi</small><div className="insight-chips">{services.map((item) => <span key={item}>{item}</span>)}</div></div>}</div></section>
    <section className="panel"><h2>Obiettivi</h2><p className="section-hint">Seleziona quelli che vuoi usare. Le proposte iniziali arrivano dall’analisi del sito.</p><div className="goal-options">{goalOptions.map((goal) => <button className={`goal-chip ${goals.includes(goal) ? "selected" : ""}`} type="button" key={goal} onClick={() => toggleGoal(goal)}>{goals.includes(goal) && <Check size={13} />}{goal}</button>)}</div></section>
    <details className="panel editable-details"><summary>Modifica manualmente i dati</summary><div className="form-grid details-grid"><label>Settore<input value={industry} onChange={(event) => setIndustry(event.target.value)} /></label><label>Località<input value={location} onChange={(event) => setLocation(event.target.value)} /></label><label className="full">Sito web<input type="url" value={website} onChange={(event) => setWebsite(event.target.value)} /></label><label>Area servita<input value={serviceArea} onChange={(event) => setServiceArea(event.target.value)} /></label><label className="full">Descrizione<textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} /></label><label className="full">Modello di business<textarea rows={3} value={businessModel} onChange={(event) => setBusinessModel(event.target.value)} /></label><label className="full">Target<textarea rows={3} value={target} onChange={(event) => setTarget(event.target.value)} /></label><label className="full">Tono di voce<textarea rows={3} value={tone} onChange={(event) => setTone(event.target.value)} /></label></div></details>
    <div className="form-actions"><button className="compact-action save-action" disabled={busy} type="submit"><Save size={15} /> {busy ? "Salvataggio…" : "Salva modifiche"}</button></div>
  </form>}</div>;
}
