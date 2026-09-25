import type { ContentType, EditorialIntent, FunnelStage } from "./content-agents.js";
import type { SocialFormat, SocialProvider } from "./openai-text.js";

export type ChannelEditorialDecision = { provider: SocialProvider; action: "USE" | "SKIP"; rationale: string };
export type MasterEditorialDecision = {
  id: string; createdAt: string; topic: string; angle: string; objective: string; audience: string | null;
  funnelStage: FunnelStage; pillar: string | null; contentType: ContentType; intent: EditorialIntent;
  rationale: string; urgency: "LOW" | "NORMAL" | "HIGH"; requiredSources: string[]; visualStrategy: string;
  selectedProvider: SocialProvider | null; channels: ChannelEditorialDecision[]; status: "READY" | "SKIP_PUBLICATION";
  skipReason?: string; retryCondition?: string; contentId?: string;
};

type Input = { id?: string; now?: string; topic: string; angle?: string; objective?: string | null; audience?: string | null; funnelStage: FunnelStage; pillar?: string | null; contentType: ContentType; intent: EditorialIntent; preferredProvider: SocialProvider; format: SocialFormat; localBusinessRelevance: boolean; professionalRelevance: boolean; hasVerifiableContext: boolean };
const providers: SocialProvider[] = ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"];

export function decideMasterEditorial(input: Input): MasterEditorialDecision {
  const topic = input.topic.trim();
  const sources = input.intent === "NEWS" ? ["Fonte esterna autorevole da verificare prima del copy"] : ["Sito e Brand Brain dell’attività"];
  if (!topic || !input.hasVerifiableContext) return { id: input.id ?? crypto.randomUUID(), createdAt: input.now ?? new Date().toISOString(), topic: topic || "Nessun tema verificabile", angle: input.angle ?? "", objective: input.objective?.trim() || "", audience: input.audience ?? null, funnelStage: input.funnelStage, pillar: input.pillar ?? null, contentType: input.contentType, intent: input.intent, rationale: "Manca un contesto verificabile sufficiente: il sistema non pubblica per riempire il calendario.", urgency: "LOW", requiredSources: sources, visualStrategy: "Nessuna generazione visuale", selectedProvider: null, channels: providers.map((provider) => ({ provider, action: "SKIP", rationale: "Contesto verificabile insufficiente." })), status: "SKIP_PUBLICATION", skipReason: "INSUFFICIENT_VERIFIABLE_CONTEXT", retryCondition: "Riprova dopo scansione del sito o aggiornamento del Brand Brain." };
  const channels = providers.map((provider): ChannelEditorialDecision => {
    if (provider === input.preferredProvider) return { provider, action: "USE", rationale: "Canale prioritario scelto dal piano editoriale per questo obiettivo e questa finestra." };
    if (provider === "INSTAGRAM") return { provider, action: "SKIP", rationale: "Tema non distribuito automaticamente: Instagram richiede una priorità visuale specifica, non una copia del contenuto." };
    if (provider === "FACEBOOK") return { provider, action: "SKIP", rationale: "Nessuna distribuzione duplicata: Facebook verrà scelto solo quando il tema richiede conversazione o contesto community." };
    if (provider === "LINKEDIN") return input.professionalRelevance ? { provider, action: "SKIP", rationale: "Tema potenzialmente professionale, ma non prioritario in questa decisione: evita una seconda pubblicazione non necessaria." } : { provider, action: "SKIP", rationale: "Il tema non ha una rilevanza professionale/business sufficiente." };
    return input.localBusinessRelevance ? { provider, action: "SKIP", rationale: "Tema rilevante localmente ma non prioritario: GBP riceve solo aggiornamenti business/locali dedicati." } : { provider, action: "SKIP", rationale: "Il tema non è direttamente utile alla ricerca locale o al cliente GBP." };
  });
  return { id: input.id ?? crypto.randomUUID(), createdAt: input.now ?? new Date().toISOString(), topic, angle: input.angle?.trim() || topic, objective: input.objective?.trim() || "Informare in modo utile il pubblico", audience: input.audience ?? null, funnelStage: input.funnelStage, pillar: input.pillar ?? null, contentType: input.contentType, intent: input.intent, rationale: `Il cervello editoriale sceglie ${input.preferredProvider} come unico canale prioritario: qualità e pertinenza prevalgono sul riempimento degli slot.`, urgency: input.intent === "NEWS" ? "HIGH" : "NORMAL", requiredSources: sources, visualStrategy: input.format === "STORY" ? "Visuale verticale 2:3, leggibile e coerente con il tema." : "Visuale coerente con il contenuto, prima cercata nel catalogo asset.", selectedProvider: input.preferredProvider, channels, status: "READY" };
}
