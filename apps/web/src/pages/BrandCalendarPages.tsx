import { Link } from 'react-router';
import { Badge, Card, PageHeader } from '../components/ui';
import { useSaasSnapshot } from '../services/SaasServicesProvider';

export function BrandPage() {
  const { brandFields } = useSaasSnapshot();
  return <><PageHeader eyebrow="Brand intelligence" title="Brand Profile" description="Fonte compatta di verità per strategia, generazione e QA. I lock impediscono all’AI di reinterpretare fatti critici." action={<button className="button" type="button">Nuova versione</button>} /><div className="brand-grid">{brandFields.map((field) => <Card key={field.key}><div className="row-between"><span className="eyebrow">{field.label}</span><Badge tone={field.status === 'Inferito' ? 'warn' : field.status === 'Bloccato' ? 'neutral' : 'good'}>{field.status}</Badge></div><p className="brand-value">{field.value}</p><div className="card-actions"><button type="button">Modifica</button><button type="button">{field.locked ? 'Sblocca' : 'Blocca'}</button></div></Card>)}</div></>;
}

export function CalendarPage() {
  const { posts } = useSaasSnapshot();
  return <><PageHeader eyebrow="Piano editoriale" title="Calendario" description="Un concept può diventare una variante nativa, un concept separato o essere saltato su ogni canale." action={<button className="button" type="button">Genera settimana</button>} /><Card><div className="filter-row"><button className="filter active" type="button">Settimana</button><button className="filter" type="button">Mese</button><button className="filter" type="button">Lista</button><span className="grow" /><Badge>{posts.length} contenuti demo</Badge></div><div className="calendar-list">{posts.map((post) => <article className="calendar-row" key={post.id}><div className="date-chip large">{post.date}</div><div className="grow"><div className="row-between"><strong>{post.title}</strong><Badge tone={post.decision === 'skip' ? 'warn' : 'info'}>{post.decision}</Badge></div><div className="meta-line">{post.platform} · <span>{post.state}</span></div></div><Link className="ghost-button" to={`/app/posts/${post.id}`}>Apri</Link></article>)}</div></Card></>;
}
