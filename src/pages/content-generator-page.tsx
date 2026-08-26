import { useState, type FormEvent } from "react";
import { Bot, ShieldCheck, Sparkles } from "lucide-react";
import { authClient } from "../lib/neon-client";
import { useProfiles } from "../features/profiles/profile-context";
import type { GeneratedSocialContent, OpenAITextUsage, SocialFormat, SocialProvider } from "../../api/_lib/openai-text";

type JwtAuth = { getJWTToken?: () => Promise<string | null> };
type Budget = { monthlyUsd: number; spentUsd: number; remainingUsd?: number; estimatedNextMaxUsd?: number };

const PROVIDERS: Array<{ value: SocialProvider; label: string }> = [
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "FACEBOOK", label: "Facebook" },
  { value: "LINKEDIN", label: "LinkedIn" },
  { value: "GBP", label: "Google Business Profile" },
];
const FORMATS: Array<{ value: SocialFormat; label: string }> = [
  { value: "POST", label: "Post" },
  { value: "CAROUSEL", label: "Carosello" },
  { value: "STORY", label: "Storia" },
];

function usd(value: number | null | undefined) {
  return typeof value === "number" ? `$${value.toFixed(value < 0.01 ? 4 : 2)}` : "—";
}

export function ContentGeneratorPage() {
  const { selectedProfile } = useProfiles();
  const [topic, setTopic] = useState("");
  const [objective, setObjective] = useState("");
  const [providers, setProviders] = useState<SocialProvider[]>(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"]);
  const [format, setFormat] = useState<SocialFormat>("POST");
  const [result, setResult] = useState<GeneratedSocialContent | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [usage, setUsage] = useState<OpenAITextUsage | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleProvider(provider: SocialProvider) {
    setProviders((current) => current.includes(provider) ? current.filter((item) => item !== provider) : [...current, provider]);
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!selectedProfile?.id || !providers.length) return;
    setBusy(true); setError(null); setResult(null); setModel(null); setUsage(null);
    try {
      const token = await (authClient as typeof authClient & JwtAuth).getJWTToken?.();
      if (!token) throw new Error("Sessione non valida: effettua nuovamente l’accesso.");
      const response = await fetch("/api/generate-text", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ profileId: selectedProfile.id, topic, objective: objective || null, providers, formats: [format] }) });
      const body = await response.json() as { content?: GeneratedSocialContent; model?: string; usage?: OpenAITextUsage; budget?: Budget; error?: string; message?: string; detail?: string };
      if (body.budget) setBudget(body.budget);
      if (!response.ok) {
        if (body.error === "OPENAI_NOT_CONFIGURED") throw new Error("OpenAI non è ancora configurato sul server: manca OPENAI_API_KEY.");
        if (body.error === "OPENAI_TEXT_BUDGET_REACHED") throw new Error(`Budget mensile testi raggiunto. Spesi ${usd(body.budget?.spentUsd)} su ${usd(body.budget?.monthlyUsd)}. Nessuna chiamata OpenAI è stata eseguita.`);
        throw new Error(body.detail || body.message || body.error || "Generazione non riuscita.");
      }
      if (!body.content) throw new Error("OpenAI non ha restituito contenuto utilizzabile.");
      setResult(body.content); setModel(body.model ?? null); setUsage(body.usage ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Generazione non riuscita.");
    } finally { setBusy(false); }
  }

  if (!selectedProfile) return null;
  return <div className="page-content"><header className="page-header"><div><p className="eyebrow">Contenuti · {selectedProfile.name}</p><h1>Genera testo con OpenAI</h1><p>Qualità finale con GPT-5.6 Terra. Il risparmio deriva da contesto rilevante, una sola chiamata multi-social e budget rigido, non da un modello più debole.</p></div></header><section className="cost-guard"><ShieldCheck size={19} /><div><strong>Protezione costi attiva</strong><p>Budget testi predefinito: massimo $5 al mese complessivi. Se la prossima richiesta può superarlo, viene bloccata prima di chiamare OpenAI.</p>{budget && <small>Questo mese: {usd(budget.spentUsd)} / {usd(budget.monthlyUsd)}{typeof budget.remainingUsd === "number" ? ` · residuo ${usd(budget.remainingUsd)}` : ""}</small>}</div></section><form className="panel generator-form" onSubmit={generate}><div className="form-grid"><label className="full">Argomento o idea<textarea required rows={4} placeholder="Es. Perché affidare un immobile a un property manager" value={topic} onChange={(event) => setTopic(event.target.value)} /></label><label className="full">Obiettivo opzionale<input placeholder="Es. lead, notorietà, prenotazioni" value={objective} onChange={(event) => setObjective(event.target.value)} /></label></div><fieldset className="choice-fieldset"><legend>Piattaforme</legend><div className="choice-grid">{PROVIDERS.map((provider) => <label className={`choice-chip ${providers.includes(provider.value) ? "selected" : ""}`} key={provider.value}><input type="checkbox" checked={providers.includes(provider.value)} onChange={() => toggleProvider(provider.value)} />{provider.label}</label>)}</div></fieldset><fieldset className="choice-fieldset"><legend>Formato</legend><div className="choice-grid compact">{FORMATS.map((item) => <label className={`choice-chip ${format === item.value ? "selected" : ""}`} key={item.value}><input type="radio" name="format" value={item.value} checked={format === item.value} onChange={() => setFormat(item.value)} />{item.label}</label>)}</div></fieldset>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy || !providers.length} type="submit"><Sparkles size={16} /> {busy ? "OpenAI sta generando…" : "Genera bozze"}</button><p className="generator-note">Una richiesta genera insieme tutte le piattaforme selezionate. Nessuna chiamata automatica parte in background.</p></form>{result && <section className="generation-results"><div className="generation-summary"><Bot size={20} /><div><strong>{result.strategySummary}</strong><small>{model ? `Modello: ${model}` : "OpenAI"}{usage?.estimatedCostUsd != null ? ` · costo stimato reale richiesta ${usd(usage.estimatedCostUsd)}` : ""}</small></div></div>{result.variants.map((variant, index) => <article className="generated-card" key={`${variant.provider}-${variant.format}-${index}`}><header><div><span>{variant.provider}</span><strong>{variant.format}</strong></div><em className={variant.eligible ? "eligible" : "not-eligible"}>{variant.eligible ? "Idoneo" : "Non idoneo"}</em></header><h2>{variant.hook}</h2><p className="generated-caption">{variant.caption}</p>{variant.cta && <p><strong>CTA:</strong> {variant.cta}</p>}{variant.hashtags.length > 0 && <p className="hashtags">{variant.hashtags.join(" ")}</p>}<details><summary>Visual e base fattuale</summary><p><strong>Visual:</strong> {variant.visualBrief}</p><p><strong>Alt text:</strong> {variant.altText}</p><ul>{variant.factualBasis.map((fact) => <li key={fact}>{fact}</li>)}</ul></details></article>)}</section>}</div>;
}
