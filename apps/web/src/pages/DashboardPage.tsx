import { Link } from 'react-router';
import { Badge, Card, MetricCard, PageHeader, Progress } from '../components/ui';
import { useSaasRepository, useSaasSnapshot } from '../services/SaasServicesProvider';
import { useLocalE2E } from '../services/local-e2e';

const toneFor = (state: string) => state === 'Pubblicato' || state === 'Programmato' ? 'good' : state === 'Da rivedere' ? 'warn' : 'info';

export function DashboardPage() {
  const local = useLocalE2E();
  useSaasSnapshot();
  const dashboard = useSaasRepository().getDashboard();

  if (local.enabled && local.workspace) {
    const w = local.workspace;
    const posts = w.posts;
    const awaiting = posts.filter((post:any)=>post.status==='awaiting_approval'||post.variants?.some((variant:any)=>variant.approval_status==='pending')).length;
    const scheduled = posts.filter((post:any)=>post.status==='scheduled').length;
    const published = posts.filter((post:any)=>post.status==='published').length;
    const failedJobs = w.jobs.filter((job:any)=>job.status==='failed'||job.status==='dead').length;
    const connected = w.connections.filter((connection:any)=>connection.connection_status==='connected').length;
    const frequency = Number(w.onboarding?.frequency?.postsPerWeek ?? 3);
    const analyzed = Number(w.onboarding?.scan_summary?.analyzed ?? 0);
    const coverage = Number(w.onboarding?.scan_summary?.coverage ?? 0);
    const metrics = w.analytics.reduce((acc:any,snapshot:any)=>{for(const [key,value] of Object.entries(snapshot.metrics??{})) if(typeof value==='number') acc[key]=(acc[key]??0)+value; return acc;},{}) as Record<string,number>;
    const upcoming = posts.filter((post:any)=>post.planned_at && !['published','rejected','failed'].includes(post.status)).slice(0,5);
    const issue = w.connections.find((connection:any)=>connection.connection_status!=='connected') ?? w.jobs.find((job:any)=>job.status==='failed'||job.status==='retry_wait');
    return <>
      <PageHeader eyebrow="Panoramica · E2E locale" title={String(w.brand?.brand_name ?? w.tenant?.name ?? 'Workspace')} description="Solo segnali operativi: approvazioni, prossime pubblicazioni, problemi, quote e performance mock persistite." action={<Link className="button" to="/app/calendar">Apri piano editoriale</Link>} />
      <div className="metric-grid"><MetricCard label="Da approvare" value={String(awaiting)} hint="Contenuti con percorso MANUALE"/><MetricCard label="Programmato" value={String(scheduled)} hint="Job scheduler locale"/><MetricCard label="Pubblicati mock" value={String(published)} hint="Con external_mock_id persistito"/><MetricCard label="Problemi" value={String(failedJobs)} hint="Failure job correnti"/></div>
      <div className="metric-grid"><MetricCard label="Impressions mock" value={String(metrics.impressions??0)} hint="Solo metriche previste dai provider mock"/><MetricCard label="Reach mock" value={String(metrics.reach??0)} hint="Snapshot persistiti"/><MetricCard label="Engagement" value={String(metrics.engagements??0)} hint="Somma snapshot"/><MetricCard label="Canali connessi" value={`${connected}/${w.connections.length}`} hint="Stato connessioni mock"/></div>
      <div className="two-col"><Card><div className="card-heading"><div><span className="eyebrow">Prossime pubblicazioni</span><h2>Calendario operativo</h2></div><Link to="/app/calendar">Calendario</Link></div><div className="list-table">{upcoming.map((post:any)=><div className="list-row" key={post.id}><div className="date-chip">{new Date(post.planned_at).toLocaleDateString('it-IT',{day:'2-digit',month:'short'})}</div><div className="grow"><strong>{post.topic}</strong><small>{String(post.primary_platform)} · {post.format}</small></div><Badge tone={post.status==='scheduled'?'good':'info'}>{String(post.status).toUpperCase()}</Badge></div>)}{upcoming.length===0&&<p className="muted">Nessun post imminente.</p>}</div></Card><div className="stack"><Card><span className="eyebrow">Utilizzo / setup</span><h2>Stato tenant</h2><Progress label="Post configurati/settimana" value={Math.min(posts.length,frequency)} max={frequency}/><Progress label="Pagine sito analizzate" value={analyzed} max={50}/><Progress label="Copertura scanner" value={coverage} max={100}/><p><Badge tone={w.tenant?.onboarding_status==='completed'?'good':'warn'}>{String(w.tenant?.onboarding_status??'not_started')}</Badge></p></Card><Card><span className="eyebrow">Problema prioritario</span><h2>{issue?'Richiede attenzione':'Nessun blocco'}</h2><p>{issue?String((issue as any).last_error_code??(issue as any).connection_status??'Verifica il dettaglio operativo.'):'Connessioni e job non mostrano errori bloccanti.'}</p></Card></div></div>
      <Card><div className="card-heading"><div><span className="eyebrow">Learning</span><h2>Suggerimenti supportati dai dati</h2></div><Link to="/app/analytics">Analytics</Link></div>{w.insights.slice(0,4).map((insight:any)=><div className="list-row" key={insight.id}><Badge tone={Number(insight.confidence)>=0.7?'good':'info'}>{Math.round(Number(insight.confidence)*100)}%</Badge><div className="grow"><strong>{insight.title}</strong><small>{insight.body}</small></div></div>)}{w.insights.length===0&&<p className="muted">Il sistema aspetta un campione minimo prima di cambiare strategia automaticamente.</p>}</Card>
    </>;
  }

  const usage = dashboard.usage;
  return <><PageHeader eyebrow="Panoramica" title="Buonasera, Demo Studio" description="Controlla cosa richiede attenzione e cosa il sistema ha già preparato." /><div className="metric-grid"><MetricCard label="Approvazioni" value={String(dashboard.pendingApprovals)} hint="Coda mock aggiornata dallo store"/><MetricCard label="Post programmati" value={String(dashboard.scheduledPosts)} hint="Stato corrente repository"/><MetricCard label="Canali sani" value={`${dashboard.connectedChannels}/${dashboard.totalChannels}`} hint="Health state centralizzato"/><MetricCard label="Copertura Brand Profile" value={`${dashboard.brandCoverage}%`} hint="3 campi da confermare"/></div><div className="two-col"><Card><div className="list-table">{dashboard.posts.map((post)=><div className="list-row" key={post.id}><div className="date-chip">{post.date}</div><div className="grow"><strong>{post.title}</strong><small>{post.platform} · {post.decision}</small></div><Badge tone={toneFor(post.state)}>{post.state}</Badge></div>)}</div></Card><Card><Progress label="Post questa settimana" value={usage.weeklyPosts.used} max={usage.weeklyPosts.limit}/><Progress label="Pagine sito" value={usage.websitePages.used} max={usage.websitePages.limit}/></Card></div></>;
}
