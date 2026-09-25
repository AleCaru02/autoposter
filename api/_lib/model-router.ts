import type { ActivityBudgetSnapshot } from "./activity-budget.js";
import type { BrainTask, ContentImportance } from "./ai-brain-policy.js";

export type AiProvider = "OPENAI";
export type ProviderStatus = "READY" | "BLOCKED_PROVIDER";
export type RouteStatus = "READY" | "BLOCKED_PROVIDER" | "BLOCKED_BUDGET" | "REUSE_ASSET";

export type ModelDescriptor = {
  key: string;
  provider: AiProvider;
  requestedName: string;
  apiModelId: string | null;
  status: ProviderStatus;
  capability: "TEXT" | "IMAGE" | "SEARCH_GROUNDING" | "IMAGE_EDIT";
  note: string;
};

export const MODEL_REGISTRY = Object.freeze({
  GPT6_LUNA: {
    key: "GPT6_LUNA",
    provider: "OPENAI",
    requestedName: "GPT-6 Luna",
    apiModelId: null,
    status: "BLOCKED_PROVIDER",
    capability: "TEXT",
    note: "Nessun model ID GPT-6 Luna ufficiale verificato: non sostituire automaticamente con GPT-5.6 Luna.",
  },
  GPT6_SOL: {
    key: "GPT6_SOL",
    provider: "OPENAI",
    requestedName: "GPT-6 Sol",
    apiModelId: null,
    status: "BLOCKED_PROVIDER",
    capability: "TEXT",
    note: "Nessun model ID GPT-6 Sol ufficiale verificato: non sostituire automaticamente con GPT-5.6 Sol.",
  },
  GPT6_ASTRA: {
    key: "GPT6_ASTRA",
    provider: "OPENAI",
    requestedName: "GPT-6 Astra",
    apiModelId: null,
    status: "BLOCKED_PROVIDER",
    capability: "TEXT",
    note: "Nessun model ID GPT-6 Astra ufficiale verificato.",
  },
  OPENAI_TEXT_TERRA: {
    key: "OPENAI_TEXT_TERRA",
    provider: "OPENAI",
    requestedName: "GPT-5.6 Terra",
    apiModelId: "gpt-5.6-terra",
    status: "READY",
    capability: "TEXT",
    note: "Modello OpenAI configurabile per testo, ricerca, strategia e QA.",
  },
  OPENAI_IMAGE_2: {
    key: "OPENAI_IMAGE_2",
    provider: "OPENAI",
    requestedName: "OpenAI Images 2",
    apiModelId: "gpt-image-2",
    status: "READY",
    capability: "IMAGE",
    note: "Unico provider immagini ammesso per Post Automatici.",
  },
} satisfies Record<string, ModelDescriptor>);

export type RoutedModel = {
  status: RouteStatus;
  model: ModelDescriptor | null;
  reason: string;
};

export type RouterEnvironment = {
  OPENAI_API_KEY?: string;
};

function providerConfigured(model: ModelDescriptor, env: RouterEnvironment) {
  if (model.status !== "READY" || !model.apiModelId) return false;
  return Boolean(env.OPENAI_API_KEY);
}

function blocked(model: ModelDescriptor, reason?: string): RoutedModel {
  return { status: "BLOCKED_PROVIDER", model, reason: reason ?? model.note };
}

export function routeAiTask(input: {
  task: BrainTask;
  importance?: ContentImportance;
  budget: Pick<ActivityBudgetSnapshot, "band" | "forecastExceedsTarget" | "forecastRisksHardCap">;
  env: RouterEnvironment;
  reusableAssetAvailable?: boolean;
  difficultPhotoEditing?: boolean;
}): RoutedModel {
  const importance = input.importance ?? "STANDARD";
  if (input.reusableAssetAvailable && ["IMAGE_STANDARD", "IMAGE_PREMIUM"].includes(input.task)) {
    return { status: "REUSE_ASSET", model: null, reason: "Asset esistente riutilizzabile: nessuna nuova generazione necessaria." };
  }
  if (input.budget.band === "HARD_STOP") {
    return { status: "BLOCKED_BUDGET", model: null, reason: "Hard cap mensile dell'attività raggiunto." };
  }

  if (input.task === "IMAGE_STANDARD") {
    const model = MODEL_REGISTRY.OPENAI_IMAGE_2;
    return providerConfigured(model, input.env) ? { status: "READY", model, reason: "Visual standard: OpenAI Images 2." } : blocked(model, "OpenAI Images non configurato o modello non disponibile.");
  }

  if (input.task === "IMAGE_PREMIUM") {
    const model = MODEL_REGISTRY.OPENAI_IMAGE_2;
    return providerConfigured(model, input.env)
      ? { status: "READY", model, reason: importance === "PREMIUM" || importance === "CRITICAL" || input.difficultPhotoEditing ? "Visual premium giustificato: OpenAI Images 2." : "Visual standardizzato: OpenAI Images 2." }
      : blocked(model, "OpenAI Images non configurato o modello non disponibile.");
  }

  if (input.task === "RESEARCH" || input.task === "FACT_CHECK") {
    const model = MODEL_REGISTRY.OPENAI_TEXT_TERRA;
    return providerConfigured(model, input.env) ? { status: "READY", model, reason: "Ricerca e fact check con OpenAI e fonti verificabili." } : blocked(model, "OpenAI non configurato.");
  }

  const model = MODEL_REGISTRY.OPENAI_TEXT_TERRA;

  return providerConfigured(model, input.env) ? { status: "READY", model, reason: "Modello testuale richiesto disponibile." } : blocked(model);
}

export function providerReadiness(env: RouterEnvironment) {
  return Object.values(MODEL_REGISTRY).map((model) => ({
    ...model,
    runtimeConfigured: providerConfigured(model, env),
    runtimeStatus: providerConfigured(model, env) ? "READY" as const : "BLOCKED_PROVIDER" as const,
  }));
}
