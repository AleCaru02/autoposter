import { Badge, Card, EmptyState, MetricCard, PageHeader, Progress } from '../components/ui';
import { useSaasRepository, useSaasSnapshot } from '../services/SaasServicesProvider';

const formatMetric = (value: number): string => new Intl.NumberFormat('it-IT').format(value);

export function AssetsPage() {
  const { assets } = useSaasSnapshot();
  return <><PageHeader eyebrow="Media" title="Asset Library" description="Archivio tenant-scoped di foto, loghi, documenti e visual generati. Upload reale disattivato." action={<button className="button" type="button">Carica asset · mock</button>} /><div className="asset-grid">{assets.map((asset) => <Card key={asset.id} className="asset-card"><div className={`asset-preview asset-${asset.previewVariant}`}><span>{asset.name.slice(0,2).toUpperCase()}</span></div><strong>{asset.name}</strong><small>{asset.kind} · {asset.usageCount} utilizzi mock</small><div><Badge>{asset.tag}</Badge></div></Card>)}</div></>;
}

export function StrategyPage() {
  const { usage } = useSaasSnapshot();
  return <><PageHeader eyebrow="Strategia" title="Piano editoriale del brand" description="Obiettivi, pillar, mix e preferenze per canale derivati dal contesto confermato." /><div className="three-col"><Card><span className="eyebrow">Obiettivo</span><h2>Lead qualificati</h2><p>Educare prima della CTA e aumentare la fiducia con contenuti concreti.</p></Card><Card><span className="eyebrow">Mix</span><h2>60 / 25 / 15</h2><p>Educazione · autorevolezza · conversione.</p></Card><Card><span className="eyebrow">Frequenza</span><h2>{usage.weeklyPosts.limit} post / settimana</h2><p>Quota letta dal repository mock.</p></Card></div><Card><h2>Content pillars</h2><div className="pillar-grid">{[['Educazione','40%'],['Metodo','25%'],['Prova sociale','20%'],['Conversione','15%']].map(([name,pct]) => <div className="pillar" key={name}><strong>{name}</strong><span>{pct}</span></div>)}</div></Card></>;
}

export function ApprovalsPage() {
  const { posts } = useSaasSnapshot();
  const repository = useSaasRepository();
  const pending = posts.filter((post) => ['In approvazione','Da rivedere','Draft'].includes(post.state));
  return <><PageHeader eyebrow="Controllo umano" title="Approvazioni" description="Coda unica per contenuti che richiedono una decisione prima dello scheduling." /><Card>{pending.length === 0 ? <EmptyState title="Nessuna approvazione pendente" body="Le transizioni mock aggiornano lo store centrale e tutte le pagine collegate." /> : pending.map((post) => <div className="approval-row" key={post.id}><div><strong>{post.title}</strong><small>{post.platform} · {post.decision} · {post.state}</small></div><div className="approval-actions"><button className="button secondary small" type="button" onClick={() => repository.rejectPost(post.id)}>Rifiuta mock</button><button className="button small" type="button" onClick={() => repository.approvePost(post.id)}>Approva mock</button></div></div>)}</Card></>;
}

export function ConnectionsPage() {
  const { connections } = useSaasSnapshot();
  const repository = useSaasRepository();
  return <><PageHeader eyebrow="Provider" title="Connessioni social" description="La UI mostra salute e capability; i pulsanti sono mock e non avviano OAuth." /><div className="connection-grid">{connections.map((connection) => <Card key={connection.id}><div className="row-between"><div className="platform-icon">{connection.platform.slice(0,2).toUpperCase()}</div><Badge tone={connection.status === 'Connesso' ? 'good' : 'warn'}>{connection.status}</Badge></div><h2>{connection.platform}</h2><p>{connection.account}</p>{connection.localLocation && <small>Location: {connection.localLocation}</small>}<small>Ultimo check: {connection.lastCheck}</small><button className="button secondary full" type="button" onClick={() => repository.setConnectionState(connection.id, 'Connesso')}>{connection.status === 'Connesso' ? 'Verifica mock' : 'Riconnetti mock'}</button></Card>)}</div></>;
}

export function AnalyticsPage() {
  const { analytics } = useSaasSnapshot();
  return <><PageHeader eyebrow="Performance" title="Analytics" description="Metriche dimostrative: nessun dato viene presentato come proveniente dalle piattaforme reali." /><div className="metric-grid"><MetricCard label="Impression mock" value={formatMetric(analytics.impressions)} hint="Fixture repository" /><MetricCard label="Reach mock" value={formatMetric(analytics.reach)} hint="Solo fixture" /><MetricCard label="Engagement mock" value={formatMetric(analytics.engagements)} hint="Nessuna API reale" /><MetricCard label="Click mock" value={formatMetric(analytics.clicks)} hint="Nessun tracking reale" /></div><Card><h2>Andamento demo</h2><div className="fake-chart" aria-label="Grafico dimostrativo">{analytics.trend.map((height, index) => <span key={`${height}-${index}`} style={{height:`${height}%`}} />)}</div><p className="muted">Le metriche verranno normalizzate in base a ciò che ogni API rende realmente disponibile.</p></Card></>;
}

export function SupportPage() {
  const { usage } = useSaasSnapshot();
  const remaining = Math.max(0, usage.weeklyPosts.limit - usage.weeklyPosts.used);
  return <><PageHeader eyebrow="Assistenza" title="Supporto AI + umano" description="Il mock tenant-aware riceve solo il contesto del tenant corrente. Il chatbot pubblico usa una knowledge base separata." /><div className="two-col"><Card><h2>Assistente tenant</h2><div className="chat-thread"><div className="chat-user">Quanti post posso ancora programmare?</div><div className="chat-ai">Il piano demo consente {usage.weeklyPosts.limit} post a settimana. Questa settimana risultano {usage.weeklyPosts.used} unità utilizzate nel mock, quindi ne restano {remaining}.</div></div><div className="chat-input"><input placeholder="Scrivi una domanda…"/><button className="button" type="button">Invia mock</button></div></Card><Card><h2>Serve una persona?</h2><p>Apri una richiesta a supporto umano mantenendo cronologia e tenant context, senza condividere secret.</p><button className="button secondary" type="button">Richiedi assistenza</button></Card></div></>;
}

export function BillingPage() {
  const { usage } = useSaasSnapshot();
  return <><PageHeader eyebrow="Entitlements" title="Piano e quote" description="Billing è Stripe-ready ma nessun checkout o addebito è attivo." /><div className="two-col"><Card><div className="row-between"><div><span className="eyebrow">Piano attuale</span><h2>Local Development</h2></div><Badge tone="good">Attivo</Badge></div><p>Fixture a €0 usata esclusivamente nello sviluppo locale.</p><Progress label="Post settimanali" value={usage.weeklyPosts.used} max={usage.weeklyPosts.limit}/><Progress label="Pagine sito" value={usage.websitePages.used} max={usage.websitePages.limit}/><Progress label="Storage MB" value={usage.storageMb.used} max={usage.storageMb.limit}/></Card><Card><h2>Fatturazione</h2><EmptyState title="Checkout non configurato" body="Stripe verrà collegato soltanto quando avrà senso attivare clienti reali." /></Card></div></>;
}

export function SettingsPage() { return <><PageHeader eyebrow="Workspace" title="Impostazioni" description="Configurazioni tenant, ruoli, timezone e modalità di approvazione." /><div className="two-col"><Card><h2>Tenant</h2><label className="field"><span>Nome workspace</span><input readOnly value="Demo Studio"/></label><label className="field"><span>Timezone</span><input readOnly value="Europe/Rome"/></label><label className="field"><span>Locale</span><input readOnly value="it-IT"/></label></Card><Card><h2>Publishing</h2><label className="toggle-row"><span><strong>Approvazione manuale</strong><small>Default globale</small></span><input type="checkbox" checked readOnly/></label><label className="toggle-row"><span><strong>Social publishing reale</strong><small>Safety flag</small></span><input type="checkbox" checked={false} readOnly/></label></Card></div></>; }

export function AdminPage() {
  const { connections } = useSaasSnapshot();
  return <><PageHeader eyebrow="Platform admin" title="Console amministrativa" description="Vista mock per piani, feature flag, costi AI, tenant e salute sistema." /><div className="metric-grid"><MetricCard label="Tenant demo" value="2" hint="Solo fixture"/><MetricCard label="AI cost mock" value="€0,00" hint="Provider live spento"/><MetricCard label="Canali mock" value={String(connections.length)} hint="Repository tipizzato"/><MetricCard label="Feature flags" value="8" hint="Configurabili"/></div><div className="two-col"><Card><h2>Feature flags</h2>{['meta','linkedin','googleBusinessProfile','telegram','aiImagery','advancedAnalytics'].map((flag,index) => <div className="toggle-row" key={flag}><span><strong>{flag}</strong><small>{index < 3 ? 'enabled mock' : 'disabled mock'}</small></span><input type="checkbox" checked={index < 3} readOnly/></div>)}</Card><Card><h2>System health</h2><div className="health-list"><div><span className="status-dot"/>Database locale <Badge tone="good">20 pgTAP + 17 integration</Badge></div><div><span className="status-dot"/>Runtime mock <Badge tone="good">29/29</Badge></div><div><span className="status-dot"/>Web CI <Badge tone="good">5/5 + build</Badge></div><div><span className="status-dot warn"/>Supabase remoto <Badge tone="warn">Posticipato</Badge></div><div><span className="status-dot warn"/>Provider reali <Badge tone="warn">Posticipati</Badge></div></div></Card></div></>;
}
