export type EditorialDecisionRecord = { headline: string; summary: string; entries: Array<{ label: string; detail: string; state: "PASS" | "REVIEW" | "INFO" }> };
type Input = { topic: string; objective?: string | null; provider: string; format: string; eligible: boolean; approvalStatus: string; asset?: { source?: string | null; metadata?: unknown } | null };
function metadata(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function platform(provider: string) { return ({ INSTAGRAM: "Instagram", FACEBOOK: "Facebook", LINKEDIN: "LinkedIn", GBP: "Google Business Profile" } as Record<string, string>)[provider.toUpperCase()] ?? provider; }
function assetDetail(asset: Input["asset"]) {
  if (!asset) return { detail: "Nessun asset collegato: l’immagine resta da scegliere o generare.", state: "REVIEW" as const };
  const reused = metadata(asset.metadata).reuse_reason;
  if (typeof reused === "string") return { detail: `Asset riutilizzato perché compatibile (${reused.replaceAll("_", " ").toLowerCase()}). Nessuna nuova generazione a pagamento.`, state: "PASS" as const };
  if (asset.source === "AI_IMAGE") return { detail: "Visuale generata con OpenAI gpt-image-2 e salvata nel catalogo asset.", state: "INFO" as const };
  return { detail: "Visuale scelta dal catalogo dell’attività: verifica che rappresenti ancora correttamente il contenuto.", state: "REVIEW" as const };
}
export function buildEditorialDecisionRecord(input: Input): EditorialDecisionRecord {
  const objective = input.objective?.trim() || "informare in modo utile il pubblico";
  const review = input.approvalStatus === "APPROVED" ? { detail: "Variante approvata: può essere programmata quando il canale è collegato.", state: "PASS" as const } : input.approvalStatus === "CHANGES_REQUESTED" ? { detail: "Sono state richieste correzioni: non può essere pubblicata finché non viene riapprovata.", state: "REVIEW" as const } : { detail: "In revisione personale: nessuna pubblicazione è autorizzata da questo stato.", state: "REVIEW" as const };
  return { headline: `Scelta editoriale: ${input.topic || "contenuto"}`, summary: `Questa variante punta a ${objective} su ${platform(input.provider)} in formato ${input.format.toLowerCase()}.`, entries: [{ label: "Obiettivo", detail: objective, state: "INFO" }, { label: "Canale e formato", detail: `${platform(input.provider)} · ${input.format}. La variante è ${input.eligible ? "compatibile" : "non compatibile"} con questo canale.`, state: input.eligible ? "PASS" : "REVIEW" }, { label: "Visuale", ...assetDetail(input.asset) }, { label: "Controllo", ...review }] };
}
