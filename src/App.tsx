import { AlertTriangle, CheckCircle2, Database, GitBranch, Smartphone } from "lucide-react";
import { PRODUCT, SOCIALS } from "./lib/product";

const gates = [
  ["GitHub fonte unica", "IN CORSO"],
  ["Vercel allineato", "DA VERIFICARE"],
  ["PostgreSQL", "DA CONFIGURARE"],
  ["Autenticazione", "DA CONFIGURARE"],
  ["Profili indipendenti", "DA CONFIGURARE"],
  ["OpenAI", "DA CONFIGURARE"],
  ["Social reali", "DA CONFIGURARE"],
] as const;

export default function App() {
  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">{PRODUCT.phase}</p>
          <h1>{PRODUCT.name}</h1>
        </div>
        <span className="badge warning"><AlertTriangle size={15} /> Setup tecnico in corso</span>
      </header>

      <section className="hero card">
        <div>
          <p className="eyebrow">Dashboard tecnica</p>
          <h2>Una sola fonte di verità, nessuna funzione finta.</h2>
          <p>Questa build mostra solo capability realmente collegate. API, metriche e pubblicazioni non configurate restano esplicitamente indisponibili.</p>
        </div>
        <GitBranch size={54} />
      </section>

      <section className="grid">
        <article className="card">
          <Database size={22} />
          <h3>Stato infrastruttura</h3>
          <div className="status-list">
            {gates.map(([name, state]) => (
              <div className="status-row" key={name}>
                <span>{name}</span>
                <strong className={state === "IN CORSO" ? "amber" : "muted"}>{state}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="card">
          <CheckCircle2 size={22} />
          <h3>Social previsti</h3>
          <p>Nessun account viene mostrato come connesso finché OAuth non è verificato.</p>
          <div className="chips">
            {SOCIALS.map((social) => <span className="chip" key={social}>{social} · da configurare</span>)}
          </div>
        </article>

        <article className="card">
          <Smartphone size={22} />
          <h3>QA finale</h3>
          <p>Il test iPhone e desktop verrà eseguito solo dopo il completamento dei gate funzionali, prima della consegna del link candidato.</p>
        </article>
      </section>
    </main>
  );
}
