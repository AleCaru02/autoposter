import type { EditorialResearchMode } from "../../../api/_lib/editorial-research";
import type { GeneratedSocialContent, SocialFormat, SocialProvider } from "../../../api/_lib/openai-text";
import type { SourceIntelligenceSummary } from "../../../api/_lib/source-intelligence";

export type ManualGenerationRequest = {
  profileId: string;
  topic: string;
  objective: string | null;
  providers: SocialProvider[];
  format: SocialFormat;
  researchMode: EditorialResearchMode;
  sourceProfileId?: string | null;
  pillar?: string | null;
};

export type ManualEditorialContext = {
  profileType: "BUSINESS" | "PERSONAL_BRAND";
  pillar: string | null;
  sourceProfileId: string | null;
  sourceProfileIds: string[];
  sourceRefs: unknown[];
  audience: Record<string, unknown>;
  factProvenance: unknown[];
  externalSources: string[];
  sourceIntelligence?: SourceIntelligenceSummary;
};

export type ManualGenerationResult = {
  content: GeneratedSocialContent;
  editorialContext: ManualEditorialContext;
};

type ManualGenerationResponse = {
  content?: GeneratedSocialContent;
  editorialContext?: ManualEditorialContext;
  error?: string;
  detail?: string;
  message?: string;
};

export type ManualGenerationProgressStage =
  | "PREPARING"
  | "ANALYZING"
  | "RESEARCHING"
  | "WRITING"
  | "COPY_READY"
  | "VERIFYING"
  | "VERIFIED"
  | "FINALIZING"
  | "COMMITTED"
  | "RELEASED";

export type ManualGenerationOperationStatus = {
  state: "NOT_FOUND" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  percent: number;
  stage: ManualGenerationProgressStage;
  error: string | null;
  result: ManualGenerationResult | null;
  createdAt: string | null;
};

type RawStatusResponse = {
  state?: ManualGenerationOperationStatus["state"];
  percent?: number;
  stage?: ManualGenerationProgressStage;
  error?: string | null;
  result?: ManualGenerationResponse | null;
  createdAt?: string | null;
};

export class ManualGenerationError extends Error {
  constructor(public readonly code: string, message = friendlyGenerationError(code), public readonly status: number | null = null) {
    super(message);
    this.name = "ManualGenerationError";
  }
}

export function manualGenerationFingerprint(input: ManualGenerationRequest) {
  return JSON.stringify({
    profileId: input.profileId,
    topic: input.topic.trim(),
    objective: input.objective?.trim() || null,
    providers: [...input.providers].sort(),
    format: input.format,
    researchMode: input.researchMode,
    sourceProfileId: input.sourceProfileId ?? null,
    pillar: input.pillar ?? null,
  });
}

export function friendlyGenerationError(code: string) {
  if (code === "CAPABILITY_DISABLED") return "La generazione di contenuti non è disponibile per questa attività.";
  if (["CAPABILITY_LIMIT_REACHED", "AI_BUDGET_EXCEEDED", "OPENAI_TEXT_BUDGET_REACHED", "PROVIDER_COST_BUDGET_REACHED"].includes(code)) return "Hai raggiunto il limite di generazione disponibile. Riprova al prossimo rinnovo.";
  if (code === "DUPLICATE_CONTENT") return "Esiste già un contenuto molto simile. Prova un tema o un punto di vista diverso.";
  if (code === "GENERATION_IN_PROGRESS") return "Questa richiesta è già in elaborazione.";
  if (code === "METERING_FAILED") return "Il controllo dei limiti non è momentaneamente disponibile. Nessun contenuto è stato addebitato.";
  if (code === "PROFILE_NOT_FOUND") return "L’attività selezionata non è accessibile con questa sessione.";
  if (code === "PERSONAL_BRAND_SOURCE_NOT_AUTHORIZED") return "Scegli una fonte autorizzata per questo Personal Brand.";
  if (code === "PERSONAL_BRAND_OBJECTIVE_REQUIRED") return "Per il Personal Brand indica l’obiettivo editoriale.";
  if (code === "PERSONAL_BRAND_AUDIENCE_REQUIRED") return "Completa il pubblico del Personal Brand prima di generare contenuti.";
  if (code === "FACTCHECK_NEEDS_SOURCE") return "La verifica ha bloccato il testo perché alcune affermazioni non avevano fonti sufficienti. Nessun contenuto non verificato è stato salvato.";
  if (code === "FACTCHECK_BLOCKED") return "La verifica ha trovato un’affermazione non affidabile o contraddetta. Il contenuto è stato bloccato.";
  if (code === "RESEARCH_INSUFFICIENT") return "Non ho trovato fonti sufficienti per sostenere alcune informazioni richieste. Il contenuto non è stato salvato.";
  if (code === "AI_PROVIDER_ERROR") return "Il servizio di generazione ha restituito un errore temporaneo. Riprova tra poco.";
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
      sourceProfileId: input.sourceProfileId ?? null,
      pillar: input.pillar ?? null,
    }),
  });
  const body = await response.json().catch(() => ({})) as ManualGenerationResponse;
  if (!response.ok || !body.content || !body.editorialContext) {
    const code = body.error || body.detail || body.message || "GENERATION_FAILED";
    throw new ManualGenerationError(code, friendlyGenerationError(code), response.status);
  }
  return { content: body.content, editorialContext: body.editorialContext } satisfies ManualGenerationResult;
}

export async function requestManualContentStatus(
  profileId: string,
  token: string,
  operationId: string,
  fetcher: typeof fetch = fetch,
): Promise<ManualGenerationOperationStatus> {
  const response = await fetcher("/api/generate-text/status", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-post-automatici-operation-id": operationId,
    },
    body: JSON.stringify({ profileId }),
  });
  const body = await response.json().catch(() => ({})) as RawStatusResponse & { error?: string };
  if (!response.ok) {
    const code = body.error || "GENERATION_FAILED";
    throw new ManualGenerationError(code, friendlyGenerationError(code), response.status);
  }
  const rawResult = body.result;
  const result = rawResult?.content && rawResult?.editorialContext
    ? { content: rawResult.content, editorialContext: rawResult.editorialContext }
    : null;
  return {
    state: body.state === "COMPLETED" || body.state === "FAILED" || body.state === "IN_PROGRESS" ? body.state : "NOT_FOUND",
    percent: typeof body.percent === "number" ? Math.max(0, Math.min(100, Math.round(body.percent))) : 0,
    stage: body.stage ?? "PREPARING",
    error: typeof body.error === "string" ? body.error : null,
    result,
    createdAt: typeof body.createdAt === "string" ? body.createdAt : null,
  };
}
