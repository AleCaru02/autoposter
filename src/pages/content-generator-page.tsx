import { useState, type FormEvent } from "react";
import { Bot, Image as ImageIcon, Save, ShieldCheck, Sparkles } from "lucide-react";
import { authClient } from "../lib/neon-client";
import { useProfiles } from "../features/profiles/profile-context";
import { saveGeneratedContent, type SavedGeneration } from "../features/content/content-store";
import type { GeneratedSocialContent, OpenAITextUsage, SocialFormat, SocialProvider } from "../../api/_lib/openai-text";

type JwtAuth = { getJWTToken?: () => Promise<string | null> };
type Budget = { monthlyUsd: number; spentUsd: number; remainingUsd?: number; estimatedNextMaxUsd?: number };
type ImageResult = { dataUrl: string; mimeType: string; model: string; size: string; quality: string; revisedPrompt?: string | null };
type ImageQuota = { used: number; limit: number; remaining: number };

const PROVIDERS: Array<{ value: SocialProvider; label: string }> = [
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "FACEBOOK", label: "Facebook" },
  { value: "LINKEDIN", label: "LinkedIn" },
  { value: "GBP", label: "Google Business Profile" },
];
const FORMATS: Array<{ value: SocialFormat; label: string }> = [
  { value: "POST", label: "Post" },
  { value: "CAROUSEL", label: "Carosello" },
  { value: "STORY", label: "Storia" },
];

export function ContentGeneratorPage() {
  const { selectedProfile } = useProfiles();
  const [topic, setTopic] = useState("");
  const [objective, setObjective] = useState("");
  const [providers, setProviders] = useState<SocialProvider[]>(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"]);
  const [format, setFormat] = useState<SocialFormat>("POST");
  const [result, setResult] = useState<GeneratedSocialContent | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [usage, setUsage] = useState<OpenAITextUsage | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SavedGeneration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState<Record<string, boolean>>({});
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({});
  const [images, setImages] = useState<Record<string, ImageResult>>({});
  const [imageQuota, setImageQuota] = useState<ImageQuota | null>(null);

  function toggleProvider(provider: SocialProvider) {
    setProviders((current) => current.includes(provider) ? current.filter((item) => item !== provider) : [...current, provider]);
  }

  async function jwt() {
    const token = await (authClient as typeof authClient & JwtAuth).getJWTToken?.();
    if (!token) throw new Error("Sessione non valida: effettua nuovamente l’accesso.");
    return token;
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!selectedProfile?.id || !providers.length) return;
    setBusy(true); setError(null); setResult(null); setModel(null); setUsage(null); setImages({}); setImageErrors({}); setImageQuota(null); setSaved(null);
    try {
      const token = await jwt();
      const response = await fetch("/api/generate-text", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ profileId: selectedProfile.id, topic, objective: objective || null, providers, formats: [format] }) });
      const body = await response.json() as { content?: GeneratedSocialContent; model?: string; usage?: OpenAITextUsage; budget?: Budget; error?: string; message?: string; detail?: string };
      if (body.budget) setBudget(body.budget);
      if (!response.ok) {
        if (body.error === "OPENAI_NOT_CONFIGURED") throw new Error("OpenAI non è ancora configurato sul server.");
        if (body.error === "OPENAI_TEXT_BUDGET_REACHED") throw new Error("Limite mensile testi raggiunto. Nessuna chiamata OpenAI è stata eseguita.");
        throw new Error(body.detail || body.message || body.error || "Generazione non riuscita.");
      }
      if (!body.content) throw new Error("OpenAI non ha restituito contenuto utilizzabile.");
      setResult(body.content); setModel(body.model ?? null); setUsage(body.usage ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Generazione non riuscita.");
    } finally { setBusy(false); }
  }

  async function saveDrafts() {
    if (!selectedProfile?.id || !result || saving || saved) return;
    setSaving(true); setError(null);
    try {
      const stored = await saveGeneratedContent({ profileId: selectedProfile.id, topic, objective: objective || null, content: result });
      setSaved(stored);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Salvataggio non riuscito.");
    } finally { setSaving(false); }
  }

  async function generateImage(key: string, variant: GeneratedSocialContent["variants"][number]) {
    if (!selectedProfile?.id || imageBusy[key]) return;
    const contentVariantId = saved?.variantIds[key];
    if (!contentVariantId) {
      setImageErrors((current) => ({ ...current, [key]: "Salva prima le bozze nelle approvazioni: l’immagine deve essere collegata a un contenuto persistente." }));
      return;
    }
    setImageBusy((current) => ({ ...current, [key]: true }));
    setImageErrors((current) => ({ ...current, [key]: "" }));
    try {
      const token = await jwt();
      const response = await fetch("/api/generate-image", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          profileId: selectedProfile.id,
          contentVariantId,
          provider: variant.provider,
          format: variant.format,
          visualBrief: variant.visualBrief,
          caption: variant.caption,
        }),
      });
      const body = await response.json() as { image?: ImageResult; asset?: { id: string }; quota?: ImageQuota; error?: string; message?: string; detail?: string };
      if (body.quota) setImageQuota(body.quota);
      if (!response.ok) {
        if (body.error === "OPENAI_IMAGE_MONTHLY_LIMIT_REACHED") throw new Error("Limite mensile immagini raggiunto. Nessuna immagine è stata generata.");
        if (body.error === "OPENAI_NOT_CONFIGURED") throw new Error("OpenAI Immagini non è configurato sul server.");
        throw new Error(body.detail || body.message || body.error || "Generazione immagine non riuscita.");
      }
      if (!body.image?.dataUrl || !body.asset?.id) throw new Error("L’immagine è stata generata ma non è stata salvata correttamente.");
      setImages((current) => ({ ...current, [key]: body.image as ImageResult }));
    } catch (reason) {
      setImageErrors((current) => ({ ...current, [key]: reason instanceof Error ? reason.message : "Generazione immagine non riuscita." }));
    } finally {
      setImageBusy((current) => ({ ...current, [key]: false }));
    }
  }

  if (!selectedProfile) return null;
  return <div className="page-content">
    <header className="page-header"><div><p className="eyebrow">Contenuti · {selectedProfile.name}</p><h1>Genera contenuti con OpenAI</h1><p>Testi con GPT-5.6 Terra e immagini esclusivamente con GPT-Image-2. Le bozze vengono salvate per profilo prima della revisione.</p></div></header>
    <section className="cost-guard"><ShieldCheck size={19} /><div><strong>Protezione utilizzo attiva</strong><p>Le generazioni partono solo su azione esplicita. Nessuna immagine viene generata finché la bozza non è stata salvata e collegata al profilo.</p>{budget && <small>Budget tecnico testi attivo · nell’interfaccia utente i costi saranno mostrati in euro.</small>}{imageQuota && <small>Immagini questo mese: {imageQuota.used}/{imageQuota.limit} · residue {imageQuota.remaining}</small>}</div></section>
    <form className="panel generator-form" onSubmit={generate}><div className="form-grid"><label className="full">Argomento o idea<textarea required rows={4} placeholder="Es. Perché affidare un immobile a un property manager" value={topic} onChange={(event) => setTopic(event.target.value)} /></label><label className="full">Obiettivo opzionale<input placeholder="Es. lead, notorietà, prenotazioni" value={objective} onChange={(event) => setObjective(event.target.value)} /></label></div><fieldset className="choice-fieldset"><legend>Piattaforme</legend><div className="choice-grid">{PROVIDERS.map((provider) => <label className={`choice-chip ${providers.includes(provider.value) ? "selected" : ""}`} key={provider.value}><input type="checkbox" checked={providers.includes(provider.value)} onChange={() => toggleProvider(provider.value)} />{provider.label}</label>)}</div></fieldset><fieldset className="choice-fieldset"><legend>Formato</legend><div className="choice-grid compact">{FORMATS.map((item) => <label className={`choice-chip ${format === item.value ? "selected" : ""}`} key={item.value}><input type="radio" name="format" value={item.value} checked={format === item.value} onChange={() => setFormat(item.value)} />{item.label}</label>)}</div></fieldset>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy || !providers.length} type="submit"><Sparkles size={16} /> {busy ? "OpenAI sta generando…" : "Genera bozze"}</button><p className="generator-note">Una richiesta genera insieme tutte le piattaforme selezionate. Dopo la generazione salva le bozze: solo allora immagini e approvazioni diventano persistenti.</p></form>
    {result && <section className="generation-results"><div className="generation-summary"><Bot size={20} /><div><strong>{result.strategySummary}</strong><small>{model ? `Testo: ${model}` : "OpenAI"}{usage?.totalTokens != null ? ` · ${usage.totalTokens} token` : ""}</small></div></div><div className="save-generation-bar"><button className="primary-button" type="button" disabled={saving || Boolean(saved)} onClick={() => void saveDrafts()}><Save size={16} /> {saved ? "Bozze salvate nelle approvazioni" : saving ? "Salvataggio…" : "Salva nelle approvazioni"}</button>{saved && <small>Contenuto persistente creato. Ora puoi generare immagini salvate o aprire la sezione Approvazioni.</small>}</div>{result.variants.map((variant, index) => { const key = `${variant.provider}-${variant.format}-${index}`; const image = images[key]; return <article className="generated-card" key={key}><header><div><span>{variant.provider}</span><strong>{variant.format}</strong></div><em className={variant.eligible ? "eligible" : "not-eligible"}>{variant.eligible ? "Idoneo" : "Non idoneo"}</em></header><h2>{variant.hook}</h2><p className="generated-caption">{variant.caption}</p>{variant.cta && <p><strong>CTA:</strong> {variant.cta}</p>}{variant.hashtags.length > 0 && <p className="hashtags">{variant.hashtags.join(" ")}</p>}<details><summary>Visual e base fattuale</summary><p><strong>Visual:</strong> {variant.visualBrief}</p><p><strong>Alt text:</strong> {variant.altText}</p><ul>{variant.factualBasis.map((fact) => <li key={fact}>{fact}</li>)}</ul></details><div className="image-generator"><button className="secondary-button" type="button" disabled={!variant.eligible || imageBusy[key] || !saved} onClick={() => void generateImage(key, variant)}><ImageIcon size={16} /> {imageBusy[key] ? "GPT-Image-2 sta generando…" : image ? "Rigenera e salva immagine" : "Genera e salva immagine"}</button><small>{saved ? "GPT-Image-2 · qualità alta · immagine collegata alla variante salvata" : "Salva prima le bozze per evitare immagini scollegate o perse."}</small>{imageErrors[key] && <p className="form-error" role="alert">{imageErrors[key]}</p>}{image && <figure className="generated-image"><img src={image.dataUrl} alt={variant.altText} /><figcaption>{image.model} · {image.quality} · {image.size}. Immagine salvata nel profilo e riapribile dalle approvazioni.</figcaption></figure>}</div></article>; })}</section>}
  </div>;
}
