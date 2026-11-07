import { ArrowRight, BarChart3, CalendarDays, CircleAlert, Clock3, FileCheck2, Settings2, ShieldCheck, WandSparkles } from "lucide-react";
import { NavLink } from "react-router-dom";

type CreativeHubProps = {
  profileName: string;
  publishedCount: number;
  reviewCount: number;
  scheduledCount: number;
  connectedCount: number;
};

/**
 * A profile-scoped operational overview, not a marketing demo.
 * Figures arrive from the existing dashboard's real read paths.
 * No fake Instagram preview, competitor claims or simulated analytics.
 */
export function CreativeHub({ profileName, publishedCount, reviewCount, scheduledCount, connectedCount }: CreativeHubProps) {
  const next = reviewCount > 0
    ? { label: "Revisioni da completare", description: `${reviewCount} contenut${reviewCount === 1 ? "o" : "i"} attend${reviewCount === 1 ? "e" : "ono"} il tuo controllo.`, to: "/app/approvazioni", action: "Apri revisioni", Icon: FileCheck2 }
    : connectedCount === 0
      ? { label: "Verifica i canali social", description: "Nessun canale risulta attualmente verificato per la pubblicazione. I collegamenti storici non vengono cancellati.", to: "/app/social", action: "Verifica canali", Icon: CircleAlert }
      : scheduledCount > 0
        ? { label: "Il calendario è pronto", description: `${scheduledCount} contenut${scheduledCount === 1 ? "o" : "i"} in programmazione: controlla le prossime uscite.`, to: "/app/calendario", action: "Apri calendario", Icon: CalendarDays }
        : { label: "Consulta il piano editoriale", description: "Controlla i temi selezionati per questa attività e lo stato dell'automazione.", to: "/app/contenuti", action: "Vai al piano", Icon: WandSparkles };
  const NextIcon = next.Icon;

  return <div className="creator-hub-v2 studio-command">
    <section className="studio-command-hero" aria-labelledby="studio-heading">
      <div className="studio-command-intro">
        <p className="studio-command-eyebrow"><span className="studio-command-dot" aria-hidden="true" /> POST AUTOMATICI <span className="studio-command-divider">/</span> <span>{profileName}</span></p>
        <h1 id="studio-heading">I tuoi social, <em>sotto controllo.</em></h1>
        <p className="studio-command-lede">Un unico spazio per seguire i contenuti scelti dall'AI, controllare quelli pronti e verificare le pubblicazioni. Senza dover inventare ogni post.</p>
        <div className="studio-command-actions">
          <NavLink className="studio-command-primary" to="/app/contenuti"><WandSparkles size={18} /> Apri piano editoriale <ArrowRight size={17} /></NavLink>
          <NavLink className="studio-command-secondary" to="/app/calendario"><CalendarDays size={17} /> Calendario</NavLink>
        </div>
        <div className="studio-command-safety"><ShieldCheck size={15} /> Pubblicazione subordinata a consenso e collegamenti social verificati</div>
      </div>
      <aside className="studio-command-next" aria-label="Prossima azione operativa">
        <p className="studio-command-next-kicker">DA CONTROLLARE</p>
        <div className="studio-command-next-icon"><NextIcon size={22} /></div>
        <h2>{next.label}</h2>
        <p>{next.description}</p>
        <NavLink to={next.to}>{next.action} <ArrowRight size={16} /></NavLink>
      </aside>
    </section>

    <nav className="studio-command-metrics" aria-label="Stato reale dell'attività">
      <NavLink to="/app/approvazioni"><FileCheck2 size={18}/><strong>{reviewCount}</strong><span>Da approvare</span></NavLink>
      <NavLink to="/app/calendario"><Clock3 size={18}/><strong>{scheduledCount}</strong><span>In calendario</span></NavLink>
      <NavLink to="/app/social"><ShieldCheck size={18}/><strong>{connectedCount}<small>/4</small></strong><span>Canali pronti</span></NavLink>
      <NavLink to="/app/analytics"><BarChart3 size={18}/><strong>{publishedCount}</strong><span>Pubblicati recenti</span></NavLink>
    </nav>

    <div className="studio-command-foot">
      <p>Le statistiche compaiono solo quando le piattaforme restituiscono dati reali. I Reel AI non sono ancora attivi.</p>
      <NavLink to="/app/impostazioni"><Settings2 size={15}/> Apri budget AI <ArrowRight size={14}/></NavLink>
    </div>
  </div>;
}
