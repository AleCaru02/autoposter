import { brandSections, demoPosts } from '../app/demo-data';
import { Badge, Card, PageHeader } from '../components/ui';

export function BrandPage() {
  return <><PageHeader eyebrow="Brand intelligence" title="Brand Profile" description="Fonte compatta di verità per strategia, generazione e QA. I lock impediscono all’AI di reinterpretare fatti critici." action={<button className="button" type="button">Nuova versione</button>} /><div className="brand-grid">{brandSections.map(([label, value, status]) => <Card key={label}><div className="row-between"><span className="eyebrow">{label}</span><Badge tone={status === 'Inferito' ? 'warn' : status === 'Bloccato' ? 'neutral' : 'good'}>{status}</Badge></div><p className="brand-value">{value}</p><div className="card-actions"><button type="button">Modifica</button><button type="button">Blocca</button></div></Card>)}</div></>;
}

export function CalendarPage() {
  return <><PageHeader eyebrow="Piano editoriale" title="Calendario" description="Un concept può diventare una variante nativa, un concept separato o essere saltato su ogni canale." action={<button className="button" type="button">Genera settimana</button>} /><Card><div className="filter-row"><button className="filter active" type="button">Settimana</button><button className="filter" type="button">Mese</button><button className="filter" type="button">Lista</button><span className="grow" /><Badge>8 contenuti demo</Badge></div><div className="calendar-list">{demoPosts.map((post) => <article className="calendar-row" key={post.id}><div className="date-chip large">{post.date}</div><div className="grow"><div className="row-between"><strong>{post.title}</strong><Badge tone={post.decision === 'skip' ? 'warn' : 'info'}>{post.decision}</Badge></div><div className="meta-line">{post.platform} · <span>{post.state}</span></div></div><button className="ghost-button" type="button">Apri</button></article>)}</div></Card></>;
}
