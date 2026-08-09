import { Badge, Card, PageHeader } from '../components/ui';

const notifications = [
  { id: 'n1', title: '3 contenuti richiedono approvazione', detail: 'La coda contiene varianti Instagram, Facebook e LinkedIn.', tone: 'info' as const, time: 'Adesso' },
  { id: 'n2', title: 'LinkedIn richiede riconnessione', detail: 'Il provider mock è in stato reauth_required e il publishing viene bloccato.', tone: 'warn' as const, time: '3 giorni fa' },
  { id: 'n3', title: 'Brand Profile al 92%', detail: 'Conferma tre campi inferiti per aumentare la qualità del contesto.', tone: 'good' as const, time: 'Oggi' },
];

export function NotificationsPage() {
  return <>
    <PageHeader eyebrow="Centro notifiche" title="Notifiche" description="Eventi utili e azionabili del tenant corrente. Dati interamente mock in questa fase." action={<button className="button secondary" type="button">Segna tutte lette · mock</button>} />
    <Card>
      <div className="list-table">
        {notifications.map((notification) => <article className="list-row" key={notification.id}>
          <Badge tone={notification.tone}>{notification.time}</Badge>
          <div className="grow"><strong>{notification.title}</strong><small>{notification.detail}</small></div>
          <button className="ghost-button" type="button">Apri</button>
        </article>)}
      </div>
    </Card>
  </>;
}
