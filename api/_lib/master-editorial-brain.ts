import type { ContentType, EditorialIntent, FunnelStage } from "./content-agents.js";
import type { SocialFormat, SocialProvider } from "./openai-text.js";

export type ChannelEditorialDecision = { provider: SocialProvider; action: "USE" | "SKIP"; rationale: string };

export type MasterEditorialContextSnapshot = {
  profileType: "BUSINESS" | "PERSONAL_BRAND";
  personalBrand: boolean;
  brandSignalCount: number;
  sitePageCount: number;
  sourceCount: number;
  industry: string | null;
  goals: string[];
  audience: string[];
  pillars: string[];
  connectedProviders: SocialProvider[];
  recentContentCount: number;
  calendarScheduledCount: number;
  budget: {
    band: string;
    remainingEur: number;
    higgsfieldRemainingEur: number;
    otherAiRemainingEur: number;
  };
  relevantEvents: string[];
  analyticsSampleCount: number;
  learningSignalCount: number;
  reusableAssetCount: number;
};

export type MasterEditorialDecision = {
  id: string;
  createdAt: string;
  topic: string;
  angle: string;
  objective: string;
  audience: string | null;
  funnelStage: FunnelStage;
  pillar: string | null;
  contentType: ContentType;
  intent: EditorialIntent;
  rationale: string;
  urgency: "LOW" | "NORMAL" | "HIGH";
  requiredSources: string[];
  visualStrategy: string;
  selectedProvider: SocialProvider | null;
  channels: ChannelEditorialDecision[];
  status: "READY" | "SKIP_PUBLICATION";
  context: MasterEditorialContextSnapshot;
  contextSignals: string[];
  timing?: { scheduledAt: string; source: "USER_CONFIG" | "LEARNING" | "STRATEGY" | "DEFAULT" };
  skipReason?: string;
  retryCondition?: string;
  contentId?: string;
};

type Input = {
  id?: string;
  now?: string;
  topic: string;
  angle?: string;
  objective?: string | null;
  audience?: string | null;
  funnelStage: FunnelStage;
  pillar?: string | null;
  contentType: ContentType;
  intent: EditorialIntent;
  preferredProvider: SocialProvider;
  format: SocialFormat;
  localBusinessRelevance: boolean;
  professionalRelevance: boolean;
  hasVerifiableContext: boolean;
  context: MasterEditorialContextSnapshot;
};

const providers: SocialProvider[] = ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"];

function compactUnique(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function contextSignals(context: MasterEditorialContextSnapshot) {
  const providerText = context.connectedProviders.length ? context.connectedProviders.join(", ") : "nessuno";
  const evidenceText = context.learningSignalCount > 0
    ? `${context.learningSignalCount} segnali learning affidabili su ${context.analyticsSampleCount} snapshot analytics reali`
    : `${context.analyticsSampleCount} snapshot analytics reali, nessun learning affidabile applicabile`;
  const events = context.relevantEvents.length ? `eventi/trigger: ${context.relevantEvents.join(" | ")}` : "nessun evento/trigger specifico";
  return [
    `profilo=${context.profileType}${context.personalBrand ? " (Personal Brand)" : ""}`,
    `brandSignals=${context.brandSignalCount}; sitePages=${context.sitePageCount}; sources=${context.sourceCount}`,
    `settore=${context.industry ?? "non specificato"}; obiettivi=${context.goals.length}; audience=${context.audience.length}; pillars=${context.pillars.length}`,
    `social attivi=${providerText}`,
    `storico contenuti=${context.recentContentCount}; calendario futuro=${context.calendarScheduledCount}`,
    `budget=${context.budget.band}; residuo €${context.budget.remainingEur.toFixed(2)}; Higgsfield €${context.budget.higgsfieldRemainingEur.toFixed(2)}; Other AI €${context.budget.otherAiRemainingEur.toFixed(2)}`,
    evidenceText,
    `asset riusabili=${context.reusableAssetCount}; ${events}`,
  ];
}

function baseDecision(input: Input) {
  const topic = input.topic.trim();
  const effectiveObjective = input.objective?.trim() || input.context.goals[0] || "Informare in modo utile il pubblico";
  const effectiveAudience = input.audience?.trim() || input.context.audience[0] || null;
  const effectivePillar = input.pillar?.trim() || input.context.pillars[0] || null;
  const ownVerifiedSources = input.context.sourceCount > 0
    ? ["Sito, Brand Brain e fonti autorizzate del profilo"]
    : ["Brand Brain del profilo"];
  const sources = input.intent === "NEWS"
    ? ["Fonte esterna autorevole da verificare prima del copy", ...ownVerifiedSources]
    : ownVerifiedSources;
  return { topic, effectiveObjective, effectiveAudience, effectivePillar, sources, signals: contextSignals(input.context) };
}

function skip(input: Input, reason: string, rationale: string, retryCondition: string): MasterEditorialDecision {
  const base = baseDecision(input);
  return {
    id: input.id ?? crypto.randomUUID(),
    createdAt: input.now ?? new Date().toISOString(),
    topic: base.topic || "Nessun tema verificabile",
    angle: input.angle?.trim() || "",
    objective: base.effectiveObjective,
    audience: base.effectiveAudience,
    funnelStage: input.funnelStage,
    pillar: base.effectivePillar,
    contentType: input.contentType,
    intent: input.intent,
    rationale,
    urgency: "LOW",
    requiredSources: base.sources,
    visualStrategy: "Nessuna generazione visuale",
    selectedProvider: null,
    channels: providers.map((provider) => ({
      provider,
      action: "SKIP",
      rationale: provider === input.preferredProvider ? rationale : "Nessuna distribuzione perché la decisione centrale è bloccata.",
    })),
    status: "SKIP_PUBLICATION",
    context: input.context,
    contextSignals: base.signals,
    skipReason: reason,
    retryCondition,
  };
}

export function decideMasterEditorial(input: Input): MasterEditorialDecision {
  const base = baseDecision(input);
  if (!base.topic || !input.hasVerifiableContext || input.context.sourceCount <= 0) {
    return skip(
      input,
      "INSUFFICIENT_VERIFIABLE_CONTEXT",
      "Manca un contesto verificabile sufficiente: il sistema non pubblica per riempire il calendario.",
      "Riprova dopo scansione del sito, aggiornamento del Brand Brain o aggiunta di una fonte autorizzata.",
    );
  }

  if (input.context.budget.band === "HARD_STOP" || input.context.budget.remainingEur <= 0) {
    return skip(
      input,
      "AI_BUDGET_HARD_STOP",
      "Il budget AI del profilo è esaurito: nessuna nuova operazione billable viene autorizzata.",
      "Riprova nel nuovo periodo di budget o dopo una modifica esplicita della policy.",
    );
  }

  if (!input.context.connectedProviders.includes(input.preferredProvider)) {
    return skip(
      input,
      "PROVIDER_NOT_CONNECTED",
      `${input.preferredProvider} non è collegato e validato per questo profilo: la pubblicazione automatica resta bloccata.`,
      "Collega e valida il canale per questo profilo.",
    );
  }

  const channels = providers.map((provider): ChannelEditorialDecision => {
    if (!input.context.connectedProviders.includes(provider)) {
      return { provider, action: "SKIP", rationale: "Canale non collegato o non validato per questo profilo." };
    }
    if (provider === input.preferredProvider) {
      return { provider, action: "USE", rationale: "Canale prioritario scelto dal piano editoriale per questo obiettivo e questa finestra." };
    }
    if (provider === "INSTAGRAM") {
      return { provider, action: "SKIP", rationale: "Tema non distribuito automaticamente: Instagram richiede una priorità visuale specifica, non una copia del contenuto." };
    }
    if (provider === "FACEBOOK") {
      return { provider, action: "SKIP", rationale: "Nessuna distribuzione duplicata: Facebook verrà scelto solo quando il tema richiede conversazione o contesto community." };
    }
    if (provider === "LINKEDIN") {
      return input.professionalRelevance
        ? { provider, action: "SKIP", rationale: "Tema potenzialmente professionale, ma non prioritario in questa decisione: evita una seconda pubblicazione non necessaria." }
        : { provider, action: "SKIP", rationale: "Il tema non ha una rilevanza professionale/business sufficiente." };
    }
    return input.localBusinessRelevance
      ? { provider, action: "SKIP", rationale: "Tema rilevante localmente ma non prioritario: GBP riceve solo aggiornamenti business/locali dedicati." }
      : { provider, action: "SKIP", rationale: "Il tema non è direttamente utile alla ricerca locale o al cliente GBP." };
  });

  const learningApplied = input.context.learningSignalCount > 0 && input.context.analyticsSampleCount > 0;
  const eventTriggered = input.context.relevantEvents.length > 0 && (input.intent === "NEWS" || input.intent === "SEASONAL");
  const visualStrategy = input.context.reusableAssetCount > 0
    ? `Cerca prima tra i ${input.context.reusableAssetCount} asset riusabili del profilo; genera soltanto se nessuno è davvero adatto.`
    : input.context.personalBrand
      ? "Personal Brand identity-aware: usa routing visuale coerente con la persona e non inventare un volto se l’identità non è certificata."
      : input.format === "STORY"
        ? "Visuale verticale 2:3, leggibile e coerente con il tema."
        : "Visuale coerente con il contenuto, con generazione soltanto dopo ricerca nel catalogo asset.";

  const rationaleParts = compactUnique([
    `Il cervello editoriale sceglie ${input.preferredProvider} come unico canale prioritario per questo obiettivo.`,
    base.effectivePillar ? `Pilastro: ${base.effectivePillar}.` : null,
    learningApplied ? "Timing/formato possono usare learning affidabile derivato da metriche provider reali." : "Nessun learning forte viene forzato senza evidenza sufficiente.",
    input.context.recentContentCount > 0 ? "Lo storico recente viene considerato per evitare ripetizioni." : null,
    input.context.calendarScheduledCount > 0 ? "Il carico del calendario futuro è incluso nella decisione." : null,
    eventTriggered ? "La priorità aumenta per un evento/trigger rilevante già presente nel piano." : null,
  ]);

  return {
    id: input.id ?? crypto.randomUUID(),
    createdAt: input.now ?? new Date().toISOString(),
    topic: base.topic,
    angle: input.angle?.trim() || base.topic,
    objective: base.effectiveObjective,
    audience: base.effectiveAudience,
    funnelStage: input.funnelStage,
    pillar: base.effectivePillar,
    contentType: input.contentType,
    intent: input.intent,
    rationale: rationaleParts.join(" "),
    urgency: eventTriggered || input.intent === "NEWS" ? "HIGH" : "NORMAL",
    requiredSources: base.sources,
    visualStrategy,
    selectedProvider: input.preferredProvider,
    channels,
    status: "READY",
    context: input.context,
    contextSignals: base.signals,
  };
}
