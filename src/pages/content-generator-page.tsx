import { useState, type FormEvent } from "react";
import { Check, Image as ImageIcon, LoaderCircle, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { authClient } from "../lib/neon-client";
import { useProfiles } from "../features/profiles/profile-context";
import { saveGeneratedContent } from "../features/content/content-store";
import type { GeneratedSocialContent, SocialFormat, SocialProvider } from "../../api/_lib/openai-text";

type JwtAuth = { getJWTToken?: () => Promise<string | null> };
type ImageResult = { dataUrl: string; mimeType: string; model: string; size: string; quality: string; revisedPrompt?: string | null };
type FlowStep = "IDLE" | "TEXT" | "SAVE" | "IMAGES" | "DONE";
type GeneratedVariant = GeneratedSocialContent["variants"][number];

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

function platformLabel(provider: SocialProvider) {
  return PROVIDERS.find((item) => item.value === provider)?.label ?? provider;
}

export function ContentGeneratorPage() {
  const navigate = useNavigate();
  const { selectedProfile } = useProfiles();
  const [direction, setDirection] = useState("");
  const [providers, setProviders] = useState<SocialProvider[]>(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"]);
  const [format, setFormat] = useState<SocialFormat>("POST");
  const [flowStep, setFlowStep] = useState<FlowStep>("IDLE");
  const [result, setResult] = useState<GeneratedSocialContent | null>(null);
  const [images, setImages] = useState<Record<string, ImageResult>>({});
  const [imageFailures, setImageFailures] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const busy = flowStep !== "IDLE" && flowStep !== "DONE";

  function toggleProvider(provider: SocialProvider) {
    if (busy) return;
    setProviders((current) => current.includes(provider) ? current.filter((item) => item !== provider) : [...current, provider]);
  }

  async function jwt() {
    const token = await (authClient as typeof authClient & JwtAuth).getJWTToken?.();
    if (!token) throw new Error("Sessione non valida. Accedi di nuovo.");
    return token;
  }

  async function createImage(token: string, profileId: string, contentVariantId: string, variant: GeneratedVariant) {
    const response = await fetch("/api/generate-image", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        profileId,
        contentVariantId,
        provider: variant.provider,
        format: variant.format,
        visualBrief: variant.visualBrief,
        caption: variant.caption,
      }),
    });
    const body = await response.json() as { image?: ImageResult; asset?: { id: string }; error?: string; message?: string; detail?: string };
    if (!response.ok) throw new Error(body.detail || body.message || body.error || "Immagine non generata.");
    if (!body.image?.dataUrl || !body.asset?.id) throw new Error("Immagine non salvata correttamente.");
    return body.image;
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!selectedProfile?.id || !providers.length || busy) return;
    const profileId = selectedProfile.id;
    const topic = direction.trim() || "Scegli autonomamente un tema editoriale utile e specifico, basandoti esclusivamente sul sito e sui dati del brand confermati. Evita di ripetere concetti generici.";
    setError(null); setResult(null); setImages({}); setImageFailures([]); setFlowStep("TEXT");

    try {
      const token = await jwt();
      const response = await fetch("/api/generate-text", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ profileId, topic, objective: null, providers, formats: [format] }),
      });
      const body = await response.json() as { content?: GeneratedSocialContent; error?: string; message?: string; detail?: string };
      if (!response.ok) {
        if (body.error === "OPENAI_TEXT_BUDGET_REACHED") throw new Error("Limite di utilizzo raggiunto. Nessuna nuova generazione è partita.");
        if (body.error === "OPENAI_NOT_CONFIGURED") throw new Error("Il motore contenuti non è disponibile in questo momento.");
        throw new Error(body.detail || body.message || body.error || "Generazione non riuscita.");
      }
      if (!body.content) throw new Error("Il motore non ha restituito un contenuto utilizzabile.");
      const generated: GeneratedSocialContent = body.content;
      setResult(generated);

      setFlowStep("SAVE");
      const saved = await saveGeneratedContent({
        profileId,
        topic: direction.trim() || "Tema scelto automaticamente dal brand e dal sito",
        objective: null,
        content: generated,
      });

      setFlowStep("IMAGES");
      const nextImages: Record<string, ImageResult> = {};
      const failures: string[] = [];
      for (let index = 0; index < generated.variants.length; index += 1) {
        const variant: GeneratedVariant | undefined = generated.variants[index];
        if (!variant?.eligible) continue;
        const key = `${variant.provider}-${variant.format}-${index}`;
        const contentVariantId = saved.variantIds[key];
        if (!contentVariantId) {
          failures.push(`${platformLabel(variant.provider)}: variante non collegata.`);
          continue;
        }
        try {
          nextImages[key] = await createImage(token, profileId, contentVariantId, variant);
          setImages({ ...nextImages });
        } catch (reason) {
          failures.push(`${platformLabel(variant.provider)}: ${reason instanceof Error ? reason.message : "immagine non generata"}`);
        }
      }
      setImageFailures(failures);
      setFlowStep("DONE");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Produzione non riuscita.");
      setFlowStep("IDLE");
    }
  }

  if (!selectedProfile) return null;
  const progress = flowStep === "TEXT" ? "Sto preparando i testi" : flowStep === "SAVE" ? "Sto salvando le bozze" : flowStep === "IMAGES" ? "Sto creando e salvando le immagini" : null;

  return <div className="page-content content-studio">
    <header className="page-header"><div><p className="eyebrow">Contenuti · {selectedProfile.name}</p><h1>Produzione contenuti</h1><p>Il sistema usa brand e sito come base. Tutto ciò che genera viene salvato automaticamente nelle Revisioni.</p></div></header>

    <section className="panel autopilot-panel"><div className="autopilot-copy"><span className="autopilot-icon"><Sparkles size={20} /></span><div><h2>Genera adesso</h2><p>È il comando manuale per forzare una nuova produzione. La produzione programmata userà le frequenze del calendario.</p></div></div><form className="autopilot-form" onSubmit={generate}>
      <label className="direction-field">Indicazione facoltativa<textarea rows={2} placeholder="Lascia vuoto e scelgo io il tema migliore dal sito, oppure scrivi una direzione specifica." value={direction} disabled={busy} onChange={(event) => setDirection(event.target.value)} /></label>
      <div className="studio-row"><div><span className="field-label">Social</span><div className="choice-grid studio-chips">{PROVIDERS.map((provider) => <label className={`choice-chip ${providers.includes(provider.value) ? "selected" : ""}`} key={provider.value}><input type="checkbox" checked={providers.includes(provider.value)} disabled={busy} onChange={() => toggleProvider(provider.value)} />{provider.label}</label>)}</div></div><div><span className="field-label">Formato</span><div className="choice-grid compact studio-chips">{FORMATS.map((item) => <label className={`choice-chip ${format === item.value ? "selected" : ""}`} key={item.value}><input type="radio" name="format" checked={format === item.value} disabled={busy} onChange={() => setFormat(item.value)} />{item.label}</label>)}</div></div></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="compact-action studio-generate" disabled={busy || !providers.length} type="submit">{busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{busy ? progress : "Genera e salva"}</button>
    </form></section>

    {flowStep === "DONE" && result && <section className="generation-results studio-results"><div className="generation-complete"><span><Check size={17} /></span><div><strong>Contenuto creato e salvato</strong><p>Testi e immagini disponibili sono già nelle Revisioni. Nessun social viene pubblicato finché il collegamento reale non sarà attivo.</p></div><button className="compact-action" type="button" onClick={() => navigate("/app/approvazioni")}>Apri Revisioni</button></div>{imageFailures.length > 0 && <div className="partial-warning"><ImageIcon size={17} /><div><strong>Alcune immagini non sono state create</strong><p>{imageFailures.join(" · ")}</p></div></div>}<div className="studio-result-grid">{result.variants.map((variant, index) => { const key = `${variant.provider}-${variant.format}-${index}`; const image = images[key]; return <article className="studio-result-card" key={key}>{image ? <img src={image.dataUrl} alt={variant.altText} /> : <div className="image-placeholder"><ImageIcon size={20} /></div>}<div><small>{platformLabel(variant.provider)} · {variant.format === "CAROUSEL" ? "Carosello" : variant.format === "STORY" ? "Storia" : "Post"}</small><h2>{variant.hook}</h2><p>{variant.caption}</p></div></article>; })}</div></section>}
  </div>;
}
