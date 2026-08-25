import { Badge, Card, EmptyState, PageHeader } from '../components/ui';
import { useLocalE2E } from '../services/local-e2e';

export function NotificationsPage() {
  const local=useLocalE2E();
  const jobs=local.workspace?.jobs??[];
  const connections=local.workspace?.connections??[];
  const issues=[
    ...connections.filter((item:any)=>item.connection_status!=='connected').map((item:any)=>({id:`connection-${item.id}`,tone:'warn' as const,title:`${platformName(item.platform)} da controllare`,detail:connectionDetail(item.connection_status)})),
    ...jobs.filter((item:any)=>['failed','retry_wait'].includes(String(item.status))).map((item:any)=>({id:`job-${item.id}`,tone:'warn' as const,title:`Pubblicazione ${String(item.status).toUpperCase()}`,detail:String(item.last_error_message??item.last_error_code??'Controlla il job di pubblicazione.')})),
  ];
  return <>
    <PageHeader eyebrow="Centro notifiche" title="Notifiche operative" description="Mostra soltanto problemi o stati persistiti del profilo attivo. Nessuna notifica dimostrativa." />
    <Card>{issues.length===0?<EmptyState title="Nessuna notifica operativa" body="Non risultano errori di pubblicazione o connessioni problematiche tra quelle configurate."/>:<div className="list-table">{issues.map((item)=><article className="list-row" key={item.id}><Badge tone={item.tone}>ATTENZIONE</Badge><div className="grow"><strong>{item.title}</strong><small>{item.detail}</small></div></article>)}</div>}</Card>
  </>;
}

function platformName(value:unknown){return value==='google_business_profile'?'Google Business Profile':String(value??'').replace(/^./,(c)=>c.toUpperCase())}
function connectionDetail(value:unknown){const state=String(value??'').toLowerCase();if(state==='reauth_required'||state==='expired')return'È necessario ricollegare l’account prima della prossima pubblicazione.';if(state==='permission_error')return'Mancano permessi richiesti dal provider.';if(state==='disabled')return'Connessione disabilitata.';return`Stato provider: ${state||'non configurato'}.`;}
