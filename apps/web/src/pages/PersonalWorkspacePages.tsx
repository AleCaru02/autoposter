import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Badge, Card, EmptyState, PageHeader } from '../components/ui';
import { useLocalE2E, type ApiPlatform } from '../services/local-e2e';

const platformLabels: Record<ApiPlatform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  google_business_profile: 'Google Business Profile',
};

type TelegramStatus={configured:boolean;status:'not_configured'|'disconnected'|'pending'|'connected'|'disabled';connectedAt?:string|null;lastVerifiedAt?:string|null;botUsername?:string|null};

function useTelegramStatus(){
  const local=useLocalE2E();
  const [status,setStatus]=useState<TelegramStatus|null>(null);
  const [error,setError]=useState<string|null>(null);
  const refresh=async()=>{
    if(!local.enabled||!local.tenantId){setStatus(null);return;}
    try{setStatus(await local.api<TelegramStatus>(`/tenants/${local.tenantId}/telegram`));setError(null);}catch(e){setError(e instanceof Error?e.message:String(e));}
  };
  useEffect(()=>{void refresh()},[local.enabled,local.tenantId]);
  return{local,status,error,refresh};
}

export function SitePage() {
  const local = useLocalE2E();
  const [message, setMessage] = useState<string | null>(null);
  const onboarding = local.workspace?.onboarding as any;
  const summary = onboarding?.scan_summary as any;
  const website = String(onboarding?.business?.website ?? '').trim();
  const urls = Array.isArray(summary?.urls) ? summary.urls : [];

  const rescan = async () => {
    if (!local.tenantId) return;
    setMessage(null);
    try {
      await local.api(`/tenants/${local.tenantId}/scan`, { method: 'POST' });
      await local.refresh();
      setMessage('Scansione completata e dati aggiornati.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return <>
    <PageHeader eyebrow="Sito · conoscenza del brand" title="Analisi pagina per pagina" description="La copertura viene mostrata solo quando il crawler ha realmente visitato le URL. Nessuna homepage viene spacciata per analisi completa." action={<button className="button" type="button" disabled={!local.enabled || !local.tenantId || !website} onClick={() => void rescan()}>Riscansiona sito</button>} />
    {message && <Card><p role="status">{message}</p></Card>}
    <div className="two-col">
      <Card>
        <span className="eyebrow">Sorgente</span>
        <h2>{website || 'Nessun sito configurato'}</h2>
        <p>{website ? 'Il crawler server-side segue link interni, sitemap e regole di sicurezza previste dal motore.' : 'Aggiungi il sito nell’onboarding dell’attività per poter avviare una scansione reale.'}</p>
        {!website && <Link className="button secondary" to="/onboarding">Configura attività</Link>}
      </Card>
      <Card>
        <span className="eyebrow">Copertura verificata</span>
        <h2>{summary ? `${Number(summary.coverage ?? 0)}%` : 'Non disponibile'}</h2>
        <p>{summary ? `${Number(summary.analyzed ?? 0)} URL analizzate · ${Number(summary.discovered ?? 0)} rilevate · ${Number(summary.relevant ?? 0)} rilevanti` : 'Nessuna scansione completata per questa attività.'}</p>
        <Badge tone={summary?.status === 'completed' ? 'good' : summary?.status === 'failed' ? 'warn' : 'info'}>{String(summary?.status ?? 'NON ESEGUITA')}</Badge>
      </Card>
    </div>
    <Card>
      <div className="row-between"><div><span className="eyebrow">Pagine</span><h2>URL realmente analizzate</h2></div><small>{urls.length} record nel riepilogo corrente</small></div>
      {urls.length === 0 ? <EmptyState title="Nessuna pagina verificata" body="Non mostriamo pagine o contenuti inventati. Avvia la scansione quando il backend è disponibile." /> : <div className="stack">{urls.map((item: any) => <div className="list-row" key={String(item.url)}><Badge tone={Number(item.status) >= 200 && Number(item.status) < 400 ? 'good' : 'warn'}>{String(item.status ?? '—')}</Badge><div className="grow"><strong>{String(item.title ?? item.url)}</strong><small>{String(item.url)}</small></div></div>)}</div>}
    </Card>
    <Card><span className="eyebrow">Stato servizio</span><h2>{local.enabled ? 'Crawler collegato al backend' : 'Servizio server da configurare'}</h2><p className="muted">Il browser da solo non può garantire un crawling completo a causa di CORS, robots e limiti di rete. Per questo Post Automatici non simula la scansione lato client.</p></Card>
  </>;
}

export function ContentsPage() {
  const local = useLocalE2E();
  const posts = local.workspace?.posts ?? [];
  return <>
    <PageHeader eyebrow="Contenuti" title="Contenuti dell’attività attiva" description="Ogni contenuto appartiene soltanto al profilo selezionato. Generazione OpenAI e immagini restano disabilitate finché il servizio server non è configurato." action={<button type="button" className="button" disabled title="OpenAI da configurare">Genera con OpenAI · Da configurare</button>} />
    <Card>
      {posts.length === 0 ? <EmptyState title="Nessun contenuto" body="Configura strategia e OpenAI per iniziare a generare contenuti reali." /> : <div className="stack">{posts.map((post: any) => {
        const variants = Array.isArray(post.variants) ? post.variants : [];
        const platforms = variants.filter((variant: any) => variant.platform_decision !== 'skip').map((variant: any) => platformLabels[variant.platform as ApiPlatform] ?? String(variant.platform));
        return <article className="list-row" key={String(post.id)}><div className="grow"><div className="row-between"><strong>{String(post.topic ?? 'Contenuto')}</strong><Badge>{String(post.status ?? 'DRAFT')}</Badge></div><small>{String(post.format ?? 'formato da definire')} · {platforms.join(', ') || 'nessuna piattaforma'} · {post.planned_at ? new Date(String(post.planned_at)).toLocaleString('it-IT') : 'non programmato'}</small></div><Link className="button secondary small" to={`/app/posts/${post.id}`}>Apri</Link></article>;
      })}</div>}
    </Card>
    <div className="two-col">
      <Card><h2>Testi AI</h2><Badge tone="warn">DA CONFIGURARE</Badge><p>La generazione reale deve passare da OpenAI lato server. Nessuna API key viene salvata nel browser.</p><button type="button" className="button secondary" disabled>Genera testo</button></Card>
      <Card><h2>Immagini</h2><Badge tone="warn">DA CONFIGURARE</Badge><p>Provider ammesso: <strong>OpenAI Immagini 2</strong>. Nessun generatore alternativo viene usato come fallback nascosto.</p><button type="button" className="button secondary" disabled>Genera con OpenAI Immagini 2</button></Card>
    </div>
  </>;
}

export function SocialConnectionsPage() {
  const local = useLocalE2E();
  const connections = local.workspace?.connections ?? [];
  const platforms: ApiPlatform[] = ['instagram', 'facebook', 'linkedin', 'google_business_profile'];
  const telegram=useTelegramStatus();
  const [message,setMessage]=useState<string|null>(null);

  const pairTelegram=async()=>{
    if(!local.tenantId)return;
    try{
      const result=await local.api<{link:string}>(`/tenants/${local.tenantId}/telegram/pair`,{method:'POST'});
      window.open(result.link,'_blank','noopener,noreferrer');
      setMessage('Apri Telegram e premi START per completare il collegamento.');
      await telegram.refresh();
    }catch(e){setMessage(e instanceof Error?e.message:String(e));}
  };
  const disconnectTelegram=async()=>{
    if(!local.tenantId)return;
    try{await local.api(`/tenants/${local.tenantId}/telegram/disconnect`,{method:'POST'});setMessage('Telegram scollegato.');await telegram.refresh();}catch(e){setMessage(e instanceof Error?e.message:String(e));}
  };

  return <>
    <PageHeader eyebrow="Social" title="Connessioni" description="Una connessione diventa operativa solo dopo OAuth, permessi e account verificati. Non vengono mostrati account connessi se il provider non lo conferma realmente." />
    {message&&<Card><p role="status">{message}</p></Card>}
    <div className="connection-grid">{platforms.map((platform) => {
      const connection = connections.find((item: any) => item.platform === platform) as any;
      const status=connection?.connection_status?String(connection.connection_status).toUpperCase():'DA CONFIGURARE';
      const connected=status==='CONNECTED';
      return <Card key={platform}><div className="row-between"><div className="platform-icon">{platformLabels[platform].slice(0, 2).toUpperCase()}</div><Badge tone={connected?'good':'warn'}>{status}</Badge></div><h2>{platformLabels[platform]}</h2><p>{connected?'Connessione provider verificata.':'OAuth/credenziali provider non ancora configurati.'}</p><button type="button" className="button secondary" disabled={!connected}> {connected?'Gestisci account':'Connetti · API da configurare'}</button></Card>;
    })}</div>
    <div className="two-col">
      <Card><div className="row-between"><div><span className="eyebrow">Approvazioni</span><h2>Telegram</h2></div><Badge tone={telegram.status?.status==='connected'?'good':'warn'}>{telegram.status?.status==='connected'?'CONNESSO':telegram.status?.configured?String(telegram.status.status??'DISCONNESSO').toUpperCase():'DA CONFIGURARE'}</Badge></div><p>Ricevi l’anteprima del contenuto su Telegram e decidi <strong>Approva/Pubblica</strong> oppure <strong>Non pubblicare</strong>. La decisione viene registrata come approvazione reale.</p>{telegram.error&&<p role="alert">{telegram.error}</p>}{telegram.status?.status==='connected'?<button className="button secondary" onClick={()=>void disconnectTelegram()}>Scollega Telegram</button>:<button className="button" disabled={!telegram.status?.configured} onClick={()=>void pairTelegram()}>{telegram.status?.configured?'Collega Telegram':'Telegram · API da configurare'}</button>}</Card>
      <Card><h2>Gate di pubblicazione</h2><p>Ogni variante deve passare dalla preview e ricevere una tua decisione dal sito o da Telegram. L’impostazione automatica può solo pubblicare <strong>dopo</strong> l’approvazione.</p><Badge tone="good">APPROVAZIONE UMANA OBBLIGATORIA</Badge></Card>
    </div>
  </>;
}

export function PersonalSettingsPage() {
  const local = useLocalE2E();
  const telegram=useTelegramStatus();
  const telegramLabel=telegram.status?.status==='connected'?'CONNESSO':telegram.status?.configured?String(telegram.status.status??'DISCONNESSO').toUpperCase():'DA CONFIGURARE';
  const rows = [
    ['Persistenza dati', local.enabled ? 'BACKEND COLLEGATO' : 'DA CONFIGURARE', local.enabled ? 'good' : 'warn'],
    ['OpenAI testi', 'DA CONFIGURARE', 'warn'],
    ['OpenAI Immagini 2', 'DA CONFIGURARE', 'warn'],
    ['Instagram / Meta', 'DA CONFIGURARE', 'warn'],
    ['Facebook / Meta', 'DA CONFIGURARE', 'warn'],
    ['LinkedIn', 'DA CONFIGURARE', 'warn'],
    ['Google Business Profile', 'DA CONFIGURARE', 'warn'],
    ['Telegram approvazioni', telegramLabel, telegram.status?.status==='connected'?'good':'warn'],
    ['GitHub / Vercel deploy', 'DA VERIFICARE NELL’AMBIENTE', 'info'],
  ] as const;
  return <>
    <PageHeader eyebrow="Impostazioni" title="Stato del sistema" description="Qui viene mostrato ciò che è davvero disponibile. Nessuna integrazione passa a ‘connessa’ senza una verifica reale." />
    <Card>{rows.map(([label, status, tone]) => <div className="signal-row" key={label}><span>{label}</span><Badge tone={tone}>{status}</Badge></div>)}</Card>
    <Card><h2>Attività attiva</h2><p><strong>{String(local.workspace?.tenant?.name ?? local.tenants.find((tenant) => tenant.id === local.tenantId)?.name ?? 'Nessuna attività')}</strong></p><p className="muted">Ogni attività mantiene separati brand, sito, strategia, contenuti, calendario, metriche e apprendimento.</p><Link className="button secondary" to="/onboarding?new=1">+ Crea nuova attività</Link></Card>
  </>;
}
