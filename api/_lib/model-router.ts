import type { ActivityBudgetSnapshot } from "./activity-budget.js";
import type { BrainTask, ContentImportance } from "./ai-brain-policy.js";

export type AiProvider = "OPENAI" | "GOOGLE";
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
    apiModelId: "gpt-6-luna",
    status: "READY",
    capability: "TEXT",
    note: "Model ID ufficiale verificato nella documentazione OpenAI: gpt-6-luna.",
  },
  GPT6_SOL: {
    key: "GPT6_SOL",
    provider: "OPENAI",
    requestedName: "GPT-6 Sol",
    apiModelId: "gpt-6-sol",
    status: "READY",
    capability: "TEXT",
    note: "Model ID ufficiale verificato nella documentazione OpenAI: gpt-6-sol.",
  },
  GPT6_ASTRA: {
    key: "GPT6_ASTRA",
    provider: "OPENAI",
    requestedName: "GPT-6 Astra",
    apiModelId: "gpt-6-astra",
    status: "READY",
    capability: "TEXT",
    note: "Model ID ufficiale verificato nella documentazione OpenAI: gpt-6-astra.",
  },
  GEMINI_FLASH_IMAGE: {
    key: "GEMINI_FLASH_IMAGE",
    provider: "GOOGLE",
    requestedName: "Gemini 3.1 Flash Image",
    apiModelId: "gemini-3.1-flash-image",
    status: "READY",
    capability: "IMAGE",
    note: "Modello visual quotidiano verificato nella documentazione Gemini API.",
  },
  GEMINI_PRO_IMAGE: {
    key: "GEMINI_PRO_IMAGE",
    provider: "GOOGLE",
    requestedName: "Gemini 3 Pro Image",
    apiModelId: "gemini-3-pro-image",
    status: "READY",
    capability: "IMAGE",
    note: "Modello visual premium verificato nella documentazione Gemini API.",
  },
  GEMINI_GROUNDING: {
    key: "GEMINI_GROUNDING",
    provider: "GOOGLE",
    requestedName: "Gemini + Google Search Grounding",
    apiModelId: "gemini-3.8-flash",
    status: "READY",
    capability: "SEARCH_GROUNDING",
    note: "Gemini 3.8 Flash supporta Search grounding; usato come motore testuale grounded corrente.",
  },
  GPT_IMAGE_SUNBURST: {
    key: "GPT_IMAGE_SUNBURST",
    provider: "OPENAI",
    requestedName: "GPT-Image 2.5 Sunburst",
    apiModelId: "gpt-image-2.5-sunburst",
    status: "READY",
    capability: "IMAGE_EDIT",
    note: "Model ID ufficiale verificato nella documentazione OpenAI: gpt-image-2.5-sunburst.",
  },
} satisfies Record<string, ModelDescriptor>);

export type RoutedModel = {
  status: RouteStatus;
  model: ModelDescriptor | null;
  reason: string;
};

export type RouterEnvironment = {
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
};

function providerConfigured(model: ModelDescriptor, env: RouterEnvironment) {
  if (model.status !== "READY" || !model.apiModelId) return false;
  return model.provider === "OPENAI" ? Boolean(env.OPENAI_API_KEY) : Boolean(env.GEMINI_API_KEY);
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
    const model = MODEL_REGISTRY.GEMINI_FLASH_IMAGE;
    return providerConfigured(model, input.env) ? { status: "READY", model, reason: "Visual standard: Flash." } : blocked(model, "Gemini API non configurata o modello non disponibile.");
  }

  if (input.task === "IMAGE_PREMIUM") {
    if (input.difficultPhotoEditing) {
      const editor = MODEL_REGISTRY.GPT_IMAGE_SUNBURST;
      return providerConfigured(editor, input.env) ? { status: "READY", model: editor, reason: "Editing fotografico complesso." } : blocked(editor);
    }
    const budgetProtectsPremium = input.budget.forecastExceedsTarget
      || ["RESERVE", "PROTECTED_RESERVE", "EMERGENCY_ONLY"].includes(input.budget.band);
    const premiumJustified = importance === "PREMIUM" || importance === "CRITICAL";
    const model = budgetProtectsPremium && !premiumJustified ? MODEL_REGISTRY.GEMINI_FLASH_IMAGE : MODEL_REGISTRY.GEMINI_PRO_IMAGE;
    return providerConfigured(model, input.env)
      ? { status: "READY", model, reason: model === MODEL_REGISTRY.GEMINI_PRO_IMAGE ? "Premium giustificato." : "Budget protetto: Flash sufficiente." }
      : blocked(model, "Gemini API non configurata o modello non disponibile.");
  }

  if (input.task === "RESEARCH" || input.task === "FACT_CHECK") {
    const model = MODEL_REGISTRY.GEMINI_GROUNDING;
    return providerConfigured(model, input.env) ? { status: "READY", model, reason: "Ricerca con Google Search Grounding." } : blocked(model, "Gemini API/grounding non configurata.");
  }

  const model = input.task === "STRATEGY_COMPLEX"
    ? MODEL_REGISTRY.GPT6_ASTRA
    : ["STRATEGY", "COPY_FINAL", "CAROUSEL_STRUCTURE", "EDITORIAL_QA"].includes(input.task)
      ? MODEL_REGISTRY.GPT6_SOL
      : MODEL_REGISTRY.GPT6_LUNA;

  return providerConfigured(model, input.env) ? { status: "READY", model, reason: "Modello testuale richiesto disponibile." } : blocked(model);
}

export function providerReadiness(env: RouterEnvironment) {
  return Object.values(MODEL_REGISTRY).map((model) => ({
    ...model,
    runtimeConfigured: providerConfigured(model, env),
    runtimeStatus: providerConfigured(model, env) ? "READY" as const : "BLOCKED_PROVIDER" as const,
  }));
}
