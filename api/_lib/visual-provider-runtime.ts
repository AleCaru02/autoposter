import {
  inferVisualIdentityRequirements,
  routeVisualProvider,
  safeVisualBriefForDecision,
  type ProfileVisualType,
  type SoulIdentityState,
  type VisualRoutingDecision,
} from "./visual-provider-routing.js";
import { higgsfieldConfigured } from "./higgsfield.js";

export type VisualProviderRuntimeResult = {
  decision: VisualRoutingDecision;
  safeVisualBrief: string;
  soulIdentityState: SoulIdentityState;
  requirements: ReturnType<typeof inferVisualIdentityRequirements>;
};

type SqlLike = any;

export async function resolveVisualProviderRuntime(input: {
  sql: SqlLike;
  profileId: string;
  profileType: ProfileVisualType;
  profileName: string;
  visualBrief: string;
  suitableRealAssetAvailable: boolean;
  hfCredentials?: string;
  higgsfieldBudgetRemainingEur: number;
  estimatedHiggsfieldCostEur: number;
}): Promise<VisualProviderRuntimeResult> {
  let soulIdentityState: SoulIdentityState = "NOT_CONFIGURED";
  if (input.profileType === "PERSONAL_BRAND") {
    const rows = await input.sql`
      select status
      from public.personal_brand_visual_identities
      where profile_id=${input.profileId}::uuid
      limit 1
    ` as unknown as Array<{ status: SoulIdentityState }>;
    soulIdentityState = rows[0]?.status ?? "NOT_CONFIGURED";
  }

  const requirements = inferVisualIdentityRequirements({
    profileType: input.profileType,
    profileName: input.profileName,
    visualBrief: input.visualBrief,
  });

  const decision = routeVisualProvider({
    profileType: input.profileType,
    suitableRealAssetAvailable: input.suitableRealAssetAvailable,
    ...requirements,
    higgsfieldConfigured: higgsfieldConfigured(input.hfCredentials),
    soulIdentityState,
    higgsfieldBudgetRemainingEur: input.higgsfieldBudgetRemainingEur,
    estimatedHiggsfieldCostEur: input.estimatedHiggsfieldCostEur,
  });

  return {
    decision,
    safeVisualBrief: safeVisualBriefForDecision(decision, input.visualBrief),
    soulIdentityState,
    requirements,
  };
}

export function visualDecisionPersistence(input: {
  decision: VisualRoutingDecision;
  model?: string | null;
  estimatedCostEur?: number | null;
  actualCostEur?: number | null;
}) {
  return {
    visual_provider: input.decision.provider,
    visual_model: input.model ?? null,
    visual_decision_reason: input.decision.reasonCode,
    visual_estimated_cost_eur: input.estimatedCostEur ?? 0,
    visual_actual_cost_eur: input.actualCostEur ?? null,
    identity_qa_status: input.decision.requiresIdentityQa ? "PENDING" : "NOT_REQUIRED",
  } as const;
}
