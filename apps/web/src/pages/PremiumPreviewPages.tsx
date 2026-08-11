import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { Badge, PageHeader } from '../components/ui';
import { useLocalE2E } from '../services/local-e2e';
import { useSaasRepository, useSaasSnapshot } from '../services/SaasServicesProvider';
import { DashboardPage as FunctionalDashboardPage } from './DashboardPage';
import { CalendarPage as FunctionalCalendarPage } from './BrandCalendarPages';
import { AnalyticsPage as FunctionalAnalyticsPage } from './WorkspacePages';
import { ProviderConnectionsPage as FunctionalConnectionsPage } from './ProviderReadinessPages';
import { BrandVisualPage as FunctionalBrandPage, VisualApprovalsPage as FunctionalApprovalsPage, VisualAssetsPage as FunctionalAssetsPage } from './VisualWorkflowPages';

const channels = [
  { key: 'instagram', short: 'IG', name: 'Instagram', state: 'CONNECTED', account: '@demostudio', meta: 'Manuale · ultimo check 2 min fa' },
  { key: 'facebook', short: 'f', name: 'Facebook', state: 'CONNECTED', account: 'Demo Studio Milano', meta: 'Automatico · ultimo check 2 min fa' },
  { key: 'linkedin', short: 'in', name: 'LinkedIn', state: 'EXPIRING', account: 'Demo Studio', meta: 'Automatico · rinnovo consigliato' },
  { key: 'gbp', short: 'G', name: 'Google Business Profile', state: 'CONNECTED', account: 'Milano · Centro', meta: 'Manuale · location verificata' },
] as const;

const demoAssets = [
  ['launch-still-01.jpg', 'product', 'Prodotto', 'thumb-a'],
  ['workspace-team.jpg', 'team', 'Team', 'thumb-b'],
  ['brand-detail.jpg', 'service', 'Servizio', 'thumb-c'],
  ['office-editorial.jpg', 'interior', 'Interni', 'thumb-d'],
  ['founder-portrait.jpg', 'person', 'Persona', 'thumb-e'],
  ['case-study-cover.png', 'document', 'Case study', 'thumb-f'],
] as const;

function usePreviewMode() {
  const local = useLocalE2E();
  return { local, preview: !local.enabled || !local.tenantId };
}

export function PremiumDashboardPage() {
  const { preview } = usePreviewMode();
  if (!preview) return <FunctionalDashboardPage />;
  const dashboard = useSaasRepository().getDashboard();
  const attention = Math.max(1, dashboard.pendingApprovals);
  const connectionIssues = Math.max(0, dashboard.totalChannels - dashboard.connectedChannels);
  const upcoming = dashboard.posts.slice(0, 4);
  return <div className="premium-screen control-room-screen">
    <PageHeader eyebrow="Control room" title="Tutto ciò che richiede attenzione, in un colpo d’occhio." description="Approvazioni, pubblicazioni, performance e prossime decisioni nello stesso spazio operativo." action={<Link className="button" to="/app/approvals">Apri coda approvazioni</Link>} />
    <section className="control-room-lead">
      <div className="attention-panel reveal-card">
        <div className="panel-kicker"><span className="live-pulse"/>DA FARE</div>
        <div className="attention-number">{attention}</div>
        <h2>Decisioni prima della prossima pubblicazione</h2>
        <div className="attention-list">
          <Link to="/app/approvals"><span className="attention-icon">✓</span><div><strong>{dashboard.pendingApprovals} post da approvare</strong><small>Copy e visual pronti per il controllo</small></div><em>Apri</em></Link>
          <Link to="/app/connections"><span className="attention-icon">◎</span><div><strong>{connectionIssues || 1} connessione da controllare</strong><small>LinkedIn è vicino alla scadenza</small></div><em>Gestisci</em></Link>
          <div><span className="attention-icon good">↗</span><div><strong>Nessun errore bloccante</strong><small>Scheduler e quality gate operativi</small></div><em className="good-text">OK</em></div>
        </div>
      </div>
      <div className="upcoming-panel reveal-card delay-1">
        <div className="panel-head"><div><span className="panel-kicker">PROSSIME PUBBLICAZIONI</span><h2>La settimana è già in movimento.</h2></div><Link to="/app/calendar">Calendario →</Link></div>
        <div className="upcoming-stack">{upcoming.map((post, index) => <Link to={`/app/posts/${post.id}`} className="upcoming-item" key={post.id}>
          <div className={`content-thumb thumb-${index % 4}`}><span>{post.platform.slice(0,2)}</span></div>
          <div className="grow"><strong>{post.title}</strong><small>{post.platform} · {post.date}</small></div>
          <Badge tone={post.state === 'Programmato' ? 'good' : post.state === 'Da rivedere' ? 'warn' : 'info'}>{post.state}</Badge>
        </Link>)}</div>
      </div>
    </section>
    <section className="control-room-secondary">
      <div className="performance-story reveal-card delay-2">
        <div className="panel-head"><div><span className="panel-kicker">PERFORMANCE</span><h2>Il contenuto educativo sta trainando la settimana.</h2></div><span className="trend-badge">+18%</span></div>
        <div className="performance-chart" aria-label="Andamento engagement ultimi sette giorni">{[38,52,44,70,62,88,76,96,82,112,101,126].map((height, index)=><span key={index} style={{height:`${height}px`}} />)}</div>
        <div className="performance-foot"><div><small>Reach</small><strong>24,8k</strong></div><div><small>Engagement</small><strong>1.284</strong></div><div><small>CTR</small><strong>3,9%</strong></div></div>
      </div>
      <div className="ai-next-card reveal-card delay-3">
        <div className="ai-orbit"><span>AI</span></div>
        <span className="panel-kicker">COSA CONSIGLIA L’AI</span>
        <h2>Porta il format “dietro le quinte” anche su LinkedIn.</h2>
        <p>Ha ottenuto più salvataggi del formato medio e mantiene un tono coerente con il Brand Profile.</p>
        <div className="evidence-row"><span>Confidenza 86%</span><span>3 segnali</span></div>
        <Link to="/app/analytics">Vedi perché →</Link>
      </div>
      <div className="plan-usage-card reveal-card delay-4">
        <span className="panel-kicker">UTILIZZO PIANO</span>
        <div className="quota-ring" style={{'--quota': '72%'} as CSSProperties}><strong>72%</strong><small>mese</small></div>
        <div className="quota-lines"><div><span>Post settimanali</span><b>{dashboard.usage.weeklyPosts.used}/{dashboard.usage.weeklyPosts.limit}</b></div><div><span>Pagine brand</span><b>{dashboard.usage.websitePages.used}/{dashboard.usage.websitePages.limit}</b></div><div><span>Canali attivi</span><b>{dashboard.connectedChannels}/{dashboard.totalChannels}</b></div></div>
      </div>
    </section>
    <section className="brand-health-strip reveal-card delay-4"><div><span className="panel-kicker">BRAND HEALTH</span><strong>{dashboard.brandCoverage}% completo</strong></div><div className="health-track"><span style={{width:`${dashboard.brandCoverage}%`}}/></div><p>Identità, tono, servizi e regole confermate. Restano 3 campi da validare.</p><Link to="/app/brand">Apri Brand Center →</Link></section>
  </div>;
}

export function PremiumCalendarPage() {
  const { preview } = usePreviewMode();
  if (!preview) return <FunctionalCalendarPage />;
  const snapshot = useSaasSnapshot();
  const posts = snapshot.posts.slice(0, 8);
  const dayLabels = ['Lun 10','Mar 11','Mer 12','Gio 13','Ven 14','Sab 15','Dom 16'];
  return <div className="premium-screen">
    <PageHeader eyebrow="Piano editoriale" title="Calendario" description="Ogni contenuto mostra visuale, canale, stato, ora e pillar. Apri una card per entrare nella preview completa." action={<button className="button">+ Nuovo contenuto</button>} />
    <div className="calendar-command-bar reveal-card"><div className="segmented"><button>Lista</button><button className="active">Settimana</button><button>Mese</button></div><div className="calendar-range"><button aria-label="Settimana precedente">←</button><strong>10–16 agosto 2026</strong><button aria-label="Settimana successiva">→</button></div><div className="calendar-filters"><span>Tutti i canali</span><span>Tutti gli stati</span></div></div>
    <section className="week-board reveal-card delay-1">
      {dayLabels.map((day, dayIndex)=><div className={`week-column ${dayIndex===1?'today':''}`} key={day}><div className="week-day"><span>{day}</span>{dayIndex===1&&<em>Oggi</em>}</div><div className="week-events">{posts.filter((_,i)=>i%7===dayIndex).map((post,index)=><Link to={`/app/posts/${post.id}`} className="calendar-event-card" key={post.id}><div className={`event-visual thumb-${(dayIndex+index)%4}`}><span>{post.platform.slice(0,2)}</span><b>{post.date}</b></div><div className="event-copy"><strong>{post.title}</strong><small>{post.platform} · 18:{dayIndex}0</small><span className="pillar-chip">{index%2===0?'Authority':'Behind the scenes'}</span><Badge tone={post.state==='Programmato'?'good':post.state==='Da rivedere'?'warn':'info'}>{post.state}</Badge></div></Link>)}</div></div>)}
    </section>
    <div className="calendar-legend"><span><i className="dot ready"/>Pronto</span><span><i className="dot scheduled"/>Programmato</span><span><i className="dot review"/>Da rivedere</span><span>Trascina una card per riprogrammare · demo UI</span></div>
  </div>;
}

export function PremiumApprovalsPage() {
  const { preview } = usePreviewMode();
  if (!preview) return <FunctionalApprovalsPage />;
  return <div className="premium-screen">
    <PageHeader eyebrow="Controllo umano" title="Approval Center" description="Guarda il contenuto come lo vedrà il pubblico e prendi una decisione senza uscire dal workflow." action={<span className="queue-counter">4 in coda</span>} />
    <section className="approval-studio reveal-card">
      <div className="approval-canvas-wrap">
        <div className="approval-platform-row"><span className="social-orb instagram">IG</span><div><strong>Instagram · Feed</strong><small>Oggi, 18:30 · Authority</small></div><Badge tone="info">IN APPROVAZIONE</Badge></div>
        <div className="approval-artwork"><div className="art-grid"/><div className="art-badge">DEMO STUDIO</div><div className="art-copy"><small>BRAND SYSTEM</small><strong>5 segnali che il tuo contenuto sta diventando riconoscibile.</strong><span>01 — Coerenza prima della quantità</span></div><div className="art-metric"><b>87</b><small>Visual QA</small></div></div>
        <div className="preview-dots"><span className="active"/><span/><span/></div>
      </div>
      <div className="approval-inspector">
        <div className="inspector-head"><div><span className="panel-kicker">POST 04 / 12</span><h2>Una decisione, tutti i dettagli.</h2></div><button className="icon-ghost">•••</button></div>
        <div className="copy-block"><label>Hook</label><strong>Il problema non è pubblicare di più. È essere riconoscibili.</strong></div>
        <div className="copy-block"><label>Caption</label><p>Un brand forte non cambia voce a ogni post. Parte da regole chiare, usa visual coerenti e lascia che ogni piattaforma adatti il messaggio senza perdere identità.</p></div>
        <div className="hashtag-row"><span>#brandstrategy</span><span>#socialmedia</span><span>#contentdesign</span></div>
        <div className="approval-quality"><div><span>Brand match</span><b>94</b></div><div><span>Readability</span><b>91</b></div><div><span>Novelty</span><b>88</b></div></div>
        <div className="approval-primary-actions"><button className="button approval-ok">APPROVA</button><button className="button secondary">MODIFICA</button></div>
        <div className="approval-secondary-actions"><button>CAMBIA GRAFICA</button><button>SCEGLI FOTO</button><button className="danger-text">RIFIUTA</button></div>
      </div>
    </section>
    <section className="approval-queue reveal-card delay-2"><div className="panel-head"><div><span className="panel-kicker">PROSSIMI</span><h2>Continua senza perdere il contesto.</h2></div></div><div className="queue-cards">{['Facebook · Case study','LinkedIn · Dietro le quinte','GBP · Aggiornamento locale'].map((item,index)=><div className="queue-card" key={item}><div className={`queue-thumb thumb-${index+1}`}/><div><strong>{item}</strong><small>{index+1===2?'Domani · 09:00':'Oggi · 19:00'}</small></div><span>→</span></div>)}</div></section>
  </div>;
}

export function PremiumAssetsPage() {
  const { preview } = usePreviewMode();
  if (!preview) return <FunctionalAssetsPage />;
  return <div className="premium-screen">
    <PageHeader eyebrow="Media intelligence" title="Asset Library" description="Foto, persone, prodotti, interni e documenti organizzati come una libreria visuale del brand." action={<button className="button">Carica asset</button>} />
    <div className="asset-command-bar reveal-card"><div className="asset-search-fake">⌕ <span>Cerca per soggetto, tag o utilizzo</span></div><div className="asset-filter-pills"><button className="active">Tutti</button><button>Foto</button><button>Persone</button><button>Prodotti</button><button>Documenti</button></div><span className="asset-count">28 asset</span></div>
    <section className="asset-featured reveal-card delay-1"><div><span className="panel-kicker">BRAND LOCK</span><h2>Gli asset che definiscono il tuo stile.</h2><p>Logo, foto prioritarie e riferimenti visuali vengono trattati come materiale preferito.</p></div><div className="featured-assets"><div className="featured-logo"><span>DS</span><small>Primary logo</small></div><div className="featured-palette"><i/><i/><i/><i/><small>Palette confermata</small></div></div></section>
    <section className="premium-asset-grid">{demoAssets.map(([name,type,label,thumb],index)=><article className="premium-asset-card reveal-card" style={{animationDelay:`${index*60}ms`}} key={name}><div className={`premium-asset-thumb ${thumb}`}><span>{index===5?'PDF':label.slice(0,2).toUpperCase()}</span><button aria-label="Menu asset">•••</button>{index<2&&<em>Preferito</em>}</div><div className="premium-asset-info"><div><strong>{name}</strong><small>{type} · qualità {96-index*3}%</small></div><Badge tone={index===5?'info':'good'}>{index===5?'INDEXED':'ACTIVE'}</Badge></div><div className="asset-tags"><span>{label}</span><span>{index%2===0?'editorial':'brand'}</span></div></article>)}</section>
  </div>;
}

export function PremiumBrandPage() {
  const { preview } = usePreviewMode();
  if (!preview) return <FunctionalBrandPage />;
  return <div className="premium-screen brand-book-screen">
    <PageHeader eyebrow="Brand Center" title="Il brand book che alimenta ogni decisione dell’AI." description="Identità, visual system, tono, pubblico e regole in un’unica fonte confermata." action={<button className="button">Modifica Brand Profile</button>} />
    <section className="brand-cover reveal-card"><div className="brand-monogram">DS</div><div className="brand-cover-copy"><span className="panel-kicker">DEMO STUDIO · MILANO</span><h2>Chiaro. Competente. Concreto.</h2><p>Aiutiamo PMI e professionisti a trasformare analisi e strategia in un piano operativo misurabile.</p><div className="brand-statuses"><span>✓ Identità confermata</span><span>✓ Tono bloccato</span><span>✓ Visual system attivo</span></div></div><div className="brand-cover-meta"><small>Brand health</small><strong>94%</strong><span>v7 · aggiornato oggi</span></div></section>
    <section className="brand-book-grid">
      <article className="brand-book-card palette-card reveal-card delay-1"><span className="panel-kicker">PALETTE</span><h3>Colori del brand</h3><div className="swatch-row"><div className="swatch swatch-1"><span>#0F766E</span></div><div className="swatch swatch-2"><span>#F5F7F6</span></div><div className="swatch swatch-3"><span>#17201E</span></div><div className="swatch swatch-4"><span>#DDEAE6</span></div></div></article>
      <article className="brand-book-card type-card reveal-card delay-2"><span className="panel-kicker">TYPOGRAPHY</span><h3>Inter / System Sans</h3><div className="type-sample"><b>Aa</b><span>Messaggi netti, gerarchia forte.</span></div><small>Headline 700 · Body 450 · Labels 800</small></article>
      <article className="brand-book-card tone-card reveal-card delay-2"><span className="panel-kicker">TONE OF VOICE</span><h3>Diretto senza essere freddo.</h3><div className="tone-axis"><span>Caldo</span><i><b style={{left:'68%'}}/></i><span>Formale</span></div><div className="tone-tags"><span>Concreto</span><span>Competente</span><span>Trasparente</span><span>Mai iperbolico</span></div></article>
      <article className="brand-book-card audience-card reveal-card delay-3"><span className="panel-kicker">TARGET</span><h3>PMI e professionisti nell’area di Milano</h3><div className="persona-row"><span>PM</span><div><strong>Paolo · Founder</strong><small>Vuole chiarezza, controllo e meno lavoro manuale</small></div></div><div className="persona-row"><span>CM</span><div><strong>Chiara · Marketing</strong><small>Vuole coerenza e performance leggibili</small></div></div></article>
      <article className="brand-book-card service-card reveal-card delay-3"><span className="panel-kicker">SERVIZI & VALUE</span><h3>Analisi → strategia → esecuzione.</h3><ul><li>Audit del brand</li><li>Piano operativo misurabile</li><li>Ottimizzazione continua</li></ul></article>
      <article className="brand-book-card rules-card reveal-card delay-4"><span className="panel-kicker">REGOLE BLOCCATE</span><h3>Cosa l’AI non deve reinterpretare.</h3><div className="rule-line"><span>⊘</span><div><strong>Claim vietati</strong><small>“Risultati garantiti”, “migliore in assoluto”</small></div></div><div className="rule-line"><span>→</span><div><strong>CTA preferita</strong><small>Prenota una consulenza conoscitiva</small></div></div></article>
    </section>
  </div>;
}

export function PremiumConnectionsPage() {
  const { preview } = usePreviewMode();
  if (!preview) return <FunctionalConnectionsPage />;
  return <div className="premium-screen">
    <PageHeader eyebrow="Social Connections" title="Tutti i canali. Stato chiaro. Azione giusta." description="La connessione non è un interruttore: vedi account selezionato, salute, permessi e cosa fare quando serve." action={<button className="button">+ Collega provider</button>} />
    <section className="connection-summary reveal-card"><div><span className="live-pulse"/><strong>3 connessioni sane</strong><small>1 richiede attenzione nelle prossime 72 ore</small></div><div className="connection-progress"><span style={{width:'75%'}}/></div><button>Controlla tutte →</button></section>
    <section className="premium-connection-grid">{channels.map((channel,index)=><article className={`connection-surface reveal-card delay-${Math.min(index+1,4)}`} key={channel.key}><div className="connection-top"><span className={`social-orb ${channel.key}`}>{channel.short}</span><Badge tone={channel.state==='CONNECTED'?'good':'warn'}>{channel.state}</Badge></div><h2>{channel.name}</h2><strong className="account-name">{channel.account}</strong><small>{channel.meta}</small><div className="connection-stats"><div><span>Permessi</span><b>{channel.state==='CONNECTED'?'Completi':'Da aggiornare'}</b></div><div><span>Ultimo publish</span><b>{index===3?'Ieri':'Oggi'}</b></div></div><button className={channel.state==='CONNECTED'?'button secondary':'button'}>{channel.state==='CONNECTED'?'Gestisci account':'Ricollega ora'}</button></article>)}</section>
  </div>;
}

export function PremiumAnalyticsPage() {
  const { preview } = usePreviewMode();
  if (!preview) return <FunctionalAnalyticsPage />;
  return <div className="premium-screen analytics-story-screen">
    <PageHeader eyebrow="Analytics & learning" title="Non solo numeri. Capisci cosa è successo e cosa fare dopo." description="Ogni dato utile viene tradotto in una spiegazione, un livello di confidenza e una prossima azione." action={<button className="button secondary">Ultimi 30 giorni⌄</button>} />
    <section className="analytics-summary reveal-card"><div className="analytics-main-number"><span className="panel-kicker">COSA È SUCCESSO</span><strong>+24%</strong><p>engagement rispetto ai 30 giorni precedenti</p></div><div className="summary-metrics"><div><span>Reach</span><b>42.680</b><em>+18%</em></div><div><span>Engagement</span><b>2.146</b><em>+24%</em></div><div><span>Click</span><b>1.038</b><em>+11%</em></div><div><span>Post</span><b>18</b><em>+2</em></div></div><div className="analytics-line-chart" aria-label="Trend performance"><svg viewBox="0 0 680 180" role="img" aria-label="Trend in crescita"><path className="chart-area" d="M0,155 C70,140 90,152 150,120 C220,86 235,118 300,88 C360,58 405,82 460,52 C520,23 590,58 680,18 L680,180 L0,180Z"/><path className="chart-line" d="M0,155 C70,140 90,152 150,120 C220,86 235,118 300,88 C360,58 405,82 460,52 C520,23 590,58 680,18"/></svg><div className="chart-axis"><span>13 lug</span><span>20 lug</span><span>27 lug</span><span>3 ago</span><span>10 ago</span></div></div></section>
    <section className="analytics-explain-grid">
      <article className="why-card reveal-card delay-1"><span className="panel-kicker">PERCHÉ È SUCCESSO</span><h2>I contenuti con persone reali hanno battuto i visual grafici.</h2><p>4 dei 5 post migliori usano fotografie del team o del prodotto. Il pattern è coerente su Instagram e Facebook.</p><div className="evidence-stack"><div><span>Foto reali</span><b>6,8% engagement</b></div><div><span>Graphic template</span><b>3,9% engagement</b></div><div><span>Confidenza</span><b>88%</b></div></div></article>
      <article className="top-content-card reveal-card delay-2"><div className="top-content-art thumb-2"><span>TOP</span></div><div><span className="panel-kicker">MIGLIOR CONTENUTO</span><h3>Dietro le quinte del metodo</h3><p>Instagram · 7 agosto</p><div className="mini-kpis"><span><b>8,4%</b> engagement</span><span><b>146</b> salvataggi</span></div></div></article>
    </section>
    <section className="next-actions-panel reveal-card delay-3"><div><span className="panel-kicker">COSA FARE ADESSO</span><h2>Tre decisioni, ordinate per impatto.</h2></div><div className="next-action-list"><div><span>01</span><div><strong>Aumenta il pillar “dietro le quinte” dal 15% al 25%</strong><small>Impatto stimato alto · confidenza 88%</small></div><button>Applica</button></div><div><span>02</span><div><strong>Riutilizza foto reali prima di generare nuovi visual</strong><small>Riduce costo visuale e aumenta coerenza</small></div><button>Apri Asset</button></div><div><span>03</span><div><strong>Testa il martedì alle 18:30 su Instagram</strong><small>Finestra con performance sopra media in 3 settimane</small></div><button>Programma test</button></div></div></section>
  </div>;
}
