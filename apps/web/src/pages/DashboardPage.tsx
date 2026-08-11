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
    const workspaceName=String(w.brand?.brand_name ?? w.tenant?.name ?? 'Workspace');
    return <>
      <PageHeader eyebrow="Panoramica · E2E locale" title={`Cosa richiede attenzione in ${workspaceName}`} description="Una control room operativa: prima approvazioni e problemi, poi calendario, performance e suggerimenti." action={<Link className="button" to="/app/calendar">Apri piano editoriale</Link>} />
      <div className="two-col"><Card><div className="card-heading"><div><span className="eyebrow">Da fare ora</span><h2>{awaiting>0?`${awaiting} contenuti aspettano una decisione`:'Nessuna approvazione urgente'}</h2></div>{awaiting>0&&<Badge tone="warn">AZIONE</Badge>}</div><p className="muted">{awaiting>0?'Apri la coda, controlla copy e visuale e approva solo ciò che è pronto.':'La coda manuale è sotto controllo.'}</p><div className="card-actions"><Link className="button" to="/app/approvals">Apri Approval Center</Link><Link className="button secondary" to="/app/assets">Asset Library</Link></div></Card><Card><div className="card-heading"><div><span className="eyebrow">Salute operativa</span><h2>{issue?'Serve un intervento':'Tutto sotto controllo'}</h2></div><Badge tone={issue?'warn':'good'}>{issue?'ATTENZIONE':'OK'}</Badge></div><p className="muted">{issue?humanIssue(issue):'Connessioni e job non mostrano blocchi correnti.'}</p><div className="card-actions"><Link className="button secondary" to="/app/connections">Controlla connessioni</Link></div></Card></div>
      <div className="metric-grid"><MetricCard label="Da approvare" value={String(awaiting)} hint="Contenuti con percorso MANUALE"/><MetricCard label="Programmato" value={String(scheduled)} hint="Prossime uscite"/><MetricCard label="Pubblicati mock" value={String(published)} hint="Fixture persistite"/><MetricCard label="Problemi" value={String(failedJobs)} hint="Job che richiedono attenzione"/></div>
      <div className="two-col"><Card><div className="card-heading"><div><span className="eyebrow">Prossime pubblicazioni</span><h2>Calendario operativo</h2></div><Link to="/app/calendar">Vedi tutto</Link></div><div className="list-table">{upcoming.map((post:any)=><div className="list-row" key={post.id}><div className="date-chip">{new Date(post.planned_at).toLocaleDateString('it-IT',{day:'2-digit',month:'short'})}</div><div className="grow"><strong>{post.topic}</strong><small>{String(post.primary_platform)} · {post.format}</small></div><Badge tone={post.status==='scheduled'?'good':'info'}>{String(post.status).toUpperCase()}</Badge></div>)}{upcoming.length===0&&<p className="muted">Nessun post imminente. Genera o aggiorna il calendario editoriale.</p>}</div></Card><div className="stack"><Card><span className="eyebrow">Setup e quota</span><h2>Workspace</h2><Progress label="Post configurati/settimana" value={Math.min(posts.length,frequency)} max={frequency}/><Progress label="Pagine sito analizzate" value={analyzed} max={50}/><Progress label="Copertura scanner" value={coverage} max={100}/><p><Badge tone={w.tenant?.onboarding_status==='completed'?'good':'warn'}>{String(w.tenant?.onboarding_status??'not_started')}</Badge></p></Card><Card><span className="eyebrow">Canali</span><h2>{connected}/{w.connections.length} connessi</h2><p className="muted">Lo stato connessione deve restare leggibile e azionabile prima di ogni pubblicazione.</p><Link to="/app/connections">Gestisci social →</Link></Card></div></div>
      <div className="metric-grid"><MetricCard label="Impressions mock" value={String(metrics.impressions??0)} hint="Metriche provider fixture"/><MetricCard label="Reach mock" value={String(metrics.reach??0)} hint="Snapshot persistiti"/><MetricCard label="Engagement" value={String(metrics.engagements??0)} hint="Somma snapshot"/><MetricCard label="Canali connessi" value={`${connected}/${w.connections.length}`} hint="Connection health"/></div>
      <Card><div className="card-heading"><div><span className="eyebrow">Learning</span><h2>Cosa osservare adesso</h2></div><Link to="/app/analytics">Apri Analytics</Link></div>{w.insights.slice(0,4).map((insight:any)=><div className="list-row" key={insight.id}><Badge tone={Number(insight.confidence)>=0.7?'good':'info'}>{Math.round(Number(insight.confidence)*100)}%</Badge><div className="grow"><strong>{insight.title}</strong><small>{insight.body}</small></div></div>)}{w.insights.length===0&&<p className="muted">Il sistema aspetta un campione minimo prima di proporre cambi di strategia.</p>}</Card>
    </>;
  }

  const usage = dashboard.usage;
  return <><PageHeader eyebrow="Panoramica" title="Buonasera, Demo Studio" description="Controlla cosa richiede attenzione e cosa il sistema ha già preparato." /><div className="metric-grid"><MetricCard label="Approvazioni" value={String(dashboard.pendingApprovals)} hint="Coda mock aggiornata dallo store"/><MetricCard label="Post programmati" value={String(dashboard.scheduledPosts)} hint="Stato corrente repository"/><MetricCard label="Canali sani" value={`${dashboard.connectedChannels}/${dashboard.totalChannels}`} hint="Health state centralizzato"/><MetricCard label="Copertura Brand Profile" value={`${dashboard.brandCoverage}%`} hint="3 campi da confermare"/></div><div className="two-col"><Card><div className="list-table">{dashboard.posts.map((post)=><div className="list-row" key={post.id}><div className="date-chip">{post.date}</div><div className="grow"><strong>{post.title}</strong><small>{post.platform} · {post.decision}</small></div><Badge tone={toneFor(post.state)}>{post.state}</Badge></div>)}</div></Card><Card><Progress label="Post questa settimana" value={usage.weeklyPosts.used} max={usage.weeklyPosts.limit}/><Progress label="Pagine sito" value={usage.websitePages.used} max={usage.websitePages.limit}/></Card></div></>;
}

function humanIssue(issue:any){const code=String(issue.last_error_code??issue.connection_status??'').toLowerCase();if(code.includes('rate'))return'Una pubblicazione è in attesa per rate limit. Il retry resta tracciato.';if(code.includes('reauth')||code.includes('expired'))return'Un social deve essere ricollegato prima di poter pubblicare.';if(code.includes('permission'))return'Mancano autorizzazioni necessarie su una connessione.';return'Controlla il dettaglio operativo prima della prossima pubblicazione.';}
