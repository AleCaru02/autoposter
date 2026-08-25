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
  const aiReady=Boolean(local.health?.testFixtures||local.health?.capabilities?.openai);
  const imagesReady=Boolean(local.health?.testFixtures||local.health?.capabilities?.openaiImages2);
  const [message,setMessage]=useState<string|null>(null);
  const [working,setWorking]=useState(false);
  const generate=async()=>{
    if(!local.tenantId||!aiReady||posts.length===0)return;
    setWorking(true);setMessage(null);
    try{await local.api(`/tenants/${local.tenantId}/posts/generate-all`,{method:'POST',body:JSON.stringify({limit:50})});await local.refresh();setMessage('Contenuti generati. Prima di qualsiasi pubblicazione devi verificarli nelle Anteprime da approvare.');}
    catch(error){setMessage(error instanceof Error?error.message:String(error));}
    finally{setWorking(false);}
  };
  return <>
    <PageHeader eyebrow="Contenuti" title="Contenuti dell’attività attiva" description="Ogni contenuto appartiene soltanto al profilo selezionato. Copy e visuali passano dal backend e restano soggetti alla tua anteprima e approvazione." action={<button data-testid="generate-content" type="button" className="button" disabled={!aiReady||!local.tenantId||posts.length===0||working} title={!aiReady?'OpenAI non configurato':posts.length===0?'Genera prima il calendario':'Genera i contenuti con OpenAI'} onClick={()=>void generate()}>{working?'Generazione…':'Genera con OpenAI'}</button>} />
    {message&&<Card><p role="status">{message}</p></Card>}
    <Card>
      {posts.length === 0 ? <EmptyState title="Nessun contenuto pianificato" body="Genera prima il calendario editoriale, poi crea copy e visuali reali." action={<Link className="button" to="/app/calendar">Apri calendario</Link>} /> : <div className="stack">{posts.map((post: any) => {
        const variants = Array.isArray(post.variants) ? post.variants : [];
        const platforms = variants.filter((variant: any) => variant.platform_decision !== 'skip').map((variant: any) => platformLabels[variant.platform as ApiPlatform] ?? String(variant.platform));
        return <article className="list-row" key={String(post.id)}><div className="grow"><div className="row-between"><strong>{String(post.topic ?? 'Contenuto')}</strong><Badge>{String(post.status ?? 'DRAFT')}</Badge></div><small>{String(post.format ?? 'formato da definire')} · {platforms.join(', ') || 'varianti da generare'} · {post.planned_at ? new Date(String(post.planned_at)).toLocaleString('it-IT') : 'non programmato'}</small></div><Link className="button secondary small" to={`/app/posts/${post.id}`}>Apri</Link></article>;
      })}</div>}
    </Card>
    <div className="two-col">
      <Card><div className="row-between"><h2>Testi AI</h2><Badge tone={aiReady?'good':'warn'}>{aiReady?'OPERATIVO':'DA CONFIGURARE'}</Badge></div><p>{aiReady?'OpenAI è confermato dal backend. Le chiavi restano esclusivamente lato server.':'La generazione resta disabilitata finché il backend non conferma OpenAI.'}</p></Card>
      <Card><div className="row-between"><h2>Immagini</h2><Badge tone={imagesReady?'good':'warn'}>{imagesReady?'OPENAI IMMAGINI 2':'DA CONFIGURARE'}</Badge></div><p>Provider ammesso: <strong>OpenAI Immagini 2</strong>. Nessun generatore alternativo viene usato come fallback nascosto.</p>{local.health?.capabilities?.openaiImageModel&&<small>Modello server: {local.health.capabilities.openaiImageModel}</small>}</Card>
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
      const configured=providerConfigured(local.health?.capabilities,platform);
      return <Card key={platform}><div className="row-between"><div className="platform-icon">{platformLabels[platform].slice(0, 2).toUpperCase()}</div><Badge tone={connected?'good':configured?'info':'warn'}>{status}</Badge></div><h2>{platformLabels[platform]}</h2><p>{connected?'Connessione provider verificata.':configured?'Credenziali server rilevate; il collegamento account resta non disponibile finché OAuth reale non è completato.':'OAuth/credenziali provider non ancora configurati.'}</p><button type="button" className="button secondary" disabled={!connected}>{connected?'Gestisci account':configured?'OAuth account · non ancora disponibile':'Connetti · API da configurare'}</button></Card>;
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
  const c=local.health?.capabilities;
  const telegramLabel=telegram.status?.status==='connected'?'CONNESSO':telegram.status?.configured?String(telegram.status.status??'DISCONNESSO').toUpperCase():'DA CONFIGURARE';
  const state=(ready:boolean|undefined,readyLabel='CONFIGURATO'):[string,'good'|'warn']=>ready?[readyLabel,'good']:['DA CONFIGURARE','warn'];
  const [dbStatus,dbTone]=state(Boolean(c?.database)||Boolean(local.health?.testFixtures),'BACKEND COLLEGATO');
  const [openaiStatus,openaiTone]=state(Boolean(c?.openai),'OPERATIVO');
  const [imageStatus,imageTone]=state(Boolean(c?.openaiImages2),'OPENAI IMMAGINI 2');
  const [igStatus,igTone]=state(Boolean(c?.instagram),'CREDENZIALI SERVER PRESENTI');
  const [fbStatus,fbTone]=state(Boolean(c?.facebook),'CREDENZIALI SERVER PRESENTI');
  const [liStatus,liTone]=state(Boolean(c?.linkedin),'CREDENZIALI SERVER PRESENTI');
  const [gbpStatus,gbpTone]=state(Boolean(c?.googleBusinessProfile),'CREDENZIALI SERVER PRESENTI');
  const rows = [
    ['Persistenza dati', dbStatus, dbTone],
    ['OpenAI testi', openaiStatus, openaiTone],
    ['OpenAI Immagini 2', imageStatus, imageTone],
    ['Instagram / Meta', igStatus, igTone],
    ['Facebook / Meta', fbStatus, fbTone],
    ['LinkedIn', liStatus, liTone],
    ['Google Business Profile', gbpStatus, gbpTone],
    ['Telegram approvazioni', telegramLabel, telegram.status?.status==='connected'?'good':'warn'],
    ['Gate pubblicazione', local.health?.approval==='human-required'?'APPROVAZIONE UMANA OBBLIGATORIA':'DA VERIFICARE', local.health?.approval==='human-required'?'good':'warn'],
  ] as const;
  return <>
    <PageHeader eyebrow="Impostazioni" title="Stato del sistema" description="Qui viene mostrato ciò che il backend conferma davvero. Nessuna integrazione passa a ‘connessa’ senza una verifica reale." action={<button className="button secondary" onClick={()=>void local.refreshHealth()}>Aggiorna stato</button>} />
    <Card>{rows.map(([label, status, tone]) => <div className="signal-row" key={label}><span>{label}</span><Badge tone={tone}>{status}</Badge></div>)}</Card>
    <Card><h2>Attività attiva</h2><p><strong>{String(local.workspace?.tenant?.name ?? local.tenants.find((tenant) => tenant.id === local.tenantId)?.name ?? 'Nessuna attività')}</strong></p><p className="muted">Ogni attività mantiene separati brand, sito, strategia, contenuti, calendario, metriche e apprendimento.</p><Link className="button secondary" to="/onboarding?new=1">+ Crea nuova attività</Link></Card>
  </>;
}

function providerConfigured(capabilities:ReturnType<typeof useLocalE2E>['health'] extends infer _T ? any : never,platform:ApiPlatform){
  if(!capabilities)return false;
  if(platform==='google_business_profile')return Boolean(capabilities.googleBusinessProfile);
  return Boolean(capabilities[platform]);
}
