import { Link } from 'react-router';
import { Card, Badge } from '../components/ui';

export function LandingPage() {
  return <div className="public-page">
    <header className="public-nav"><Link className="public-logo" to="/">SocialPilot AI</Link><nav><Link to="/pricing">Piani</Link><Link to="/app">Demo prodotto</Link><Link className="button small" to="/onboarding">Inizia onboarding</Link></nav></header>
    <main>
      <section className="hero"><Badge tone="info">AI social media manager con controllo umano</Badge><h1>Strategia, contenuti, approvazioni e pubblicazione in un unico sistema.</h1><p>Analizza il brand, pianifica il calendario editoriale, adatta ogni idea al canale corretto e misura ciò che funziona. La demo attuale usa esclusivamente dati e provider mock.</p><div className="hero-actions"><Link className="button" to="/app">Apri la demo</Link><Link className="button secondary" to="/pricing">Vedi i piani</Link></div></section>
      <section className="public-grid three"><Card><h3>Capisce il brand</h3><p>Website scan, Brand Profile, claim, target, tono e regole bloccabili.</p></Card><Card><h3>Decide per canale</h3><p>Instagram, Facebook, LinkedIn e Google Business Profile possono ricevere varianti native, concept separati o essere saltati.</p></Card><Card><h3>Automazione controllata</h3><p>Approval mode, quota, idempotenza, scheduler, error states e audit prima del publishing reale.</p></Card></section>
      <section className="section-band"><div><span className="eyebrow">Flusso</span><h2>Dal sito del cliente al post pubblicato.</h2></div><div className="steps-inline">{['Onboarding','Brand intelligence','Strategia','Concept','Adattamento canali','QA','Approvazione','Scheduling','Analytics'].map((step, i) => <span key={step}><b>{i + 1}</b>{step}</span>)}</div></section>
    </main>
    <details className="chat-widget"><summary>Assistente prodotto</summary><div><strong>Chatbot pubblico · mock</strong><p>Posso spiegare funzioni, onboarding, canali, sicurezza e piani. Non posso accedere ai dati tenant.</p><input aria-label="Domanda al chatbot" placeholder="Chiedi come funziona…" /></div></details>
  </div>;
}

export function PricingPage() {
  return <div className="public-page"><header className="public-nav"><Link className="public-logo" to="/">SocialPilot AI</Link><Link to="/">← Home</Link></header><main className="pricing-main"><div className="center-heading"><span className="eyebrow">Piani configurabili</span><h1>Parti piccolo, aumenta l’infrastruttura quando serve.</h1><p>Nessun checkout è attivo in questa fase. I valori sono fixture locali.</p></div><div className="public-grid three"><Plan name="Starter" price="€—" features={['1 brand','3 post/settimana','2 canali','Approvazione manuale']} /><Plan name="Growth" price="€—" featured features={['Più canali','Auto-publish configurabile','Analytics','Google Business Profile']} /><Plan name="Agency" price="€—" features={['Multi-brand','Team','Quote personalizzate','Controlli admin']} /></div></main></div>;
}

function Plan({ name, price, features, featured = false }: { name: string; price: string; features: string[]; featured?: boolean }) {
  return <Card className={featured ? 'featured-card' : ''}>{featured && <Badge tone="good">Più completo</Badge>}<h2>{name}</h2><div className="plan-price">{price}</div><ul className="feature-list">{features.map((feature) => <li key={feature}>{feature}</li>)}</ul><button className="button full" type="button">Non attivo in demo</button></Card>;
}
