import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { authClient, neonClient } from "../lib/neon-client";
import { useAutoSaveDraft } from "../lib/use-autosave-draft";
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
type BrandDraft = {
  name: string;
  description: string;
  businessModel: string;
  location: string;
  serviceArea: string;
  website: string;
  industry: string;
  target: string;
  targetSegments: string[];
  tone: string;
  toneTraits: string[];
  goals: string[];
  services: string[];
  differentiators: string[];
  valuePropositions: string[];
  colors: string[];
  visualSummary: string;
};

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

function AutoSaveState({ status }: { status: "IDLE" | "WAITING" | "SAVING" | "SAVED" | "ERROR" }) {
  if (status === "WAITING" || status === "SAVING") return <span className="autosave-state saving"><LoaderCircle className="spin" size={14} /> Salvataggio…</span>;
  if (status === "ERROR") return <span className="autosave-state error">Salvataggio non riuscito</span>;
  return <span className="autosave-state saved"><Check size={14} /> Salvato automaticamente</span>;
}

export function BrandPage() {
  const { selectedProfile, reload, updateProfile } = useProfiles();
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const save = useCallback(async (draft: BrandDraft) => {
    const profileId = selectedProfile?.id;
    if (!profileId) return;
    await updateProfile(profileId, {
      name: draft.name,
      website_url: draft.website,
      industry: draft.industry,
    });
    const current = await neonClient.from("brand_profiles").select("profile_id").eq("profile_id", profileId).maybeSingle();
    if (current.error) throw new Error(current.error.message);
    const payload = {
      profile_id: profileId,
      description: draft.description.trim() || null,
      business_model: draft.businessModel.trim() || null,
      location: draft.location.trim() || null,
      service_area: draft.serviceArea.trim() || null,
      target_audience: { summary: draft.target.trim(), segments: draft.targetSegments },
      tone_of_voice: { summary: draft.tone.trim(), traits: draft.toneTraits },
      goals: draft.goals,
      services: draft.services,
      differentiators: draft.differentiators,
      value_propositions: draft.valuePropositions,
      visual_identity: { observedColors: draft.colors, summary: draft.visualSummary },
      updated_at: new Date().toISOString(),
    };
    const write = current.data
      ? await neonClient.from("brand_profiles").update(payload).eq("profile_id", profileId).select("profile_id")
      : await neonClient.from("brand_profiles").insert(payload).select("profile_id");
    if (write.error) throw new Error(write.error.message);
  }, [selectedProfile?.id, updateProfile]);

  const autosave = useAutoSaveDraft<BrandDraft>(save, 500);

  const load = useCallback(async () => {
    const profile = selectedProfile;
    if (!profile) return;
    setLoading(true); setPageError(null);
    const result = await neonClient.from("brand_profiles").select("profile_id,description,business_model,location,service_area,target_audience,tone_of_voice,visual_identity,services,differentiators,value_propositions,goals").eq("profile_id", profile.id).maybeSingle();
    setLoading(false);
    if (result.error) { setPageError(result.error.message); return; }
    const row = result.data as BrandRow | null;
    const visual = row?.visual_identity && typeof row.visual_identity === "object" ? row.visual_identity as Record<string, unknown> : {};
    autosave.replaceDraft({
      name: profile.name,
      description: row?.description ?? "",
      businessModel: row?.business_model ?? "",
      location: row?.location ?? "",
      serviceArea: row?.service_area ?? "",
      website: profile.website_url ?? "",
      industry: profile.industry ?? "",
      target: summary(row?.target_audience),
      targetSegments: nestedList(row?.target_audience, "segments"),
      tone: summary(row?.tone_of_voice),
      toneTraits: nestedList(row?.tone_of_voice, "traits"),
      goals: stringList(row?.goals),
      services: stringList(row?.services),
      differentiators: stringList(row?.differentiators),
      valuePropositions: stringList(row?.value_propositions),
      colors: Array.isArray(visual.observedColors) ? visual.observedColors.filter((item): item is string => typeof item === "string") : [],
      visualSummary: typeof visual.summary === "string" ? visual.summary : "",
    });
  }, [selectedProfile?.id]);

  useEffect(() => { void load(); }, [load]);

  async function jwt() {
    const token = await (authClient as typeof authClient & JwtAuth).getJWTToken?.();
    if (!token) throw new Error("Sessione non valida. Accedi di nuovo.");
    return token;
  }

  async function analyzeWebsite() {
    const profileId = selectedProfile?.id;
    if (!profileId || analyzing || !autosave.draft?.website.trim()) return;
    setAnalyzing(true); setPageError(null);
    try {
      await autosave.flush();
      const token = await jwt();
      const scanResponse = await fetch("/api/website-scan", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ profileId, pageLimit: 500 }) });
      const scanBody = await scanResponse.json() as { visualHints?: VisualHints; error?: string; detail?: string };
      if (!scanResponse.ok) throw new Error(scanBody.detail || scanBody.error || "Analisi sito non riuscita.");
      const analysisResponse = await fetch("/api/onboarding-analyze", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ profileId, visualHints: scanBody.visualHints ?? { colors: [], socialLinks: {}, logoUrl: null } }) });
      const body = await analysisResponse.json() as { error?: string; detail?: string };
      if (!analysisResponse.ok) throw new Error(body.detail || body.error || "Analisi brand non riuscita.");
      await reload();
      await load();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "Analisi non riuscita.");
    } finally { setAnalyzing(false); }
  }

  const draft = autosave.draft;
  const goalOptions = useMemo(() => [...new Set([...STANDARD_GOALS, ...(draft?.goals ?? [])])], [draft?.goals]);
  if (!selectedProfile) return null;
  if (loading || !draft) return <div className="page-content"><section className="panel">Caricamento…</section></div>;

  const patch = <K extends keyof BrandDraft>(field: K, value: BrandDraft[K]) => autosave.setDraft((current) => ({ ...current, [field]: value }));
  const toggleGoal = (goal: string) => patch("goals", draft.goals.includes(goal) ? draft.goals.filter((item) => item !== goal) : [...draft.goals, goal]);

  return <div className="page-content"><header className="page-header"><div><p className="eyebrow">Brand · {draft.name}</p><h1>Identità dell’attività</h1><p>Il sistema usa il sito come base. Qualsiasi modifica viene salvata automaticamente.</p></div><div className="header-actions"><AutoSaveState status={autosave.status} />{draft.website.trim() && <button className="compact-action" type="button" disabled={analyzing} onClick={() => void analyzeWebsite()}><RefreshCw size={15} className={analyzing ? "spin" : ""} /> {analyzing ? "Analisi in corso…" : "Analizza di nuovo il sito"}</button>}</div></header>{(pageError || autosave.error) && <p className="form-error">{pageError || autosave.error}</p>}
    <section className="panel brand-intelligence"><div className="panel-heading"><div><h2>Brand rilevato</h2><p>Informazioni ricavate dalle pagine del sito e già associate a questa attività.</p></div><Sparkles size={19} /></div>{draft.colors.length > 0 && <div className="brand-colors">{draft.colors.slice(0, 8).map((color) => <span key={color} title={color} style={{ background: color }} />)}</div>}{draft.visualSummary && <p className="brand-summary">{draft.visualSummary}</p>}<div className="insight-groups">{draft.toneTraits.length > 0 && <div><small>Tono</small><div className="insight-chips">{draft.toneTraits.map((item) => <span key={item}>{item}</span>)}</div></div>}{draft.targetSegments.length > 0 && <div><small>Pubblico</small><div className="insight-chips">{draft.targetSegments.map((item) => <span key={item}>{item}</span>)}</div></div>}{draft.services.length > 0 && <div><small>Servizi</small><div className="insight-chips">{draft.services.map((item) => <span key={item}>{item}</span>)}</div></div>}</div></section>
    <section className="panel"><h2>Obiettivi</h2><p className="section-hint">Tocca un obiettivo per attivarlo o disattivarlo. Il cambiamento viene salvato da solo.</p><div className="goal-options">{goalOptions.map((goal) => <button className={`goal-chip ${draft.goals.includes(goal) ? "selected" : ""}`} type="button" key={goal} onClick={() => toggleGoal(goal)}>{draft.goals.includes(goal) && <Check size={13} />}{goal}</button>)}</div></section>
    <details className="panel editable-details"><summary>Modifica dati attività e brand</summary><div className="form-grid details-grid" onBlurCapture={() => void autosave.flush().catch(() => undefined)}><label>Nome attività<input value={draft.name} onChange={(event) => patch("name", event.target.value)} /></label><label>Settore<input value={draft.industry} onChange={(event) => patch("industry", event.target.value)} /></label><label className="full">Sito web<input type="url" value={draft.website} onChange={(event) => patch("website", event.target.value)} /></label><label>Località<input value={draft.location} onChange={(event) => patch("location", event.target.value)} /></label><label>Area servita<input value={draft.serviceArea} onChange={(event) => patch("serviceArea", event.target.value)} /></label><label className="full">Descrizione<textarea rows={4} value={draft.description} onChange={(event) => patch("description", event.target.value)} /></label><label className="full">Modello di business<textarea rows={3} value={draft.businessModel} onChange={(event) => patch("businessModel", event.target.value)} /></label><label className="full">Target<textarea rows={3} value={draft.target} onChange={(event) => patch("target", event.target.value)} /></label><label className="full">Tono di voce<textarea rows={3} value={draft.tone} onChange={(event) => patch("tone", event.target.value)} /></label></div></details>
  </div>;
}
