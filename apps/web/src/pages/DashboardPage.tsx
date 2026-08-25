import { Link } from 'react-router';
import { Badge, Card, EmptyState, MetricCard, PageHeader, Progress } from '../components/ui';
import { useLocalE2E } from '../services/local-e2e';

export function DashboardPage() {
  const local = useLocalE2E();
  const w = local.workspace;
  if (!w) return <><PageHeader eyebrow="Panoramica" title="Configura la prima attività" description="La dashboard mostra solo dati persistiti dell’attività selezionata."/><Card><EmptyState title="Nessuna attività attiva" body="Crea o seleziona un’attività per iniziare."/><Link className="button" to="/onboarding?new=1">Crea attività</Link></Card></>;

  const posts = w.posts;
  const awaiting = posts.filter((post:any)=>post.status==='awaiting_approval'||post.variants?.some((variant:any)=>variant.approval_status==='pending')).length;
  const scheduled = posts.filter((post:any)=>post.status==='scheduled'||post.variants?.some((variant:any)=>variant.status==='scheduled')).length;
  const published = posts.filter((post:any)=>post.status==='published').length;
  const failedJobs = w.jobs.filter((job:any)=>job.status==='failed'||job.status==='dead').length;
  const connected = w.connections.filter((connection:any)=>connection.connection_status==='connected').length;
  const frequency = Math.max(1,Number(w.onboarding?.frequency?.postsPerWeek ?? 3));
  const analyzed = Number(w.onboarding?.scan_summary?.analyzed ?? 0);
  const coverage = Number(w.onboarding?.scan_summary?.coverage ?? 0);
  const metrics = w.analytics.reduce((acc:any,snapshot:any)=>{for(const [key,value] of Object.entries(snapshot.metrics??{})) if(typeof value==='number') acc[key]=(acc[key]??0)+value; return acc;},{}) as Record<string,number>;
  const upcoming = posts.filter((post:any)=>post.planned_at && !['published','rejected','failed'].includes(post.status)).slice(0,5);
  const issue = w.connections.find((connection:any)=>connection.connection_status!=='connected') ?? w.jobs.find((job:any)=>job.status==='failed'||job.status==='retry_wait');
  const workspaceName=String(w.brand?.brand_name ?? w.tenant?.name ?? 'Attività');
  const hasAnalytics=w.analytics.length>0;

  return <>
    <PageHeader eyebrow="Panoramica" title={`Cosa richiede attenzione in ${workspaceName}`} description="Approvazioni, calendario, connessioni e risultati della sola attività selezionata." action={<Link className="button" to="/app/calendar">Apri calendario</Link>} />
    <div className="two-col">
      <Card><div className="card-heading"><div><span className="eyebrow">Da fare ora</span><h2>{awaiting>0?`${awaiting} contenuti aspettano una decisione`:'Nessuna approvazione urgente'}</h2></div>{awaiting>0&&<Badge tone="warn">AZIONE</Badge>}</div><p className="muted">{awaiting>0?'Controlla la preview e decidi dal sito o da Telegram.':'La coda approvazioni è vuota.'}</p><div className="card-actions"><Link className="button" to="/app/approvals">Apri anteprime</Link><Link className="button secondary" to="/app/assets">Asset Library</Link></div></Card>
      <Card><div className="card-heading"><div><span className="eyebrow">Salute operativa</span><h2>{issue?'Serve un intervento':'Nessun errore rilevato'}</h2></div><Badge tone={issue?'warn':'good'}>{issue?'ATTENZIONE':'OK'}</Badge></div><p className="muted">{issue?humanIssue(issue):'Non risultano job falliti o connessioni in errore tra quelle configurate.'}</p><Link className="button secondary" to="/app/connections">Controlla connessioni</Link></Card>
    </div>
    <div className="metric-grid"><MetricCard label="Da approvare" value={String(awaiting)} hint="Preview in attesa"/><MetricCard label="Programmati" value={String(scheduled)} hint="Dopo approvazione"/><MetricCard label="Pubblicati" value={String(published)} hint="Confermati dal flusso provider"/><MetricCard label="Problemi" value={String(failedJobs)} hint="Job da controllare"/></div>
    <div className="two-col">
      <Card><div className="card-heading"><div><span className="eyebrow">Prossime pubblicazioni</span><h2>Calendario operativo</h2></div><Link to="/app/calendar">Vedi tutto</Link></div><div className="list-table">{upcoming.map((post:any)=><div className="list-row" key={post.id}><div className="date-chip">{new Date(post.planned_at).toLocaleDateString('it-IT',{day:'2-digit',month:'short'})}</div><div className="grow"><strong>{post.topic}</strong><small>{platformName(post.primary_platform)} · {post.format??'—'}</small></div><Badge tone={post.status==='scheduled'?'good':'info'}>{String(post.status).toUpperCase()}</Badge></div>)}{upcoming.length===0&&<p className="muted">Nessun contenuto imminente.</p>}</div></Card>
      <div className="stack"><Card><span className="eyebrow">Configurazione</span><h2>Attività</h2><Progress label="Post configurati/settimana" value={Math.min(posts.length,frequency)} max={frequency}/><Progress label="Pagine sito analizzate" value={analyzed} max={Math.max(1,analyzed)}/><Progress label="Copertura scanner" value={coverage} max={100}/><p><Badge tone={w.tenant?.onboarding_status==='completed'?'good':'warn'}>{String(w.tenant?.onboarding_status??'not_started').toUpperCase()}</Badge></p></Card><Card><span className="eyebrow">Canali social</span><h2>{connected}/{w.connections.length} connessi</h2><p className="muted">Un canale conta come connesso soltanto se il provider lo conferma.</p><Link to="/app/connections">Gestisci connessioni →</Link></Card></div>
    </div>
    <div className="metric-grid"><MetricCard label="Impressions" value={String(metrics.impressions??0)} hint={hasAnalytics?'Snapshot provider':'Nessun dato provider'}/><MetricCard label="Reach" value={String(metrics.reach??0)} hint={hasAnalytics?'Snapshot provider':'Nessun dato provider'}/><MetricCard label="Engagement" value={String(metrics.engagements??0)} hint={hasAnalytics?'Snapshot provider':'Nessun dato provider'}/><MetricCard label="Canali connessi" value={`${connected}/${w.connections.length}`} hint="Stato provider"/></div>
    <Card><div className="card-heading"><div><span className="eyebrow">Apprendimento</span><h2>Cosa sta imparando il sistema</h2></div><Link to="/app/analytics">Apri Analytics</Link></div>{w.insights.slice(0,4).map((insight:any)=><div className="list-row" key={insight.id}><Badge tone={Number(insight.confidence)>=0.7?'good':'info'}>{Math.round(Number(insight.confidence)*100)}%</Badge><div className="grow"><strong>{insight.title}</strong><small>{insight.body}</small></div></div>)}{w.insights.length===0&&<p className="muted">Nessun insight ancora: il sistema aspetta metriche reali sufficienti prima di modificare strategia, giorni, orari o formati.</p>}</Card>
  </>;
}

function humanIssue(issue:any){const code=String(issue.last_error_code??issue.connection_status??'').toLowerCase();if(code.includes('rate'))return'Una pubblicazione è in attesa per rate limit; il retry resta tracciato.';if(code.includes('reauth')||code.includes('expired'))return'Un social deve essere ricollegato prima di pubblicare.';if(code.includes('permission'))return'Mancano autorizzazioni necessarie su una connessione.';return'Controlla il dettaglio operativo prima della prossima pubblicazione.';}
function platformName(value:unknown){return value==='google_business_profile'?'Google Business Profile':String(value??'').replace(/^./,(c)=>c.toUpperCase());}
