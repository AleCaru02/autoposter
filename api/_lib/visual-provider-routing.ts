export type VisualProvider = "REAL_ASSET" | "OPENAI" | "HIGGSFIELD";
export type ProfileVisualType = "BUSINESS" | "PERSONAL_BRAND";
export type SoulIdentityState =
  | "NOT_CONFIGURED"
  | "REFERENCES_PENDING"
  | "READY_TO_CREATE"
  | "CREATING"
  | "COMPLETED"
  | "FAILED";

export type VisualRoutingReasonCode =
  | "REUSE_SUITABLE_REAL_ASSET"
  | "PERSONAL_BRAND_IDENTITY_REQUIRES_HIGGSFIELD"
  | "HIGGSFIELD_NOT_CONFIGURED"
  | "SOUL_ID_NOT_READY"
  | "HIGGSFIELD_BUDGET_EXHAUSTED"
  | "IDENTITY_NOT_REQUIRED_USE_OPENAI"
  | "BUSINESS_VISUAL_USE_OPENAI";

export type VisualRoutingDecision = {
  provider: VisualProvider;
  reasonCode: VisualRoutingReasonCode;
  reason: string;
  requiresIdentityQa: boolean;
  fallbackApplied: boolean;
  mustAvoidSyntheticPerson: boolean;
};

export type VisualRoutingInput = {
  profileType: ProfileVisualType;
  suitableRealAssetAvailable: boolean;
  personIsPrimarySubject: boolean;
  requiresIdentityConsistency: boolean;
  requiresNewScene: boolean;
  virtualShoot: boolean;
  higgsfieldConfigured: boolean;
  soulIdentityState: SoulIdentityState;
  higgsfieldBudgetRemainingEur: number;
  estimatedHiggsfieldCostEur: number;
};

function finiteNonNegative(value: number) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Auditable provider routing only. It returns a short reason and never exposes
 * hidden reasoning. Provider execution and budget reservation happen elsewhere.
 */
export function routeVisualProvider(input: VisualRoutingInput): VisualRoutingDecision {
  if (input.suitableRealAssetAvailable) {
    return {
      provider: "REAL_ASSET",
      reasonCode: "REUSE_SUITABLE_REAL_ASSET",
      reason: "Esiste già un asset reale adatto al contenuto; evito una nuova generazione.",
      requiresIdentityQa: false,
      fallbackApplied: false,
      mustAvoidSyntheticPerson: false,
    };
  }

  const personalBrandIdentityNeed = input.profileType === "PERSONAL_BRAND"
    && input.personIsPrimarySubject
    && (input.requiresIdentityConsistency || input.requiresNewScene || input.virtualShoot);

  if (!personalBrandIdentityNeed) {
    return {
      provider: "OPENAI",
      reasonCode: input.profileType === "BUSINESS" ? "BUSINESS_VISUAL_USE_OPENAI" : "IDENTITY_NOT_REQUIRED_USE_OPENAI",
      reason: input.profileType === "BUSINESS"
        ? "Il visual non richiede una identità personale persistente; uso OpenAI."
        : "L'identità della persona non è necessaria per questo visual; uso OpenAI.",
      requiresIdentityQa: false,
      fallbackApplied: false,
      mustAvoidSyntheticPerson: false,
    };
  }

  if (!input.higgsfieldConfigured) {
    return {
      provider: "OPENAI",
      reasonCode: "HIGGSFIELD_NOT_CONFIGURED",
      reason: "Higgsfield non è configurato; uso un visual alternativo senza persona.",
      requiresIdentityQa: false,
      fallbackApplied: true,
      mustAvoidSyntheticPerson: true,
    };
  }

  if (input.soulIdentityState !== "COMPLETED") {
    return {
      provider: "OPENAI",
      reasonCode: "SOUL_ID_NOT_READY",
      reason: "La Soul ID del Personal Brand non è pronta; uso un visual alternativo senza persona.",
      requiresIdentityQa: false,
      fallbackApplied: true,
      mustAvoidSyntheticPerson: true,
    };
  }

  const remaining = finiteNonNegative(input.higgsfieldBudgetRemainingEur);
  const estimated = finiteNonNegative(input.estimatedHiggsfieldCostEur);
  if (estimated <= 0 || remaining < estimated) {
    return {
      provider: "OPENAI",
      reasonCode: "HIGGSFIELD_BUDGET_EXHAUSTED",
      reason: "Il budget Higgsfield disponibile non copre la generazione; uso un visual alternativo senza persona.",
      requiresIdentityQa: false,
      fallbackApplied: true,
      mustAvoidSyntheticPerson: true,
    };
  }

  return {
    provider: "HIGGSFIELD",
    reasonCode: "PERSONAL_BRAND_IDENTITY_REQUIRES_HIGGSFIELD",
    reason: "Personal Brand con soggetto principale: serve coerenza elevata dell'identità.",
    requiresIdentityQa: true,
    fallbackApplied: false,
    mustAvoidSyntheticPerson: false,
  };
}

export const IDENTITY_QA_DIMENSIONS = [
  "face",
  "eyes",
  "hair",
  "nose",
  "mouth",
  "apparent_age",
  "body",
  "proportions",
  "hands",
  "fingers",
  "teeth",
  "anatomy",
  "artifacts",
  "realism",
  "overall_quality",
] as const;

export type IdentityQaDimension = typeof IDENTITY_QA_DIMENSIONS[number];
export type IdentityQaScores = Record<IdentityQaDimension, number>;

export type IdentityQaResult = {
  verdict: "PASS" | "BLOCK";
  identityScore: number;
  qualityScore: number;
  failedDimensions: IdentityQaDimension[];
};

/**
 * Deterministic gate used after a vision evaluator returns normalized scores.
 * It is deliberately strict on face/anatomy and fails closed.
 */
export function identityQaVerdict(scores: IdentityQaScores): IdentityQaResult {
  const normalized = Object.fromEntries(
    IDENTITY_QA_DIMENSIONS.map((key) => [key, Math.max(0, Math.min(1, Number.isFinite(scores[key]) ? scores[key] : 0))]),
  ) as IdentityQaScores;

  const identityKeys: IdentityQaDimension[] = ["face", "eyes", "hair", "nose", "mouth", "apparent_age", "body", "proportions"];
  const qualityKeys: IdentityQaDimension[] = ["hands", "fingers", "teeth", "anatomy", "artifacts", "realism", "overall_quality"];
  const avg = (keys: IdentityQaDimension[]) => keys.reduce((total, key) => total + normalized[key], 0) / keys.length;
  const identityScore = avg(identityKeys);
  const qualityScore = avg(qualityKeys);

  const criticalThresholds: Partial<Record<IdentityQaDimension, number>> = {
    face: 0.86,
    eyes: 0.8,
    anatomy: 0.8,
    hands: 0.72,
    fingers: 0.72,
    realism: 0.78,
    overall_quality: 0.78,
  };
  const failedDimensions = IDENTITY_QA_DIMENSIONS.filter((key) => {
    const threshold = criticalThresholds[key] ?? 0.65;
    return normalized[key] < threshold;
  });

  const verdict = identityScore >= 0.8 && qualityScore >= 0.76 && failedDimensions.length === 0 ? "PASS" : "BLOCK";
  return { verdict, identityScore, qualityScore, failedDimensions };
}


export type VisualIdentityRequirements = {
  personIsPrimarySubject: boolean;
  requiresIdentityConsistency: boolean;
  requiresNewScene: boolean;
  virtualShoot: boolean;
};

/**
 * Conservative deterministic classifier for Personal Brand visuals.
 * If the brief asks for a human subject in a Personal Brand context, that person
 * is treated as identity-critical. This prevents OpenAI from inventing a fake
 * version of the person when Soul ID is unavailable.
 */
export function inferVisualIdentityRequirements(input: {
  profileType: ProfileVisualType;
  profileName: string;
  visualBrief: string;
}): VisualIdentityRequirements {
  if (input.profileType !== "PERSONAL_BRAND") {
    return { personIsPrimarySubject: false, requiresIdentityConsistency: false, requiresNewScene: false, virtualShoot: false };
  }
  const value = `${input.profileName} ${input.visualBrief}`.normalize("NFKC").toLowerCase();
  const personPattern = /\b(?:persona|personal brand|volto|viso|ritratto|portrait|selfie|creator|founder|fondatore|fondatrice|consulente|professionista|imprenditore|imprenditrice|donna|uomo|ragazza|ragazzo|modella|modello|face|human|person)\b/i;
  const scenePattern = /\b(?:scena|ambientazione|location|studio|ufficio|evento|strada|città|casa|lifestyle|shooting|photoshoot|servizio fotografico|cinematic|editorial)\b/i;
  const virtualShootPattern = /\b(?:shooting|photoshoot|servizio fotografico|editorial|fashion|lifestyle|studio fotografico)\b/i;
  const personIsPrimarySubject = personPattern.test(value);
  return {
    personIsPrimarySubject,
    requiresIdentityConsistency: personIsPrimarySubject,
    requiresNewScene: personIsPrimarySubject && scenePattern.test(value),
    virtualShoot: personIsPrimarySubject && virtualShootPattern.test(value),
  };
}

export function safeVisualBriefForDecision(decision: VisualRoutingDecision, visualBrief: string) {
  if (!decision.mustAvoidSyntheticPerson) return visualBrief;
  return [
    visualBrief,
    "Fallback identità: NON raffigurare persone, volti, corpi o avatar sintetici.",
    "Usa invece ambiente, oggetti, prodotto, dettaglio grafico o composizione editoriale senza esseri umani identificabili.",
  ].join("\n");
}
