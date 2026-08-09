import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { demoPosts, type Platform } from '../app/demo-data';
import { Badge, Card, PageHeader, Progress } from '../components/ui';
import './post-editor.css';

const platforms: Platform[] = ['Instagram', 'Facebook', 'LinkedIn', 'Google Business Profile'];

const variants: Record<Platform, { decision: 'native_variant' | 'separate_concept' | 'skip'; hook: string; caption: string; cta: string; reason: string }> = {
  Instagram: {
    decision: 'native_variant',
    hook: 'Tre segnali che ti aiutano a scegliere meglio',
    caption: 'Prima di scegliere un servizio, guarda metodo, trasparenza e capacità di misurare ciò che viene fatto. Demo Studio parte da questi tre elementi per costruire un piano comprensibile e verificabile.',
    cta: 'Salva il post e confronta questi criteri.',
    reason: 'Formato educativo breve adatto a feed e salvataggi.',
  },
  Facebook: {
    decision: 'native_variant',
    hook: 'Come capire se un servizio è davvero adatto a te?',
    caption: 'Non basta confrontare il prezzo. È utile capire cosa viene fatto, come viene misurato e quali responsabilità restano chiare. In questo esempio il concept viene reso più discorsivo per Facebook.',
    cta: 'Scrivici se vuoi chiarire i criteri da valutare.',
    reason: 'Stesso concept, copy più conversazionale e orientato alla discussione.',
  },
  LinkedIn: {
    decision: 'separate_concept',
    hook: 'Un buon servizio si valuta anche dalla qualità del processo',
    caption: 'Per un’azienda, scegliere un partner significa valutare governance, responsabilità, indicatori e qualità della comunicazione. Questa variante separa il concept consumer da una prospettiva professionale.',
    cta: 'Confronta il processo prima della promessa.',
    reason: 'Il concept originale era troppo consumer: LinkedIn riceve un angolo professionale distinto.',
  },
  'Google Business Profile': {
    decision: 'native_variant',
    hook: 'Consulenza professionale disponibile a Milano',
    caption: 'Demo Studio supporta attività e professionisti a Milano con un processo chiaro di analisi e pianificazione. Contenuto locale dimostrativo: nessuna pubblicazione reale è attiva.',
    cta: 'Contattaci',
    reason: 'Esiste una sede/località e il concept ha una CTA locale coerente.',
  },
};

export function PostEditorPage() {
  const { id = 'p1' } = useParams();
  const post = useMemo(() => demoPosts.find((item) => item.id === id) ?? demoPosts[0]!, [id]);
  const initialPlatform = platforms.includes(post.platform) ? post.platform : 'Instagram';
  const [platform, setPlatform] = useState<Platform>(initialPlatform);
  const variant = variants[platform];

  return <>
    <PageHeader
      eyebrow="Post editor · mock"
      title={post.title}
      description="Rivedi concept, adattamento per canale, qualità, fatti e rischio duplicazione prima dell’approvazione. Nessun pulsante pubblica realmente."
      action={<Link className="button secondary" to="/app/calendar">← Calendario</Link>}
    />

    <div className="editor-layout">
      <div className="stack">
        <Card>
          <div className="row-between">
            <div><span className="eyebrow">Core concept</span><h2>Valutare un servizio oltre il prezzo</h2></div>
            <Badge tone="good">Concept unico</Badge>
          </div>
          <div className="concept-grid">
            <ConceptField label="Obiettivo" value="Educazione + lead qualificati" />
            <ConceptField label="Pillar" value="Educazione" />
            <ConceptField label="Hook intent" value="Far emergere tre criteri concreti" />
            <ConceptField label="CTA intent" value="Portare l’utente al confronto consapevole" />
          </div>
        </Card>

        <Card>
          <div className="platform-tabs" role="tablist" aria-label="Varianti per canale">
            {platforms.map((item) => <button key={item} role="tab" aria-selected={platform === item} className={platform === item ? 'active' : ''} type="button" onClick={() => setPlatform(item)}>{item}</button>)}
          </div>
          <div className="variant-heading">
            <div><span className="eyebrow">Decisione canale</span><h2>{platform}</h2></div>
            <Badge tone={variant.decision === 'separate_concept' ? 'warn' : variant.decision === 'skip' ? 'neutral' : 'info'}>{variant.decision}</Badge>
          </div>
          <p className="decision-reason">{variant.reason}</p>
          <label className="editor-field"><span>Hook</span><textarea readOnly value={variant.hook} /></label>
          <label className="editor-field"><span>Caption</span><textarea className="large" readOnly value={variant.caption} /></label>
          <label className="editor-field"><span>CTA</span><input readOnly value={variant.cta} /></label>
          <div className="editor-actions"><button className="button secondary" type="button">Rigenera mock</button><button className="button secondary" type="button">Salva modifica mock</button></div>
        </Card>

        <Card>
          <span className="eyebrow">Visual direction</span><h2>Real asset first</h2>
          <div className="visual-brief"><div className="visual-placeholder">VISUAL<br/>PREVIEW</div><div><strong>Soggetto</strong><p>Persona che confronta tre criteri su una scheda chiara, ambiente professionale reale.</p><strong>Regole</strong><p>Usare asset reali se disponibili; niente volti sintetici se il Brand Profile richiede autenticità; palette brand rispettata.</p><Badge tone="good">Visual fit 0,88</Badge></div></div>
        </Card>
      </div>

      <aside className="stack editor-sidebar">
        <Card>
          <span className="eyebrow">Quality gate</span><h2>Pronto per approvazione</h2>
          <Score label="Brand match" value={95} /><Score label="Rilevanza" value={90} /><Score label="Chiarezza" value={90} /><Score label="Platform fit" value={88} /><Score label="Fact confidence" value={95} />
        </Card>
        <Card>
          <div className="row-between"><span className="eyebrow">Anti-duplicate</span><Badge tone="good">Basso</Badge></div>
          <h2>Rischio 0,10</h2>
          <Signal label="Exact" value="0,00" /><Signal label="Normalized" value="0,05" /><Signal label="Semantic" value="0,10" /><Signal label="Topic" value="0,10" /><Signal label="Hook" value="0,05" /><Signal label="Visual" value="0,05" />
          <p className="muted">Il controllo cross-tenant usa fingerprint/score server-side; la UI non riceve contenuti di altri tenant.</p>
        </Card>
        <Card>
          <span className="eyebrow">Fatti</span><h2>1 claim confermato</h2>
          <div className="fact-row"><Badge tone="good">Confermato</Badge><span>Sede: Milano</span></div>
          <p className="muted">Fonte: brand lock. Nessun claim sconosciuto viene presentato come fatto.</p>
        </Card>
        <Card>
          <span className="eyebrow">Decisione</span><h2>Approvazione manuale</h2>
          <div className="decision-buttons"><button className="button secondary" type="button">Rifiuta</button><button className="button" type="button">Approva mock</button></div>
          <button className="button full" type="button">Programma mock</button>
          <p className="muted">`SOCIAL_PUBLISHING_ENABLED=false`: nessuna azione può raggiungere un provider reale.</p>
        </Card>
      </aside>
    </div>
  </>;
}

function ConceptField({ label, value }: { label: string; value: string }) {
  return <div className="concept-field"><span>{label}</span><strong>{value}</strong></div>;
}

function Score({ label, value }: { label: string; value: number }) {
  return <Progress label={label} value={value} max={100} />;
}

function Signal({ label, value }: { label: string; value: string }) {
  return <div className="signal-row"><span>{label}</span><strong>{value}</strong></div>;
}
