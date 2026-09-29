export type EditorialDecisionRecord = { headline: string; summary: string; entries: Array<{ label: string; detail: string; state: "PASS" | "REVIEW" | "INFO" }> };
type Input = {
  topic: string;
  objective?: string | null;
  provider: string;
  format: string;
  eligible: boolean;
  approvalStatus: string;
  asset?: { source?: string | null; metadata?: unknown } | null;
  masterDecision?: { rationale?: unknown; channels?: unknown; timing?: unknown } | null;
  visualDecision?: {
    provider?: string | null;
    model?: string | null;
    reason?: string | null;
    estimatedCostEur?: number | null;
    actualCostEur?: number | null;
    identityQaStatus?: string | null;
  } | null;
};
function metadata(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function platform(provider: string) { return ({ INSTAGRAM: "Instagram", FACEBOOK: "Facebook", LINKEDIN: "LinkedIn", GBP: "Google Business Profile" } as Record<string, string>)[provider.toUpperCase()] ?? provider; }
function assetDetail(asset: Input["asset"]) {
  if (!asset) return { detail: "Nessun asset collegato: l’immagine resta da scegliere o generare.", state: "REVIEW" as const };
  const reused = metadata(asset.metadata).reuse_reason;
  if (typeof reused === "string") return { detail: `Asset riutilizzato perché compatibile (${reused.replaceAll("_", " ").toLowerCase()}). Nessuna nuova generazione a pagamento.`, state: "PASS" as const };
  if (asset.source === "AI_IMAGE") return { detail: "Visuale generata con OpenAI gpt-image-2 e salvata nel catalogo asset.", state: "INFO" as const };
  return { detail: "Visuale scelta dal catalogo dell’attività: verifica che rappresenti ancora correttamente il contenuto.", state: "REVIEW" as const };
}
function visualProviderLabel(value: string | null | undefined) {
  if (value === "REAL_ASSET") return "Asset esistente";
  if (value === "HIGGSFIELD") return "Higgsfield";
  if (value === "OPENAI") return "OpenAI";
  return null;
}

function visualDecisionDetail(value: Input["visualDecision"]) {
  if (!value?.provider) return null;
  const provider = visualProviderLabel(value.provider) ?? value.provider;
  const reason = value.reason ? value.reason.replaceAll("_", " ").toLowerCase() : "decisione automatica";
  const model = value.model ? ` · modello ${value.model}` : "";
  const actual = typeof value.actualCostEur === "number"
    ? ` · costo ${value.actualCostEur.toFixed(3)} €`
    : typeof value.estimatedCostEur === "number"
      ? ` · stima ${value.estimatedCostEur.toFixed(3)} €`
      : "";
  return `${provider}${model}: ${reason}${actual}.`;
}

export function buildEditorialDecisionRecord(input: Input): EditorialDecisionRecord {
  const objective = input.objective?.trim() || "informare in modo utile il pubblico";
  const review = input.approvalStatus === "APPROVED" ? { detail: "Variante approvata: può essere programmata quando il canale è collegato.", state: "PASS" as const } : input.approvalStatus === "CHANGES_REQUESTED" ? { detail: "Sono state richieste correzioni: non può essere pubblicata finché non viene riapprovata.", state: "REVIEW" as const } : { detail: "In revisione personale: nessuna pubblicazione è autorizzata da questo stato.", state: "REVIEW" as const };
  const master = metadata(input.masterDecision); const channels = Array.isArray(master.channels) ? master.channels.filter((item): item is { provider: string; action: string; rationale: string } => Boolean(item) && typeof item === "object" && typeof (item as Record<string, unknown>).provider === "string" && typeof (item as Record<string, unknown>).action === "string" && typeof (item as Record<string, unknown>).rationale === "string") : [];
  const channelDetail = channels.length ? channels.map((channel) => `${platform(channel.provider)} — ${channel.action === "USE" ? "pubblicato" : "escluso"} perché ${channel.rationale}`).join(" ") : null;
  const timing = metadata(master.timing); const timingSource = typeof timing.source === "string" ? timing.source : null;
  const timingLabels: Record<string, string> = { USER_CONFIG: "configurazione utente", LEARNING: "apprendimento da risultati reali", STRATEGY: "strategia del canale", DEFAULT: "fallback di sicurezza" };
  const timingDetail = timingSource ? `Orario scelto da ${timingLabels[timingSource] ?? timingSource}${typeof timing.scheduledAt === "string" ? ` (${timing.scheduledAt}).` : "."}` : null;
  return { headline: `Scelta editoriale: ${input.topic || "contenuto"}`, summary: `Questa variante punta a ${objective} su ${platform(input.provider)} in formato ${input.format.toLowerCase()}.`, entries: [{ label: "Decisione centrale", detail: typeof master.rationale === "string" ? master.rationale : "Decisione della singola variante: nessun piano centrale storico disponibile.", state: typeof master.rationale === "string" ? "PASS" : "INFO" }, ...(channelDetail ? [{ label: "Canali valutati", detail: channelDetail, state: "INFO" as const }] : []), ...(timingDetail ? [{ label: "Orario", detail: timingDetail, state: "INFO" as const }] : []), ...(visualDecisionDetail(input.visualDecision) ? [{ label: "Provider visuale", detail: visualDecisionDetail(input.visualDecision)!, state: "INFO" as const }] : []), { label: "Obiettivo", detail: objective, state: "INFO" }, { label: "Canale e formato", detail: `${platform(input.provider)} · ${input.format}. La variante è ${input.eligible ? "compatibile" : "non compatibile"} con questo canale.`, state: input.eligible ? "PASS" : "REVIEW" }, { label: "Visuale", ...assetDetail(input.asset) }, { label: "Controllo", ...review }] };
}
