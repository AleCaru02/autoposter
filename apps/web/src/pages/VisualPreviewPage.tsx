import { Link } from 'react-router';
import { Badge, Card, MetricCard, PageHeader, Progress } from '../components/ui';

const posts = [
  { day: '26', month: 'AGO', platform: 'Instagram', topic: '3 errori che fanno perdere prenotazioni', status: 'DA APPROVARE' },
  { day: '27', month: 'AGO', platform: 'LinkedIn', topic: 'Come costruiamo una strategia che non ripete i post', status: 'PRONTO' },
  { day: '28', month: 'AGO', platform: 'Facebook', topic: 'Dietro le quinte: processo e controllo qualità', status: 'PROGRAMMATO' },
];

export function VisualPreviewPage() {
  return <div className="visual-preview-page">
    <div className="preview-notice"><strong>ANTEPRIMA GRAFICA</strong><span>Dati di esempio solo per valutare interfaccia e responsive. Nessuna API o metrica viene presentata come reale.</span><Link to="/">Torna al sito</Link></div>
    <PageHeader eyebrow="Control room" title="Oggi sai subito cosa richiede attenzione." description="Una dashboard operativa: approvazioni, calendario, salute delle connessioni e risultati leggibili senza riempire lo schermo di widget inutili." action={<button className="button" type="button">Crea contenuto</button>} />

    <div className="control-room-lead">
      <section className="attention-panel">
        <span className="panel-kicker"><span className="live-pulse"/> OGGI</span>
        <div className="attention-number">03</div>
        <h2>azioni prima della prossima pubblicazione.</h2>
        <div className="attention-list">
          <div><span className="attention-icon">1</span><p><strong>Approva il Reel Instagram</strong><small>Pubblicazione prevista alle 18:30</small></p><em>2 min</em></div>
          <div><span className="attention-icon">2</span><p><strong>Collega Google Business Profile</strong><small>Canale ancora non disponibile</small></p><em>setup</em></div>
          <div><span className="attention-icon good">✓</span><p><strong>Calendario coperto</strong><small>Prossimi 7 giorni senza buchi</small></p><em className="good-text">OK</em></div>
        </div>
      </section>

      <Card className="upcoming-panel"><div className="panel-head"><div><span className="panel-kicker">PROSSIME USCITE</span><h2>Calendario operativo</h2></div><Link to="/app/calendar">Apri calendario</Link></div><div className="upcoming-stack">{posts.map((post,index)=><div className="upcoming-item" key={post.topic}><div className={`content-thumb thumb-${index}`}><span>{post.day}<small>{post.month}</small></span></div><div><strong>{post.topic}</strong><small>{post.platform}</small></div><Badge tone={index===0?'warn':index===2?'good':'info'}>{post.status}</Badge></div>)}</div></Card>
    </div>

    <div className="metric-grid preview-metrics"><MetricCard label="Da approvare" value="3" hint="Richiedono una tua decisione"/><MetricCard label="Programmati" value="8" hint="Prossimi 7 giorni"/><MetricCard label="Pubblicati" value="21" hint="Ultimi 30 giorni"/><MetricCard label="Errori" value="0" hint="Nessun job bloccato"/></div>

    <div className="control-room-secondary">
      <Card className="performance-story"><div className="panel-head"><div><span className="panel-kicker">PERFORMANCE</span><h2>Non solo numeri: direzione.</h2></div><Badge tone="good">+18%</Badge></div><div className="performance-chart" aria-label="Grafico dimostrativo">{[35,48,42,61,57,73,65,82,76,91,84,96].map((height,index)=><span key={index} style={{height:`${height}%`}}/>)}</div><div className="performance-foot"><div><small>Reach</small><strong>24.8K</strong></div><div><small>Engagement</small><strong>5.2%</strong></div><div><small>Click</small><strong>684</strong></div></div></Card>
      <Card className="ai-next-card"><span className="panel-kicker">PROSSIMA DECISIONE</span><h2>Più contenuti educativi brevi, meno promozionali generici.</h2><p>Quando ci saranno dati reali sufficienti, qui comparirà una raccomandazione con evidenze e livello di confidenza.</p><div className="evidence-row"><span>Formato</span><span>Argomento</span><span>Orario</span></div><Link to="/app/analytics">Apri analisi →</Link></Card>
      <Card className="plan-usage-card"><span className="panel-kicker">SETUP PROFILO</span><div className="quota-ring" style={{'--quota':'78%'} as React.CSSProperties}><strong>78%</strong><small>completo</small></div><div className="quota-lines"><div><span>Sito analizzato</span><strong>✓</strong></div><div><span>Brand verificato</span><strong>✓</strong></div><div><span>Social collegati</span><strong>2/4</strong></div></div></Card>
    </div>

    <Card className="brand-health-strip"><div><span className="panel-kicker">PROFILO</span><strong>Attività esempio</strong></div><div><div className="health-track"><span style={{width:'78%'}}/></div></div><p>Il sistema usa solo informazioni confermate o evidenze del sito; ciò che manca resta esplicitamente da configurare.</p><Link to="/app/brand">Apri brand →</Link></Card>
  </div>;
}
