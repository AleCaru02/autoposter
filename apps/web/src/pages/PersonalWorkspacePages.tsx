import { useState } from 'react';
import { Link } from 'react-router';
import { Badge, Card, EmptyState, PageHeader } from '../components/ui';
import { useLocalE2E, type ApiPlatform } from '../services/local-e2e';

const platformLabels: Record<ApiPlatform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  google_business_profile: 'Google Business Profile',
};

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
    <Card><span className="eyebrow">Stato servizio</span><h2>{local.enabled ? 'Crawler disponibile nell’ambiente locale' : 'Servizio server da configurare online'}</h2><p className="muted">Il browser da solo non può garantire un crawling completo a causa di CORS, robots e limiti di rete. Per questo Post Automatici non simula la scansione lato client.</p></Card>
  </>;
}

export function ContentsPage() {
  const local = useLocalE2E();
  const posts = local.workspace?.posts ?? [];
  return <>
    <PageHeader eyebrow="Contenuti" title="Contenuti dell’attività attiva" description="Ogni contenuto appartiene soltanto al profilo selezionato. Generazione OpenAI e immagini restano disabilitate finché il servizio server non è configurato." action={<button type="button" className="button" disabled title="OpenAI da configurare">Genera con OpenAI · Da configurare</button>} />
    <Card>
      {posts.length === 0 ? <EmptyState title="Nessun contenuto reale" body="Non vengono inseriti post dimostrativi nella modalità personale. Configura strategia e generazione quando OpenAI sarà collegato." /> : <div className="stack">{posts.map((post: any) => {
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
  return <>
    <PageHeader eyebrow="Social" title="Connessioni reali" description="Una connessione diventa operativa solo dopo OAuth, permessi e account verificati. Le fixture locali non vengono presentate come account live." />
    <div className="connection-grid">{platforms.map((platform) => {
      const connection = connections.find((item: any) => item.platform === platform) as any;
      const isFixture = local.enabled;
      const status = isFixture && connection ? 'SIMULAZIONE LOCALE' : 'DA CONFIGURARE';
      return <Card key={platform}><div className="row-between"><div className="platform-icon">{platformLabels[platform].slice(0, 2).toUpperCase()}</div><Badge tone="warn">{status}</Badge></div><h2>{platformLabels[platform]}</h2><p>{connection && isFixture ? `Fixture presente · modalità ${String(connection.approval_mode ?? 'manual').toUpperCase()}` : 'OAuth/credenziali provider non collegati nell’ambiente personale online.'}</p><button type="button" className="button secondary" disabled>Connetti · API da configurare</button></Card>;
    })}</div>
    <Card><h2>Gate di pubblicazione</h2><p>Nessun contenuto può essere marcato come pubblicato da una semplice azione locale. Gli stati PUBLISHING, PUBLISHED e FAILED devono arrivare da un adapter provider reale.</p><Badge tone="warn">PUBBLICAZIONE LIVE DISABILITATA</Badge></Card>
  </>;
}

export function PersonalSettingsPage() {
  const local = useLocalE2E();
  const rows = [
    ['Persistenza dati', local.enabled ? 'LOCALE ATTIVA' : 'BACKEND REMOTO DA CONFIGURARE', local.enabled ? 'good' : 'warn'],
    ['OpenAI testi', 'DA CONFIGURARE', 'warn'],
    ['OpenAI Immagini 2', 'DA CONFIGURARE', 'warn'],
    ['Instagram / Meta', 'DA CONFIGURARE', 'warn'],
    ['Facebook / Meta', 'DA CONFIGURARE', 'warn'],
    ['LinkedIn', 'DA CONFIGURARE', 'warn'],
    ['Google Business Profile', 'DA CONFIGURARE', 'warn'],
    ['GitHub / Vercel deploy', 'DA VERIFICARE NELL’AMBIENTE', 'info'],
  ] as const;
  return <>
    <PageHeader eyebrow="Impostazioni" title="Stato reale del sistema" description="Qui viene mostrato ciò che è davvero disponibile. Nessuna integrazione passa a ‘connessa’ senza una verifica reale." />
    <Card>{rows.map(([label, status, tone]) => <div className="signal-row" key={label}><span>{label}</span><Badge tone={tone}>{status}</Badge></div>)}</Card>
    <Card><h2>Attività attiva</h2><p><strong>{String(local.workspace?.tenant?.name ?? local.tenants.find((tenant) => tenant.id === local.tenantId)?.name ?? 'Nessuna attività')}</strong></p><p className="muted">Ogni attività mantiene separati brand, sito, strategia, contenuti, calendario, metriche e apprendimento.</p><Link className="button secondary" to="/onboarding?new=1">+ Crea nuova attività</Link></Card>
  </>;
}
