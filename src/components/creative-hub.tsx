import { useMemo, useState } from "react";
import { ArrowRight, CalendarDays, CircleCheck, Film, Image as ImageIcon, Instagram, LayoutGrid, ShieldCheck, Sparkles, WandSparkles, Zap } from "lucide-react";
import { NavLink } from "react-router-dom";

type CreativeHubProps = {
  profileName: string;
  publishedCount: number;
  reviewCount: number;
  scheduledCount: number;
  connectedCount: number;
};

/** Operational quick-start: never pretends that a provider is connected or a Reel is already generated. */
export function CreativeHub({ profileName, publishedCount, reviewCount, scheduledCount, connectedCount }: CreativeHubProps) {
  const [videoClips, setVideoClips] = useState(12);
  const [images, setImages] = useState(20);
  const [quality, setQuality] = useState<"lite" | "standard">("standard");
  const budget = useMemo(() => {
    const videoUsd = videoClips * 6 * 0.10;
    const imageUsd = images * (quality === "lite" ? 0.0336 : 0.067);
    return { videoUsd, imageUsd, subtotalUsd: videoUsd + imageUsd };
  }, [videoClips, images, quality]);
  const money = (n: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "USD" }).format(n);

  return <div className="creator-hub-v2">
    <section className="creator-main-hero" aria-label="Studio creativo">
      <div className="creator-hero-orb" aria-hidden="true" />
      <div className="creator-hero-content">
        <p className="creator-overline"><Sparkles size={15} /> CONTENT STUDIO · {profileName}</p>
        <h1>Il tuo prossimo contenuto <span>inizia qui.</span></h1>
        <p className="creator-hero-summary">Un solo posto per creare post professionali, preparare caroselli, programmare e leggere i risultati. Nessun follower o dato inventato.</p>
        <div className="creator-hero-actions">
          <NavLink className="creator-action-primary" to="/app/contenuti"><WandSparkles size={18} /> Crea con AI <ArrowRight size={18} /></NavLink>
          <NavLink className="creator-action-secondary" to="/app/calendario"><CalendarDays size={17} /> Calendario editoriale</NavLink>
        </div>
        <div className="creator-trust"><ShieldCheck size={15} /> Revisione prima di pubblicare · Costi AI sotto controllo</div>
      </div>
      <div className="creator-device-art" aria-hidden="true">
        <div className="creator-ig-frame">
          <div className="creator-ig-top"><div className="creator-avatar">A</div><span>@alessandro.sitiweb</span><span className="creator-dots">•••</span></div>
          <div className="creator-ig-visual"><div className="creator-line-mini">NON È SOLO UN SITO.</div><strong>È LA TUA<br /><em>VETRINA</em><br />DIGITALE.</strong><div className="creator-ig-line" /></div>
          <div className="creator-ig-footer"><div className="creator-ig-miniicons"><span>♡</span><span>▢</span><span>↗</span></div><div className="creator-ig-caption">Concept di anteprima · non pubblicato</div></div>
        </div>
      </div>
    </section>
    <section className="creator-essentials" aria-label="Stato reale del flusso">
      <div><span>Pubblicazioni recenti</span><strong>{publishedCount}</strong></div>
      <div><span>Da approvare</span><strong>{reviewCount}</strong></div>
      <div><span>Prossime uscite</span><strong>{scheduledCount}</strong></div>
      <div><span>Canali collegati</span><strong>{connectedCount}</strong></div>
    </section>
    <div className="creator-section-title"><div><p>CREA E DISTRIBUISCI</p><h2>Cosa vuoi fare oggi?</h2></div><span>4 azioni essenziali, senza menu complicati</span></div>
    <section className="creator-tool-grid">
      <NavLink to="/app/contenuti" className="creator-tool-tile"><span className="creator-tool-icon purple"><ImageIcon size={22} /></span><strong>Post con immagini AI</strong><p>Brief, copy, visual e revisione con i modelli cloud già integrati.</p><span className="creator-tool-cta">Apri generatore <ArrowRight size={15} /></span></NavLink>
      <NavLink to="/app/contenuti" className="creator-tool-tile"><span className="creator-tool-icon orange"><LayoutGrid size={22} /></span><strong>Caroselli Instagram</strong><p>Crea le slide e prepara i visual originali, senza collage casuali.</p><span className="creator-tool-cta">Crea carosello <ArrowRight size={15} /></span></NavLink>
      <NavLink to="/app/social" className="creator-tool-tile"><span className="creator-tool-icon pink"><Instagram size={22} /></span><strong>Collegamento Instagram</strong><p>Autorizza Meta e verifica che la pubblicazione sia davvero disponibile.</p><span className="creator-tool-cta">{connectedCount ? "Verifica connessione" : "Collega Instagram"} <ArrowRight size={15} /></span></NavLink>
      <NavLink to="/app/analytics" className="creator-tool-tile"><span className="creator-tool-icon mint"><Zap size={22} /></span><strong>Visualizzazioni e risultati</strong><p>Analizza soltanto dati reali, per capire quali contenuti attirano clienti.</p><span className="creator-tool-cta">Apri risultati <ArrowRight size={15} /></span></NavLink>
    </section>
    <section className="creator-planning">
      <div className="creator-plan-head"><div><p className="creator-overline dark">PIANIFICA SENZA SORPRESE</p><h2>Quanto spenderai in AI?</h2><p>Simulatore di costo, non spesa reale. Stima di 6 secondi a clip per Gemini Omni Flash 720p, più immagini Nano Banana.</p></div><div className="creator-plan-total"><span>Stima contenuti AI</span><strong>{money(budget.subtotalUsd)}</strong><small>esclusi input, rigenerazioni, montaggio, hosting e imposte</small></div></div>
      <div className="creator-plan-controls">
        <label><span>Clip AI al mese <strong>{videoClips}</strong></span><input aria-label="Numero di clip AI al mese" type="range" min="0" max="60" step="1" value={videoClips} onChange={e => setVideoClips(Number(e.target.value))}/><small>Gemini Omni Flash · {money(budget.videoUsd)}</small></label>
        <label><span>Immagini AI al mese <strong>{images}</strong></span><input aria-label="Numero di immagini AI al mese" type="range" min="0" max="150" step="5" value={images} onChange={e => setImages(Number(e.target.value))}/><small>Nano Banana · {money(budget.imageUsd)}</small></label>
        <label><span>Qualità immagini</span><select value={quality} onChange={e => setQuality(e.target.value as "lite" | "standard")}><option value="lite">Lite · 1K, $0,0336/immagine</option><option value="standard">Standard · 1K, $0,067/immagine</option></select><small>Prezzi indicativi API novembre 2026</small></label>
      </div>
      <p className="creator-plan-note"><CircleCheck size={15} /> Questo calcolo non avvia la generazione e non crea costi. I video AI cloud richiedono la relativa chiave API, un limite di spesa lato server e l'attivazione del renderer.</p>
    </section>
  </div>;
}
