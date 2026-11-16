import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import "../legal.css";

/**
 * Public legal pages required by the Google/Meta/LinkedIn OAuth consent screens.
 * Facts only: owner data as published on iltuopropertymanager.it, data flows as implemented
 * in api/_lib (encrypted tokens, read-only verification, publication only after approval).
 */
const OWNER = "Alessandro Caruso – Il Tuo Property Manager";
const VAT = "P.IVA 14428100961";
const EMAIL = "info@iltuopropertymanager.it";
const UPDATED = "16 novembre 2026";

function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="legal-page">
      <article>
        <p className="legal-brand">Post Automatici</p>
        <h1>{title}</h1>
        <p className="legal-meta">Ultimo aggiornamento: {UPDATED}</p>
        {children}
        <nav className="legal-nav" aria-label="Documenti legali">
          <Link to="/privacy">Privacy</Link>
          <Link to="/termini">Termini di servizio</Link>
          <Link to="/login">Accedi</Link>
        </nav>
      </article>
    </main>
  );
}

export function PrivacyPage() {
  return (
    <LegalShell title="Informativa privacy">
      <h2>Titolare</h2>
      <p>{OWNER}, {VAT}. Contatto: <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.</p>

      <h2>Che cos'è Post Automatici</h2>
      <p>Post Automatici è lo strumento con cui il titolare prepara, approva e pubblica contenuti sui profili social della propria attività (Instagram, Facebook, LinkedIn e Google Business Profile). Non è un servizio offerto al pubblico.</p>

      <h2>Dati trattati</h2>
      <ul>
        <li><strong>Account:</strong> email e credenziali di accesso gestite dal sistema di autenticazione.</li>
        <li><strong>Attività e brand:</strong> nome, descrizione, contenuti del sito e materiali caricati dal titolare.</li>
        <li><strong>Collegamenti social:</strong> identificativi delle pagine e degli account collegati, permessi concessi e token di accesso. I token sono cifrati (AES-GCM) e leggibili solo dal server; il browser non può leggerli.</li>
        <li><strong>Dati dalle piattaforme:</strong> post pubblicati e metriche (copertura, interazioni, visualizzazioni) usati per misurare i risultati e migliorare i contenuti successivi.</li>
        <li><strong>Materiali di identità</strong> (foto, video e voce del titolare, solo se caricati): conservati in un archivio privato con consenso esplicito e revocabile.</li>
      </ul>

      <h2>Dati Google (Google Business Profile)</h2>
      <p>Con l'autorizzazione <code>business.manage</code> Post Automatici legge la scheda dell'attività, i post e le metriche, e pubblica post sulla scheda solo dopo l'approvazione del titolare. I dati ricevuti dalle API di Google sono usati esclusivamente per queste funzioni, non sono venduti né ceduti a terzi, non sono usati per pubblicità e non sono usati per addestrare modelli di intelligenza artificiale. L'uso rispetta la <a href="https://developers.google.com/terms/api-services-user-data-policy" rel="noreferrer">Google API Services User Data Policy</a>, compresi i requisiti di uso limitato (Limited Use).</p>

      <h2>Fornitori</h2>
      <p>Hosting e funzioni: Vercel (USA). Database: Neon (AWS, USA). Generazione dei testi e delle immagini: OpenAI (USA), che riceve solo i testi e i brief necessari, non i token social. I trasferimenti verso gli USA avvengono con le garanzie previste dai fornitori.</p>

      <h2>Conservazione e cancellazione</h2>
      <p>I dati restano finché il collegamento o l'account è attivo. Scollegando un social da Post Automatici il collegamento smette di essere usato; l'autorizzazione si può revocare anche dalle impostazioni di sicurezza del proprio account Google, Meta o LinkedIn. Per chiedere accesso, rettifica o cancellazione dei dati scrivi a <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.</p>

      <h2>Diritti</h2>
      <p>Puoi esercitare i diritti previsti dagli articoli 15–22 del GDPR e proporre reclamo al Garante per la protezione dei dati personali.</p>
    </LegalShell>
  );
}

export function TermsPage() {
  return (
    <LegalShell title="Termini di servizio">
      <h2>Servizio</h2>
      <p>Post Automatici è uno strumento interno di {OWNER} ({VAT}) per gestire i contenuti social della propria attività. L'accesso è riservato agli account autorizzati dal titolare.</p>
      <h2>Pubblicazioni</h2>
      <p>Nessun contenuto viene pubblicato senza un collegamento verificato e senza l'approvazione prevista. Il titolare resta responsabile dei contenuti pubblicati sui propri profili.</p>
      <h2>Piattaforme collegate</h2>
      <p>L'uso di Instagram, Facebook, LinkedIn e Google Business Profile è soggetto anche ai termini di ciascuna piattaforma. Le autorizzazioni possono essere revocate in qualsiasi momento.</p>
      <h2>Contatti</h2>
      <p><a href={`mailto:${EMAIL}`}>{EMAIL}</a></p>
    </LegalShell>
  );
}
