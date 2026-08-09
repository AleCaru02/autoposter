import { Link } from 'react-router';
import { Badge, Card, MetricCard, PageHeader, Progress } from '../components/ui';
import { useSaasRepository, useSaasSnapshot } from '../services/SaasServicesProvider';

const toneFor = (state: string) => state === 'Pubblicato' || state === 'Programmato' ? 'good' : state === 'Da rivedere' ? 'warn' : 'info';

export function DashboardPage() {
  useSaasSnapshot();
  const dashboard = useSaasRepository().getDashboard();
  const usage = dashboard.usage;

  return <>
    <PageHeader eyebrow="Panoramica" title="Buonasera, Demo Studio" description="Controlla cosa richiede attenzione e cosa il sistema ha già preparato." action={<button className="button" type="button">+ Nuovo concept</button>} />
    <div className="metric-grid">
      <MetricCard label="Approvazioni" value={String(dashboard.pendingApprovals)} hint="Coda mock aggiornata dallo store" />
      <MetricCard label="Post programmati" value={String(dashboard.scheduledPosts)} hint="Stato corrente repository" />
      <MetricCard label="Canali sani" value={`${dashboard.connectedChannels}/${dashboard.totalChannels}`} hint="Health state centralizzato" />
      <MetricCard label="Copertura Brand Profile" value={`${dashboard.brandCoverage}%`} hint="3 campi da confermare" />
    </div>
    <div className="two-col">
      <Card><div className="card-heading"><div><span className="eyebrow">Prossimi contenuti</span><h2>Calendario in arrivo</h2></div><Link to="/app/calendar">Apri calendario</Link></div><div className="list-table">{dashboard.posts.map((post) => <div className="list-row" key={post.id}><div className="date-chip">{post.date}</div><div className="grow"><strong>{post.title}</strong><small>{post.platform} · {post.decision}</small></div><Badge tone={toneFor(post.state)}>{post.state}</Badge></div>)}</div></Card>
      <div className="stack"><Card><span className="eyebrow">Utilizzo</span><h2>Quote del piano</h2><Progress label="Post questa settimana" value={usage.weeklyPosts.used} max={usage.weeklyPosts.limit} /><Progress label="Pagine sito analizzate" value={usage.websitePages.used} max={usage.websitePages.limit} /><Progress label="Storage asset" value={usage.storageMb.used} max={usage.storageMb.limit} /></Card><Card><span className="eyebrow">Segnale</span><h2>Una cosa da sistemare</h2><p>La connessione LinkedIn demo richiede riconnessione. Il mock impedisce correttamente il publishing finché non torna sana.</p><Link to="/app/connections">Apri connessioni →</Link></Card></div>
    </div>
  </>;
}
