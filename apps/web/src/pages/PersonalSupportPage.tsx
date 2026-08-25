import { Badge, Card, PageHeader } from '../components/ui';

export function PersonalSupportPage(){
  return <>
    <PageHeader eyebrow="Supporto" title="Assistenza Post Automatici" description="Il chatbot interno verrà attivato soltanto quando OpenAI sarà configurato lato server. Non viene usato un assistente finto."/>
    <div className="two-col">
      <Card><h2>Assistente AI</h2><Badge tone="warn">DA CONFIGURARE</Badge><p>Richiede OpenAI lato server e accesso controllato al solo profilo attivo.</p><button className="button" disabled>Apri assistente</button></Card>
      <Card><h2>Diagnostica</h2><p>Per i problemi operativi usa le pagine <strong>Impostazioni</strong>, <strong>Social</strong> e <strong>Notifiche</strong>, che mostrano lo stato effettivo delle integrazioni.</p></Card>
    </div>
  </>;
}
