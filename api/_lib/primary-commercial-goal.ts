/**
 * Optional, owner-defined priority for a single brand profile.
 * Stored in the existing brand_profiles.visual_identity JSON alongside
 * detected goals. No default is inferred from an AI scan.
 */
export const COMMERCIAL_OBJECTIVES = [
  "Richieste di preventivo",
  "Vendite",
  "Prenotazioni",
  "Visibilità",
  "Crescita del personal brand",
] as const;

export function primaryCommercialGoal(visualIdentity: unknown): string | null {
  if (!visualIdentity || typeof visualIdentity !== "object" || Array.isArray(visualIdentity)) return null;
  const value = (visualIdentity as Record<string, unknown>).primaryCommercialGoal;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned && cleaned.length <= 160 ? cleaned : null;
}

export function commercialGoalOptions(active: string[], detected: string[]): string[] {
  return [...new Set([...COMMERCIAL_OBJECTIVES, ...active, ...detected].map(value => value.trim()).filter(Boolean))];
}
