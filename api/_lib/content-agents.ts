import type { SocialFormat, SocialProvider } from "./openai-text.js";

export type ContentType = "SINGLE_POST" | "CAROUSEL" | "STORYTELLING" | "SINGLE_STORY";
export type AgentRole = "STRATEGIST" | "RESEARCHER" | "FACT_CHECKER" | "PLANNER" | "COPYWRITER" | "VISUAL_DIRECTOR" | "FORMAT_BUILDER" | "QA" | "PUBLISHER" | "ANALYST";
export type FunnelStage = "AWARENESS" | "CONSIDERATION" | "CONVERSION" | "RETENTION";
export type EditorialIntent = "EDUCATION" | "PROBLEM_SOLUTION" | "TIP" | "FAQ" | "CASE_STUDY" | "NEWS" | "SERVICE" | "COMMON_MISTAKE" | "CHECKLIST" | "SEASONAL";

export type AgentDefinition = {
  role: AgentRole;
  responsibility: string;
  mayUseOpenAI: boolean;
  mayUseWeb: boolean;
  blocksOnFailure: boolean;
};

export const CONTENT_AGENTS: readonly AgentDefinition[] = [
  { role: "STRATEGIST", responsibility: "Definisce obiettivo, pubblico, mix editoriale e vincoli del profilo tramite API OpenAI.", mayUseOpenAI: true, mayUseWeb: false, blocksOnFailure: true },
  { role: "RESEARCHER", responsibility: "Raccoglie solo informazioni pertinenti al settore e fonti tracciabili quando la modalità di ricerca lo consente.", mayUseOpenAI: true, mayUseWeb: true, blocksOnFailure: false },
  { role: "FACT_CHECKER", responsibility: "Controlla date, numeri, norme e affermazioni esterne; non trasforma fatti generali in claim del brand.", mayUseOpenAI: false, mayUseWeb: false, blocksOnFailure: true },
  { role: "PLANNER", responsibility: "Costruisce tramite API OpenAI il piano 2-4 settimane evitando ripetizioni e bilanciando intenti, social e formati.", mayUseOpenAI: true, mayUseWeb: false, blocksOnFailure: true },
  { role: "COPYWRITER", responsibility: "Scrive hook, caption e CTA partendo dal brief approvato senza cambiare strategia o inventare fatti.", mayUseOpenAI: true, mayUseWeb: false, blocksOnFailure: true },
  { role: "VISUAL_DIRECTOR", responsibility: "Trasforma identità visuale e brief in istruzioni coerenti per gpt-image-2.", mayUseOpenAI: false, mayUseWeb: false, blocksOnFailure: true },
  { role: "FORMAT_BUILDER", responsibility: "Adatta lo stesso concetto al formato nativo supportato dal social, incluse sequenze narrative e caroselli.", mayUseOpenAI: false, mayUseWeb: false, blocksOnFailure: true },
  { role: "QA", responsibility: "Blocca contenuti duplicati, incoerenti, non supportati o privi delle risorse obbligatorie.", mayUseOpenAI: false, mayUseWeb: false, blocksOnFailure: true },
  { role: "PUBLISHER", responsibility: "Pubblica solo attraverso integrazioni realmente collegate e con permessi validi.", mayUseOpenAI: false, mayUseWeb: false, blocksOnFailure: true },
  { role: "ANALYST", responsibility: "Legge metriche reali e produce segnali per il learning senza inventare performance.", mayUseOpenAI: false, mayUseWeb: false, blocksOnFailure: false },
] as const;

const INTENT_ROTATION: readonly EditorialIntent[] = [
  "EDUCATION", "PROBLEM_SOLUTION", "TIP", "FAQ", "CASE_STUDY", "NEWS", "SERVICE", "COMMON_MISTAKE", "CHECKLIST", "SEASONAL",
];

const TYPE_ROTATION: Record<SocialProvider, readonly ContentType[]> = {
  INSTAGRAM: ["SINGLE_POST", "CAROUSEL", "SINGLE_STORY", "STORYTELLING"],
  FACEBOOK: ["SINGLE_POST", "CAROUSEL", "STORYTELLING", "SINGLE_STORY"],
  LINKEDIN: ["SINGLE_POST", "CAROUSEL", "STORYTELLING"],
  GBP: ["SINGLE_POST"],
};

export function mapContentTypeToSocialFormat(provider: SocialProvider, type: ContentType): SocialFormat {
  if (provider === "GBP") return "POST";
  if (type === "SINGLE_STORY") return provider === "INSTAGRAM" || provider === "FACEBOOK" ? "STORY" : "POST";
  if (type === "CAROUSEL" || type === "STORYTELLING") return "CAROUSEL";
  return "POST";
}

export function chooseContentType(provider: SocialProvider, priorCount: number): ContentType {
  const rotation = TYPE_ROTATION[provider];
  return rotation[Math.max(0, priorCount) % rotation.length] ?? "SINGLE_POST";
}

export function chooseEditorialIntent(priorCount: number): EditorialIntent {
  return INTENT_ROTATION[Math.max(0, priorCount) % INTENT_ROTATION.length] ?? "EDUCATION";
}

export function seasonForMonth(month: number) {
  if ([12, 1, 2].includes(month)) return "INVERNO";
  if ([3, 4, 5].includes(month)) return "PRIMAVERA";
  if ([6, 7, 8].includes(month)) return "ESTATE";
  return "AUTUNNO";
}

export function ctaFor(stage: FunnelStage, provider: SocialProvider) {
  if (stage === "AWARENESS") return provider === "GBP" ? "Scopri di più" : "Salva o condividi se può esserti utile";
  if (stage === "CONSIDERATION") return "Approfondisci il tema o visita il sito";
  if (stage === "RETENTION") return "Condividi la tua esperienza o torna a consultare il contenuto";
  return "Richiedi informazioni o il prossimo passo disponibile";
}

export type EditorialPlanInput = {
  provider: SocialProvider;
  count: number;
  industry?: string | null;
  location?: string | null;
  serviceArea?: string | null;
  objective?: string | null;
  now?: Date;
  funnelStage?: FunnelStage;
};

export type EditorialPlan = {
  contentType: ContentType;
  nativeFormat: SocialFormat;
  intent: EditorialIntent;
  season: string;
  localization: string | null;
  cta: string;
  objective: string | null;
  agentSequence: AgentRole[];
  narrativeInstruction: string;
};

export function buildEditorialPlan(input: EditorialPlanInput): EditorialPlan {
  const type = chooseContentType(input.provider, input.count);
  const stage = input.funnelStage ?? (input.count % 4 === 3 ? "CONVERSION" : input.count % 4 === 2 ? "CONSIDERATION" : "AWARENESS");
  const localization = [input.location, input.serviceArea].filter((value): value is string => Boolean(value?.trim())).join(" / ") || null;
  const intent = chooseEditorialIntent(input.count);
  const nativeFormat = mapContentTypeToSocialFormat(input.provider, type);
  const narrativeInstruction = type === "STORYTELLING"
    ? "Costruisci una sequenza narrativa con apertura, tensione/problema, sviluppo utile e chiusura/CTA; ogni frame/slide deve avere una funzione distinta."
    : type === "CAROUSEL"
      ? "Costruisci un carosello con copertina forte, progressione slide per slide e CTA finale, evitando slide ridondanti."
      : type === "SINGLE_STORY"
        ? "Crea una singola storia immediata, leggibile rapidamente e con una sola idea/azione principale."
        : "Crea un singolo post autonomo con hook, valore centrale e CTA coerente.";
  return {
    contentType: type,
    nativeFormat,
    intent,
    season: seasonForMonth((input.now ?? new Date()).getMonth() + 1),
    localization,
    cta: ctaFor(stage, input.provider),
    objective: input.objective ?? null,
    agentSequence: CONTENT_AGENTS.map((agent) => agent.role),
    narrativeInstruction,
  };
}

export function buildOrchestratorInstruction(plan: EditorialPlan) {
  const locality = plan.localization ? `Se pertinente, contestualizza in modo naturale per ${plan.localization}; non forzare keyword locali.` : "Non inventare una località.";
  return [
    `PIPELINE AGENTI: ${plan.agentSequence.join(" -> ")}.`,
    `Tipo editoriale: ${plan.contentType}; formato social nativo: ${plan.nativeFormat}; intento: ${plan.intent}.`,
    `Stagionalità corrente: ${plan.season}. Usa la stagionalità solo quando è davvero pertinente al settore.`,
    locality,
    `CTA suggerita: ${plan.cta}.`,
    plan.narrativeInstruction,
    "Mantieni separati i compiti: ricerca raccoglie evidenze, copy scrive, visual definisce l'immagine, QA può bloccare. Non inventare integrazioni o metriche.",
  ].join(" ");
}
