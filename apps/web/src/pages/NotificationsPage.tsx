import { Badge, Card, PageHeader } from '../components/ui';
import { useSaasRepository, useSaasSnapshot } from '../services/SaasServicesProvider';

export function NotificationsPage() {
  const { notifications } = useSaasSnapshot();
  const repository = useSaasRepository();
  const unread = notifications.filter((notification) => !notification.read).length;

  return <>
    <PageHeader eyebrow="Centro notifiche" title="Notifiche" description={`Eventi utili e azionabili del tenant corrente. ${unread} non lette nel mock.`} action={<button className="button secondary" type="button" onClick={() => repository.markAllNotificationsRead()}>Segna tutte lette · mock</button>} />
    <Card>
      <div className="list-table">
        {notifications.map((notification) => <article className="list-row" key={notification.id}>
          <Badge tone={notification.read ? 'neutral' : notification.tone}>{notification.read ? 'Letta' : notification.time}</Badge>
          <div className="grow"><strong>{notification.title}</strong><small>{notification.detail}</small></div>
          <button className="ghost-button" type="button" onClick={() => repository.markNotificationRead(notification.id)}>{notification.read ? 'Letta' : 'Segna letta'}</button>
        </article>)}
      </div>
    </Card>
  </>;
}
