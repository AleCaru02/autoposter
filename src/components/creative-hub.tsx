import { ArrowRight, CalendarDays, CircleCheck, Image as ImageIcon, Instagram, LayoutGrid, ShieldCheck, Sparkles, WandSparkles, Zap } from "lucide-react";
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
          <div className="creator-ig-top"><div className="creator-avatar">{profileName.trim().charAt(0).toUpperCase() || "A"}</div><span>{profileName}</span><span className="creator-dots">•••</span></div>
          <div className="creator-ig-visual"><div className="creator-line-mini">ANTEPRIMA GRAFICA</div><strong>IL TUO<br /><em>BRAND</em><br />AL CENTRO.</strong><div className="creator-ig-line" /></div>
          <div className="creator-ig-footer"><div className="creator-ig-miniicons"><span>♡</span><span>▢</span><span>↗</span></div><div className="creator-ig-caption">Esempio illustrativo · non generato e non pubblicato</div></div>
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
      <div className="creator-plan-head">
        <div><p className="creator-overline dark">COSTI AI REALI</p><h2>Budget sotto controllo</h2><p>Testi e immagini sono elaborati con OpenAI. I costi reali vengono registrati per attività quando il provider fornisce dati verificabili: non mostriamo simulazioni con modelli non utilizzati.</p></div>
        <div className="creator-plan-total"><span>Controllo spesa</span><NavLink to="/app/impostazioni">Apri budget AI <ArrowRight size={15} /></NavLink><small>Imposta limiti per account e attività</small></div>
      </div>
      <p className="creator-plan-note"><CircleCheck size={15} /> I Reel AI non sono ancora attivi: la pubblicazione video richiede renderer, file persistenti, collegamenti social e controlli reali. Non vengono effettuate chiamate video o addebiti da questa schermata.</p>
    </section>
  </div>;
}
