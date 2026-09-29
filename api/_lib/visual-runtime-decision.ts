import type { VisualRoutingDecision, SoulIdentityState } from "./visual-provider-routing.js";
import { routeVisualProvider } from "./visual-provider-routing.js";

export type PersistedVisualDecision = VisualRoutingDecision & {
  model: string | null;
  estimatedCostEur: number;
  identityQaStatus: "NOT_REQUIRED" | "PENDING";
};

export function visualIntentFromBrief(brief: string) {
  const value = brief.normalize("NFKC").toLowerCase();
  const personIsPrimarySubject = /\b(persona|volto|ritratto|portrait|woman|man|uomo|donna|persona protagonista|personal brand|founder|consulente|professionista)\b/i.test(value);
  const requiresIdentityConsistency = /\b(stessa persona|identità|identity|coerenza|riconoscibile|somiglianza|face|volto)\b/i.test(value);
  const virtualShoot = /\b(shooting|photoshoot|servizio fotografico|editorial portrait|virtual shoot)\b/i.test(value);
  const requiresNewScene = /\b(scena|ambientazione|location|ufficio|studio|evento|città|outdoor|indoor)\b/i.test(value);
  return { personIsPrimarySubject, requiresIdentityConsistency, virtualShoot, requiresNewScene };
}

export function decideVisualRuntime(input: {
  profileType: "BUSINESS" | "PERSONAL_BRAND";
  visualBrief: string;
  suitableRealAssetAvailable: boolean;
  higgsfieldConfigured: boolean;
  soulIdentityState: SoulIdentityState;
  higgsfieldBudgetRemainingEur: number;
  estimatedHiggsfieldCostEur: number;
  estimatedOpenAiCostEur: number;
}): PersistedVisualDecision {
  const intent = visualIntentFromBrief(input.visualBrief);
  const decision = routeVisualProvider({
    profileType: input.profileType,
    suitableRealAssetAvailable: input.suitableRealAssetAvailable,
    personIsPrimarySubject: intent.personIsPrimarySubject,
    requiresIdentityConsistency: intent.requiresIdentityConsistency,
    requiresNewScene: intent.requiresNewScene,
    virtualShoot: intent.virtualShoot,
    higgsfieldConfigured: input.higgsfieldConfigured,
    soulIdentityState: input.soulIdentityState,
    higgsfieldBudgetRemainingEur: input.higgsfieldBudgetRemainingEur,
    estimatedHiggsfieldCostEur: input.estimatedHiggsfieldCostEur,
  });
  const model = decision.provider === "OPENAI"
    ? "gpt-image-2"
    : decision.provider === "HIGGSFIELD"
      ? "soul_2"
      : null;
  const estimatedCostEur = decision.provider === "HIGGSFIELD"
    ? Math.max(0,input.estimatedHiggsfieldCostEur)
    : decision.provider === "OPENAI"
      ? Math.max(0,input.estimatedOpenAiCostEur)
      : 0;
  return {
    ...decision,
    model,
    estimatedCostEur,
    identityQaStatus: decision.requiresIdentityQa ? "PENDING" : "NOT_REQUIRED",
  };
}
