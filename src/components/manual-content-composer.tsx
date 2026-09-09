import { useRef, useState } from "react";
import { ArrowRight, Check, LoaderCircle, Sparkles } from "lucide-react";
import { NavLink } from "react-router-dom";
import type { EditorialResearchMode } from "../../api/_lib/editorial-research";
import type { GeneratedSocialContent, GeneratedVariant, SocialFormat, SocialProvider } from "../../api/_lib/openai-text";
import { saveGeneratedContent } from "../features/content/content-store";
import { manualGenerationFingerprint, requestManualContent, type ManualGenerationRequest } from "../features/content/manual-content-generation";
import { authenticatedApiToken } from "../lib/auth-token";
type ComposerStatus = "IDLE" | "GENERATING" | "READY" | "SAVING" | "SAVED";

const PROVIDERS: Array<{ value: SocialProvider; label: string }> = [
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "FACEBOOK", label: "Facebook" },
  { value: "LINKEDIN", label: "LinkedIn" },
  { value: "GBP", label: "Google Business Profile" },
];

function replaceVariant(content: GeneratedSocialContent, index: number, patch: Partial<GeneratedVariant>) {
  return { ...content, variants: content.variants.map((variant, current) => current === index ? { ...variant, ...patch } : variant) };
}

export function ManualContentComposer(props: { profileId: string; profileName: string; researchMode: EditorialResearchMode }) {
  const [topic, setTopic] = useState("");
  const [objective, setObjective] = useState("");
  const [providers, setProviders] = useState<SocialProvider[]>(["INSTAGRAM"]);
  const [format, setFormat] = useState<SocialFormat>("POST");
  const [content, setContent] = useState<GeneratedSocialContent | null>(null);
  const [status, setStatus] = useState<ComposerStatus>("IDLE");
  const [error, setError] = useState<string | null>(null);
  const operation = useRef<{ fingerprint: string; id: string } | null>(null);

  function toggleProvider(provider: SocialProvider) {
    setProviders((current) => current.includes(provider) ? current.filter((value) => value !== provider) : [...current, provider]);
    setContent(null);
    setStatus("IDLE");
  }

  async function generate() {
    if (!topic.trim()) { setError("Descrivi il tema del contenuto."); return; }
    if (!providers.length) { setError("Scegli almeno un social."); return; }
    const request: ManualGenerationRequest = { profileId: props.profileId, topic, objective: objective || null, providers, format, researchMode: props.researchMode };
    const fingerprint = manualGenerationFingerprint(request);
    if (!operation.current || operation.current.fingerprint !== fingerprint) operation.current = { fingerprint, id: crypto.randomUUID() };
    setStatus("GENERATING");
    setError(null);
    try {
      const token = await authenticatedApiToken();
      setContent(await requestManualContent(request, token, operation.current.id));
      setStatus("READY");
      operation.current = null;
    } catch (reason) {
      setStatus("IDLE");
      setError(reason instanceof Error ? reason.message : "Generazione non riuscita.");
    }
  }

  async function save() {
    if (!content) return;
    setStatus("SAVING");
    setError(null);
    try {
      await saveGeneratedContent({ profileId: props.profileId, topic, objective: objective || null, content });
      setStatus("SAVED");
    } catch (reason) {
      setStatus("READY");
      setError(reason instanceof Error ? reason.message : "Salvataggio non riuscito.");
    }
  }

  function updateVariant(index: number, patch: Partial<GeneratedVariant>) {
    setContent((current) => current ? replaceVariant(current, index, patch) : current);
    if (status === "SAVED") setStatus("READY");
  }

  return <section className="panel manual-composer" aria-labelledby="manual-composer-title">
    <div className="manual-composer-heading"><div><p className="eyebrow">Creazione guidata</p><h2 id="manual-composer-title">Crea un contenuto ora</h2><p>Scegli tema, social e formato. Il copy userà il brand e le informazioni confermate del sito di {props.profileName}.</p></div><Sparkles size={23} /></div>
    <div className="manual-composer-form">
      <label className="full">Di cosa vuoi parlare?<textarea rows={3} value={topic} maxLength={1000} placeholder="Es. Tre errori da evitare quando si affitta una casa" onChange={(event) => { setTopic(event.target.value); setContent(null); setStatus("IDLE"); }} /></label>
      <label className="full">Obiettivo <span>(opzionale)</span><input value={objective} maxLength={500} placeholder="Es. Ricevere richieste di consulenza" onChange={(event) => { setObjective(event.target.value); setContent(null); setStatus("IDLE"); }} /></label>
      <fieldset className="full"><legend>Social</legend><div className="manual-choice-grid providers">{PROVIDERS.map((provider) => <label key={provider.value} className={providers.includes(provider.value) ? "selected" : ""}><input type="checkbox" checked={providers.includes(provider.value)} onChange={() => toggleProvider(provider.value)} /><span>{provider.label}</span></label>)}</div></fieldset>
      <fieldset className="full"><legend>Formato</legend><div className="manual-choice-grid formats"><label className={format === "POST" ? "selected" : ""}><input type="radio" name="manual-format" checked={format === "POST"} onChange={() => { setFormat("POST"); setContent(null); setStatus("IDLE"); }} /><span>Post</span></label><label className={format === "STORY" ? "selected" : ""}><input type="radio" name="manual-format" checked={format === "STORY"} onChange={() => { setFormat("STORY"); setContent(null); setStatus("IDLE"); }} /><span>Storia</span></label><label className="disabled" title="Richiede più visual distinti"><input type="radio" name="manual-format" disabled /><span>Carosello · in preparazione</span></label></div></fieldset>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!content && <button className="primary-button manual-generate" type="button" disabled={status === "GENERATING"} onClick={() => void generate()}>{status === "GENERATING" ? <><LoaderCircle className="spin" size={17} /> Creazione in corso…</> : <><Sparkles size={17} /> Genera contenuto</>}</button>}
    {content && <div className="manual-result" aria-live="polite">
      <div className="manual-result-summary"><div><small>PROPOSTA EDITORIALE</small><h3>{content.editorialTopic}</h3><p>{content.editorialAngle}</p></div><span>{content.variants.length} {content.variants.length === 1 ? "variante" : "varianti"}</span></div>
      <div className="manual-variant-list">{content.variants.map((variant, index) => <article key={`${variant.provider}-${variant.format}`} className="manual-variant">
        <header><strong>{PROVIDERS.find((provider) => provider.value === variant.provider)?.label ?? variant.provider}</strong><span>{variant.format === "STORY" ? "Storia" : "Post"}</span></header>
        {!variant.eligible && <p className="manual-warning">Questa proposta richiede una revisione particolare per il social scelto.</p>}
        <div className="manual-edit-grid">
          <label>Hook<input value={variant.hook} onChange={(event) => updateVariant(index, { hook: event.target.value })} /></label>
          <label>Invito all’azione<input value={variant.cta ?? ""} onChange={(event) => updateVariant(index, { cta: event.target.value || null })} /></label>
          <label className="full">Testo<textarea rows={5} value={variant.caption} onChange={(event) => updateVariant(index, { caption: event.target.value })} /></label>
          <label className="full">Hashtag<input value={variant.hashtags.join(" ")} onChange={(event) => updateVariant(index, { hashtags: event.target.value.split(/[\s,]+/).filter(Boolean).map((tag) => tag.startsWith("#") ? tag : `#${tag}`).slice(0, 15) })} /></label>
          <label className="full">Indicazioni per l’immagine<textarea rows={3} value={variant.visualBrief} onChange={(event) => updateVariant(index, { visualBrief: event.target.value })} /></label>
          <label className="full">Descrizione accessibile<input value={variant.altText} onChange={(event) => updateVariant(index, { altText: event.target.value })} /></label>
        </div>
      </article>)}</div>
      <div className="manual-result-actions">{status === "SAVED" ? <><span className="manual-saved"><Check size={16} /> Salvato nelle Revisioni</span><NavLink className="primary-button" to="/app/approvazioni">Aggiungi immagine e approva <ArrowRight size={16} /></NavLink></> : <><button className="secondary-button" type="button" disabled={status === "SAVING"} onClick={() => { setContent(null); setStatus("IDLE"); }}>Cambia richiesta</button><button className="primary-button" type="button" disabled={status === "SAVING"} onClick={() => void save()}>{status === "SAVING" ? <><LoaderCircle className="spin" size={16} /> Salvataggio…</> : "Salva per la revisione"}</button></>}</div>
    </div>}
  </section>;
}
