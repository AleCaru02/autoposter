import type { EditorialResearchMode } from "../../../api/_lib/editorial-research";
import type { GeneratedSocialContent, SocialFormat, SocialProvider } from "../../../api/_lib/openai-text";

export type ManualGenerationRequest = {
  profileId: string;
  topic: string;
  objective: string | null;
  providers: SocialProvider[];
  format: SocialFormat;
  researchMode: EditorialResearchMode;
};

type ManualGenerationResponse = {
  content?: GeneratedSocialContent;
  error?: string;
  detail?: string;
  message?: string;
};

export function manualGenerationFingerprint(input: ManualGenerationRequest) {
  return JSON.stringify({
    profileId: input.profileId,
    topic: input.topic.trim(),
    objective: input.objective?.trim() || null,
    providers: [...input.providers].sort(),
    format: input.format,
    researchMode: input.researchMode,
  });
}

export function friendlyGenerationError(code: string) {
  if (code === "CAPABILITY_DISABLED") return "La generazione di contenuti non è disponibile per questa attività.";
  if (["CAPABILITY_LIMIT_REACHED", "AI_BUDGET_EXCEEDED", "OPENAI_TEXT_BUDGET_REACHED", "PROVIDER_COST_BUDGET_REACHED"].includes(code)) return "Hai raggiunto il limite di generazione disponibile. Riprova al prossimo rinnovo.";
  if (code === "DUPLICATE_CONTENT") return "Esiste già un contenuto molto simile. Prova un tema o un punto di vista diverso.";
  if (code === "GENERATION_IN_PROGRESS") return "Questa richiesta è già in elaborazione. Attendi qualche secondo e riprova.";
  if (code === "METERING_FAILED") return "Il controllo dei limiti non è momentaneamente disponibile. Nessun contenuto è stato addebitato.";
  if (code === "PROFILE_NOT_FOUND") return "L’attività selezionata non è accessibile con questa sessione.";
  return "Non sono riuscito a generare il contenuto. Riprova tra poco.";
}

export async function requestManualContent(
  input: ManualGenerationRequest,
  token: string,
  operationId: string,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher("/api/generate-text", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-post-automatici-operation-id": operationId,
    },
    body: JSON.stringify({
      profileId: input.profileId,
      topic: input.topic.trim(),
      objective: input.objective?.trim() || null,
      providers: input.providers,
      formats: [input.format],
      researchMode: input.researchMode,
    }),
  });
  const body = await response.json().catch(() => ({})) as ManualGenerationResponse;
  if (!response.ok || !body.content) throw new Error(friendlyGenerationError(body.error || body.detail || body.message || "GENERATION_FAILED"));
  return body.content;
}
