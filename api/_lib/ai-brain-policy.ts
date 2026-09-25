import type { EditorialResearchMode } from "./editorial-research.js";

export type ActivityBudgetBand =
  | "NORMAL"
  | "TARGET_REACHED"
  | "RESERVE"
  | "PROTECTED_RESERVE"
  | "EMERGENCY_ONLY"
  | "HARD_STOP";

export type BrainTask =
  | "COPY_DRAFT"
  | "COPY_FINAL"
  | "STRATEGY"
  | "STRATEGY_COMPLEX"
  | "CAROUSEL_STRUCTURE"
  | "SLIDE_COPY"
  | "EDITORIAL_QA"
  | "RESEARCH"
  | "FACT_CHECK"
  | "IMAGE_STANDARD"
  | "IMAGE_PREMIUM"
  | "PHOTO_EDIT";

export type ContentImportance = "STANDARD" | "IMPORTANT" | "PREMIUM" | "CRITICAL";

export type ClaimRisk = {
  timeSensitive: boolean;
  numeric: boolean;
  legalOrRegulatory: boolean;
  pricingOrFee: boolean;
  platformChange: boolean;
  eventOrDate: boolean;
  material: boolean;
};

export type AiBrainDecision = {
  budgetBand: ActivityBudgetBand;
  allowBillableAi: boolean;
  allowPremium: boolean;
  preferReuse: boolean;
  researchRequired: boolean;
  factCheckRequired: boolean;
  minimumIndependentSources: 0 | 1 | 2;
  task: BrainTask;
  importance: ContentImportance;
};

export const ACTIVITY_BUDGET_EUR = Object.freeze({
  hardCap: 30,
  ordinaryTargetStart: 18,
  reserveStart: 20,
  protectedReserveStart: 25,
  emergencyOnlyStart: 28,
});

export function activityBudgetBand(spendEur: number): ActivityBudgetBand {
  const spend = Math.max(0, Number.isFinite(spendEur) ? spendEur : 0);
  if (spend >= ACTIVITY_BUDGET_EUR.hardCap) return "HARD_STOP";
  if (spend >= ACTIVITY_BUDGET_EUR.emergencyOnlyStart) return "EMERGENCY_ONLY";
  if (spend >= ACTIVITY_BUDGET_EUR.protectedReserveStart) return "PROTECTED_RESERVE";
  if (spend >= ACTIVITY_BUDGET_EUR.reserveStart) return "RESERVE";
  if (spend >= ACTIVITY_BUDGET_EUR.ordinaryTargetStart) return "TARGET_REACHED";
  return "NORMAL";
}

export function detectClaimRisk(text: string): ClaimRisk {
  const value = text.normalize("NFKC").toLowerCase();
  const numeric = /(?:\b\d{1,4}(?:[.,]\d+)?\s*%|€\s*\d|\$\s*\d|\b\d{4}\b|\b\d+(?:[.,]\d+)?\s*(?:euro|eur|dollari|usd|milioni?|miliardi?)\b)/i.test(value);
  const legalOrRegulatory = /\b(?:legge|decreto|normativa|regolamento|obblig|scadenza|tassa|imposta|fiscale|codice|comune|ministero|gazzetta|ue|unione europea)\b/i.test(value);
  const pricingOrFee = /\b(?:prezzo|costo|commissione|fee|tariffa|canone|quota|aumento|diminuzione|sconto)\b/i.test(value);
  const platformChange = /\b(?:airbnb|booking|instagram|facebook|linkedin|google|meta)\b[\s\S]{0,50}\b(?:cambia|introduce|aggiorna|rimuove|aumenta|riduce|nuova|nuovo|dal\s+20\d{2})\b/i.test(value)
    || /\b(?:cambia|introduce|aggiorna|rimuove|aumenta|riduce)\b[\s\S]{0,50}\b(?:airbnb|booking|instagram|facebook|linkedin|google|meta)\b/i.test(value);
  const eventOrDate = /\b(?:oggi|domani|questa settimana|questo mese|evento|fiera|congresso|dal\s+\d|il\s+\d{1,2}[\/.-]\d{1,2}|20\d{2})\b/i.test(value);
  const timeSensitive = legalOrRegulatory || pricingOrFee || platformChange || eventOrDate || /\b(?:news|notizia|aggiornamento|mercato|trend|statistic|dati recenti|ultimo|ultima)\b/i.test(value);
  const material = numeric || legalOrRegulatory || pricingOrFee || platformChange || eventOrDate;
  return { timeSensitive, numeric, legalOrRegulatory, pricingOrFee, platformChange, eventOrDate, material };
}

export function sourceRequirement(risk: ClaimRisk, importance: ContentImportance): 0 | 1 | 2 {
  if (!risk.material && !risk.timeSensitive) return 0;
  if (importance === "IMPORTANT" || importance === "PREMIUM" || importance === "CRITICAL") return 2;
  if (risk.legalOrRegulatory || risk.platformChange || risk.numeric) return 2;
  return 1;
}

export function brainDecision(input: {
  spendEur: number;
  task: BrainTask;
  importance?: ContentImportance;
  researchMode?: EditorialResearchMode;
  text?: string;
  forecastEndOfMonthEur?: number | null;
}): AiBrainDecision {
  const budgetBand = activityBudgetBand(input.spendEur);
  const importance = input.importance ?? "STANDARD";
  const risk = detectClaimRisk(input.text ?? "");
  const explicitResearch = input.task === "RESEARCH" || input.task === "FACT_CHECK";
  const modeRequiresResearch = input.researchMode !== "WEBSITE_ONLY" && input.researchMode !== undefined;
  const researchRequired = explicitResearch || risk.timeSensitive || (modeRequiresResearch && input.researchMode === "NEWS");
  const factCheckRequired = input.task === "FACT_CHECK" || risk.material;
  const forecastRisk = (input.forecastEndOfMonthEur ?? 0) > ACTIVITY_BUDGET_EUR.ordinaryTargetStart;
  const allowBillableAi = budgetBand !== "HARD_STOP";
  const allowPremium = allowBillableAi
    && budgetBand !== "EMERGENCY_ONLY"
    && (budgetBand === "NORMAL" || importance === "PREMIUM" || importance === "CRITICAL");
  const preferReuse = forecastRisk || ["TARGET_REACHED", "RESERVE", "PROTECTED_RESERVE", "EMERGENCY_ONLY"].includes(budgetBand);

  return {
    budgetBand,
    allowBillableAi,
    allowPremium,
    preferReuse,
    researchRequired,
    factCheckRequired,
    minimumIndependentSources: sourceRequirement(risk, importance),
    task: input.task,
    importance,
  };
}

export function publicationGate(input: {
  qaVerdict: "PASS" | "BLOCK";
  factCheckRequired: boolean;
  factCheckVerdict: "PASS" | "BLOCK" | "NEEDS_RESEARCH" | null;
  sourceCount: number;
  minimumIndependentSources: number;
}) {
  if (input.qaVerdict !== "PASS") return { allowed: false, reason: "QA_BLOCKED" as const };
  if (input.factCheckRequired && input.factCheckVerdict !== "PASS") return { allowed: false, reason: "FACT_CHECK_BLOCKED" as const };
  if (input.minimumIndependentSources > 0 && input.sourceCount < input.minimumIndependentSources) return { allowed: false, reason: "INSUFFICIENT_SOURCES" as const };
  return { allowed: true, reason: null };
}
