import { demoPosts } from '../app/demo-data';
import { Badge, Card, MetricCard, PageHeader, Progress } from '../components/ui';

const toneFor = (state: string) => state === 'Pubblicato' || state === 'Programmato' ? 'good' : state === 'Da rivedere' ? 'warn' : 'info';

export function DashboardPage() {
  return <>
    <PageHeader eyebrow="Panoramica" title="Buonasera, Demo Studio" description="Controlla cosa richiede attenzione e cosa il sistema ha già preparato." action={<button className="button" type="button">+ Nuovo concept</button>} />
    <div className="metric-grid"><MetricCard label="Approvazioni" value="3" hint="2 entro domani" /><MetricCard label="Post programmati" value="6" hint="Prossimi 7 giorni" /><MetricCard label="Canali sani" value="3/4" hint="LinkedIn da riconnettere" /><MetricCard label="Copertura Brand Profile" value="92%" hint="3 campi da confermare" /></div>
    <div className="two-col">
      <Card><div className="card-heading"><div><span className="eyebrow">Prossimi contenuti</span><h2>Calendario in arrivo</h2></div><a href="/app/calendar">Apri calendario</a></div><div className="list-table">{demoPosts.slice(0, 5).map((post) => <div className="list-row" key={post.id}><div className="date-chip">{post.date}</div><div className="grow"><strong>{post.title}</strong><small>{post.platform} · {post.decision}</small></div><Badge tone={toneFor(post.state)}>{post.state}</Badge></div>)}</div></Card>
      <div className="stack"><Card><span className="eyebrow">Utilizzo</span><h2>Quote del piano</h2><Progress label="Post questa settimana" value={2} max={3} /><Progress label="Pagine sito analizzate" value={18} max={50} /><Progress label="Storage asset" value={126} max={1024} /></Card><Card><span className="eyebrow">Segnale</span><h2>Una cosa da sistemare</h2><p>La connessione LinkedIn demo è in stato <strong>reauth_required</strong>. Il mock impedisce correttamente il publishing finché non torna sana.</p><a href="/app/connections">Apri connessioni →</a></Card></div>
    </div>
  </>;
}
