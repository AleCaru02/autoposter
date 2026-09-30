import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, LoaderCircle, Sparkles } from "lucide-react";
import { NavLink } from "react-router-dom";
import type { EditorialResearchMode } from "../../api/_lib/editorial-research";
import type { GeneratedSocialContent, GeneratedVariant, SocialFormat, SocialProvider } from "../../api/_lib/openai-text";
import { saveGeneratedContent } from "../features/content/content-store";
import { manualGenerationFingerprint, requestManualContent, type ManualEditorialContext, type ManualGenerationRequest } from "../features/content/manual-content-generation";
import { loadPersonalBrandSources, type PersonalBrandSourceRow } from "../features/profiles/personal-brand-source-store";
import type { Profile, ProfileType } from "../features/profiles/profile-context";
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

export function ManualContentComposer(props: { profileId: string; profileName: string; profileType: ProfileType; profiles: Profile[]; researchMode: EditorialResearchMode }) {
  const [topic, setTopic] = useState("");
  const [objective, setObjective] = useState("");
  const [providers, setProviders] = useState<SocialProvider[]>(["INSTAGRAM"]);
  const [format, setFormat] = useState<SocialFormat>("POST");
  const [content, setContent] = useState<GeneratedSocialContent | null>(null);
  const [editorialContext, setEditorialContext] = useState<ManualEditorialContext | null>(null);
  const [sourceRows, setSourceRows] = useState<PersonalBrandSourceRow[]>([]);
  const [sourceKey, setSourceKey] = useState("");
  const [status, setStatus] = useState<ComposerStatus>("IDLE");
  const [error, setError] = useState<string | null>(null);
  const operation = useRef<{ fingerprint: string; id: string } | null>(null);
  const activeSources = useMemo(() => sourceRows.filter((row) => row.enabled), [sourceRows]);
  const selectedSource = activeSources.find((row) => `${row.source_profile_id}::${row.pillar}` === sourceKey) ?? null;

  useEffect(() => {
    setContent(null);
    setEditorialContext(null);
    setStatus("IDLE");
    if (props.profileType !== "PERSONAL_BRAND") { setSourceRows([]); setSourceKey(""); return; }
    void loadPersonalBrandSources(props.profileId).then((rows) => {
      const enabled = rows.filter((row) => row.enabled);
      setSourceRows(rows);
      setSourceKey(enabled[0] ? `${enabled[0].source_profile_id}::${enabled[0].pillar}` : "");
    }).catch(() => {
      setSourceRows([]);
      setSourceKey("");
    });
  }, [props.profileId, props.profileType]);

  function clearGenerated() {
    setContent(null);
    setEditorialContext(null);
    setStatus("IDLE");
  }

  function toggleProvider(provider: SocialProvider) {
    setProviders((current) => current.includes(provider) ? current.filter((value) => value !== provider) : [...current, provider]);
    clearGenerated();
  }

  async function generate() {
    if (!topic.trim()) { setError("Descrivi il tema del contenuto."); return; }
    if (!providers.length) { setError("Scegli almeno un social."); return; }
    if (props.profileType === "PERSONAL_BRAND" && !objective.trim()) { setError("Per il Personal Brand indica l’obiettivo editoriale."); return; }
    const request: ManualGenerationRequest = {
      profileId: props.profileId,
      topic,
      objective: objective || null,
      providers,
      format,
      researchMode: props.researchMode,
      sourceProfileId: selectedSource?.source_profile_id ?? null,
      pillar: selectedSource?.pillar ?? null,
    };
    const fingerprint = manualGenerationFingerprint(request);
    if (!operation.current || operation.current.fingerprint !== fingerprint) operation.current = { fingerprint, id: crypto.randomUUID() };
    setStatus("GENERATING");
    setError(null);
    try {
      const token = await authenticatedApiToken();
      const generated = await requestManualContent(request, token, operation.current.id);
      setContent(generated.content);
      setEditorialContext(generated.editorialContext);
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
      await saveGeneratedContent({ profileId: props.profileId, topic, objective: objective || null, content, editorialContext });
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

  function updateCarouselSlide(variantIndex: number, slideIndex: number, patch: Partial<NonNullable<GeneratedVariant["carouselSlides"]>[number]>) {
    setContent((current) => {
      if (!current) return current;
      const variant = current.variants[variantIndex];
      const slides = [...(variant.carouselSlides ?? [])];
      if (!slides[slideIndex]) return current;
      slides[slideIndex] = { ...slides[slideIndex], ...patch };
      return replaceVariant(current, variantIndex, { carouselSlides: slides });
    });
    if (status === "SAVED") setStatus("READY");
  }

  return <section className="panel manual-composer" aria-labelledby="manual-composer-title">
    <div className="manual-composer-heading"><div><p className="eyebrow">Creazione guidata</p><h2 id="manual-composer-title">Crea un contenuto ora</h2><p>Scegli tema, social e formato. Il copy userà il brand e le informazioni confermate del sito di {props.profileName}.</p></div><Sparkles size={23} /></div>
    <div className="manual-composer-form">
      {props.profileType === "PERSONAL_BRAND" && <label className="full">Dati da usare <span>(opzionale)</span><select value={sourceKey} onChange={(event) => { setSourceKey(event.target.value); clearGenerated(); }}><option value="">Solo {props.profileName}: sito, brand e informazioni aggiuntive</option>{activeSources.map((row) => { const profile = props.profiles.find((item) => item.id === row.source_profile_id); const key = `${row.source_profile_id}::${row.pillar}`; return <option key={row.id} value={key}>Aggiungi fatti verificati da {profile?.name ?? "attività collegata"}</option>; })}</select></label>}
      <label className="full">Di cosa vuoi parlare?<textarea rows={3} value={topic} maxLength={1000} placeholder="Es. Tre errori da evitare quando si affitta una casa" onChange={(event) => { setTopic(event.target.value); clearGenerated(); }} /></label>
      <label className="full">Obiettivo {props.profileType === "PERSONAL_BRAND" ? <span>(richiesto)</span> : <span>(opzionale)</span>}<input value={objective} maxLength={500} placeholder="Es. Ricevere richieste di consulenza" onChange={(event) => { setObjective(event.target.value); clearGenerated(); }} /></label>
      <fieldset className="full"><legend>Social</legend><div className="manual-choice-grid providers">{PROVIDERS.map((provider) => <label key={provider.value} className={providers.includes(provider.value) ? "selected" : ""}><input type="checkbox" checked={providers.includes(provider.value)} onChange={() => toggleProvider(provider.value)} /><span>{provider.label}</span></label>)}</div></fieldset>
      <fieldset className="full"><legend>Formato</legend><div className="manual-choice-grid formats"><label className={format === "POST" ? "selected" : ""}><input type="radio" name="manual-format" checked={format === "POST"} onChange={() => { setFormat("POST"); clearGenerated(); }} /><span>Post</span></label><label className={format === "STORY" ? "selected" : ""}><input type="radio" name="manual-format" checked={format === "STORY"} onChange={() => { setFormat("STORY"); clearGenerated(); }} /><span>Storia</span></label><label className={format === "CAROUSEL" ? "selected" : ""}><input type="radio" name="manual-format" checked={format === "CAROUSEL"} onChange={() => { setFormat("CAROUSEL"); clearGenerated(); }} /><span>Carosello</span></label></div></fieldset>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!content && <button className="primary-button manual-generate" type="button" disabled={status === "GENERATING"} onClick={() => void generate()}>{status === "GENERATING" ? <><LoaderCircle className="spin" size={17} /> Creazione in corso…</> : <><Sparkles size={17} /> Genera contenuto</>}</button>}
    {content && <div className="manual-result" aria-live="polite">
      <div className="manual-result-summary"><div><small>PROPOSTA EDITORIALE</small><h3>{content.editorialTopic}</h3><p>{content.editorialAngle}</p></div><span>{content.variants.length} {content.variants.length === 1 ? "variante" : "varianti"}</span></div>
      <div className="manual-variant-list">{content.variants.map((variant, index) => <article key={`${variant.provider}-${variant.format}`} className="manual-variant">
        <header><strong>{PROVIDERS.find((provider) => provider.value === variant.provider)?.label ?? variant.provider}</strong><span>{variant.format === "STORY" ? "Storia" : variant.format === "CAROUSEL" ? "Carosello" : "Post"}</span></header>
        {!variant.eligible && <p className="manual-warning">Questa proposta richiede una revisione particolare per il social scelto.</p>}
        <div className="manual-edit-grid">
          <label>Hook<input value={variant.hook} onChange={(event) => updateVariant(index, { hook: event.target.value })} /></label>
          <label>Invito all’azione<input value={variant.cta ?? ""} onChange={(event) => updateVariant(index, { cta: event.target.value || null })} /></label>
          <label className="full">Testo<textarea rows={5} value={variant.caption} onChange={(event) => updateVariant(index, { caption: event.target.value })} /></label>
          <label className="full">Hashtag<input value={variant.hashtags.join(" ")} onChange={(event) => updateVariant(index, { hashtags: event.target.value.split(/[\s,]+/).filter(Boolean).map((tag) => tag.startsWith("#") ? tag : `#${tag}`).slice(0, 15) })} /></label>
          <label className="full">Indicazioni per l’immagine<textarea rows={3} value={variant.visualBrief} onChange={(event) => updateVariant(index, { visualBrief: event.target.value })} /></label>
          <label className="full">Descrizione accessibile<input value={variant.altText} onChange={(event) => updateVariant(index, { altText: event.target.value })} /></label>
        </div>
        {variant.format === "CAROUSEL" && <div className="manual-carousel-slides">
          <h4>Slide del carosello · {variant.carouselSlides?.length ?? 0}</h4>
          <p>Ogni slide è un elemento separato del carosello, non un collage.</p>
          {(variant.carouselSlides ?? []).map((slide, slideIndex) => <section className="manual-carousel-slide" key={slide.position}>
            <header><strong>Slide {slide.position}</strong><span>{slide.purpose}</span></header>
            <div className="manual-edit-grid">
              <label>Scopo<input value={slide.purpose} onChange={(event) => updateCarouselSlide(index, slideIndex, { purpose: event.target.value })} /></label>
              <label>Gerarchia<input value={slide.hierarchy} onChange={(event) => updateCarouselSlide(index, slideIndex, { hierarchy: event.target.value })} /></label>
              <label className="full">Titolo<input value={slide.headline} onChange={(event) => updateCarouselSlide(index, slideIndex, { headline: event.target.value })} /></label>
              <label className="full">Testo<textarea rows={3} value={slide.body} onChange={(event) => updateCarouselSlide(index, slideIndex, { body: event.target.value })} /></label>
              <label className="full">Visuale<textarea rows={2} value={slide.visualBrief} onChange={(event) => updateCarouselSlide(index, slideIndex, { visualBrief: event.target.value })} /></label>
              <label className="full">Alt text<input value={slide.altText} onChange={(event) => updateCarouselSlide(index, slideIndex, { altText: event.target.value })} /></label>
            </div>
          </section>)}
        </div>}
      </article>)}</div>
      <div className="manual-result-actions">{status === "SAVED" ? <><span className="manual-saved"><Check size={16} /> Salvato nelle Revisioni</span><NavLink className="primary-button" to="/app/approvazioni">Aggiungi immagine e approva <ArrowRight size={16} /></NavLink></> : <><button className="secondary-button" type="button" disabled={status === "SAVING"} onClick={() => clearGenerated()}>Cambia richiesta</button><button className="primary-button" type="button" disabled={status === "SAVING"} onClick={() => void save()}>{status === "SAVING" ? <><LoaderCircle className="spin" size={16} /> Salvataggio…</> : "Salva per la revisione"}</button></>}</div>
    </div>}
  </section>;
}
