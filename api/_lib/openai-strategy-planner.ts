import { neon } from "@neondatabase/serverless";
import type { SocialProvider } from "./openai-text.js";
import type { ContentType, EditorialIntent, FunnelStage } from "./content-agents.js";
import { StrategyPlannerMetering } from "./strategy-planner-metering.js";

export type StrategyPlannerEnv = { DATABASE_URL?: string; OPENAI_API_KEY?: string };

type BrandRow = {
  description: string | null;
  business_model: string | null;
  location: string | null;
  service_area: string | null;
  target_audience: unknown;
  tone_of_voice: unknown;
  goals: unknown;
  visual_identity: unknown;
};
type ProfileRow = { id: string; name: string; industry: string | null; website_url: string | null; timezone: string };
type StrategyRow = { objectives: unknown; platform_strategy: unknown };
type ScheduleRow = { provider: SocialProvider; posts_per_week: number; preferred_slots: unknown; timezone: string; enabled: boolean };
type TopicRow = { topic: string };

type Usage = { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };

export type OpenAIStrategy = {
  summary: string;
  primaryObjective: string;
  audience: string;
  positioning: string;
  contentPillars: string[];
  contentMix: { educational: number; promotional: number; news: number; tips: number; storytelling: number };
  platformPriorities: SocialProvider[];
  ctaPolicy: string;
  localityPolicy: string;
  seasonalityPolicy: string;
  doNotClaim: string[];
};

export type PlanItem = {
  dayOffset: number;
  provider: SocialProvider;
  contentType: ContentType;
  intent: EditorialIntent;
  topicDirection: string;
  objective: string;
  funnelStage: FunnelStage;
};

export type OpenAIEditorialPlan = { horizonDays: number; planningSummary: string; items: PlanItem[] };
export type OpenAIStrategyPlannerResponse = { strategy: OpenAIStrategy; plan: OpenAIEditorialPlan; generatedAt: string; model: string };

const MODEL = "gpt-5.6-terra";
const STRATEGY_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    summary: { type: "string" }, primaryObjective: { type: "string" }, audience: { type: "string" }, positioning: { type: "string" },
    contentPillars: { type: "array", minItems: 3, maxItems: 8, items: { type: "string" } },
    contentMix: { type: "object", additionalProperties: false, properties: { educational: { type: "integer", minimum: 0, maximum: 100 }, promotional: { type: "integer", minimum: 0, maximum: 100 }, news: { type: "integer", minimum: 0, maximum: 100 }, tips: { type: "integer", minimum: 0, maximum: 100 }, storytelling: { type: "integer", minimum: 0, maximum: 100 } }, required: ["educational","promotional","news","tips","storytelling"] },
    platformPriorities: { type: "array", minItems: 1, maxItems: 4, items: { type: "string", enum: ["INSTAGRAM","FACEBOOK","LINKEDIN","GBP"] } },
    ctaPolicy: { type: "string" }, localityPolicy: { type: "string" }, seasonalityPolicy: { type: "string" },
    doNotClaim: { type: "array", maxItems: 12, items: { type: "string" } },
  },
  required: ["summary","primaryObjective","audience","positioning","contentPillars","contentMix","platformPriorities","ctaPolicy","localityPolicy","seasonalityPolicy","doNotClaim"],
} as const;

const PLAN_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    horizonDays: { type: "integer", minimum: 14, maximum: 28 }, planningSummary: { type: "string" },
    items: { type: "array", minItems: 1, maxItems: 60, items: { type: "object", additionalProperties: false, properties: {
      dayOffset: { type: "integer", minimum: 0, maximum: 27 },
      provider: { type: "string", enum: ["INSTAGRAM","FACEBOOK","LINKEDIN","GBP"] },
      contentType: { type: "string", enum: ["SINGLE_POST","CAROUSEL","STORYTELLING","SINGLE_STORY"] },
      intent: { type: "string", enum: ["EDUCATION","PROBLEM_SOLUTION","TIP","FAQ","CASE_STUDY","NEWS","SERVICE","COMMON_MISTAKE","CHECKLIST","SEASONAL"] },
      topicDirection: { type: "string" }, objective: { type: "string" },
      funnelStage: { type: "string", enum: ["AWARENESS","CONSIDERATION","CONVERSION","RETENTION"] },
    }, required: ["dayOffset","provider","contentType","intent","topicDirection","objective","funnelStage"] } },
  }, required: ["horizonDays","planningSummary","items"],
} as const;

function object(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function summary(value: unknown) { const v = object(value).summary; return typeof v === "string" ? v : null; }
function strings(value: unknown) { return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && Boolean(v.trim())).map((v) => v.trim()) : []; }
function outputText(body: Record<string, unknown>) {
  if (typeof body.output_text === "string" && body.output_text.trim()) return body.output_text;
  const chunks: string[] = [];
  for (const item of Array.isArray(body.output) ? body.output : []) {
    if (!item || typeof item !== "object") continue;
    for (const part of Array.isArray((item as { content?: unknown }).content) ? (item as { content: unknown[] }).content : []) {
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "output_text" && typeof (part as { text?: unknown }).text === "string") chunks.push((part as { text: string }).text);
    }
  }
  return chunks.join("\n").trim();
}
function usage(body: Record<string, unknown>): Usage {
  const u = body.usage && typeof body.usage === "object" ? body.usage as Record<string, unknown> : {};
  return { inputTokens: typeof u.input_tokens === "number" ? u.input_tokens : null, outputTokens: typeof u.output_tokens === "number" ? u.output_tokens : null, totalTokens: typeof u.total_tokens === "number" ? u.total_tokens : null };
}

async function callAgent<T>(input: { apiKey: string; agent: "STRATEGIST" | "PLANNER"; instructions: string; context: unknown; schema: unknown; schemaName: string; fetcher?: typeof fetch }): Promise<{ output: T; responseId: string; requestId: string | null; usage: Usage }> {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, store: false, reasoning: { effort: "medium" }, instructions: input.instructions, input: JSON.stringify(input.context), text: { verbosity: "medium", format: { type: "json_schema", name: input.schemaName, strict: true, schema: input.schema } }, max_output_tokens: input.agent === "STRATEGIST" ? 3200 : 5000 }),
  });
  const requestId = response.headers.get("x-request-id");
  const raw = await response.text();
  if (!response.ok) throw new Error(`OPENAI_${input.agent}_HTTP_${response.status}`);
  const body = JSON.parse(raw) as Record<string, unknown>;
  const text = outputText(body);
  if (!text) throw new Error(`OPENAI_${input.agent}_EMPTY_OUTPUT`);
  return { output: JSON.parse(text) as T, responseId: typeof body.id === "string" ? body.id : "", requestId, usage: usage(body) };
}

export function generateOpenAIStrategy(input: { apiKey: string; profile: ProfileRow; brand: BrandRow | undefined; existingObjectives: unknown; fetcher?: typeof fetch }) {
  return callAgent<OpenAIStrategy>({
    apiKey: input.apiKey, agent: "STRATEGIST", fetcher: input.fetcher, schema: STRATEGY_SCHEMA, schemaName: "post_automatici_strategy",
    instructions: [
      "Sei lo Strategist Agent di Post Automatici e lavori esclusivamente tramite API OpenAI.",
      "Definisci una strategia editoriale concreta per la singola attività, non copy di post.",
      "Usa i dati del profilo e del brand come fonte per fatti specifici dell'attività. Non inventare prezzi, sedi, servizi, risultati o certificazioni.",
      "Bilancia educazione, consigli, news, storytelling e promozione. Le percentuali del contentMix devono sommare esattamente a 100.",
      "Considera Instagram, Facebook, LinkedIn e Google Business Profile solo quando pertinenti.",
      "Restituisci esclusivamente JSON conforme allo schema.",
    ].join("\n"),
    context: { profile: input.profile, brand: { description: input.brand?.description ?? null, businessModel: input.brand?.business_model ?? null, location: input.brand?.location ?? null, serviceArea: input.brand?.service_area ?? null, target: summary(input.brand?.target_audience), tone: summary(input.brand?.tone_of_voice), goals: strings(input.brand?.goals), visualIdentity: input.brand?.visual_identity ?? null }, existingObjectives: strings(input.existingObjectives) },
  });
}

export function generateOpenAIPlan(input: { apiKey: string; profile: ProfileRow; strategy: OpenAIStrategy; schedules: ScheduleRow[]; recentTopics: string[]; fetcher?: typeof fetch }) {
  return callAgent<OpenAIEditorialPlan>({
    apiKey: input.apiKey, agent: "PLANNER", fetcher: input.fetcher, schema: PLAN_SCHEMA, schemaName: "post_automatici_editorial_plan",
    instructions: [
      "Sei il Planner Agent di Post Automatici e lavori esclusivamente tramite API OpenAI.",
      "Crea un piano editoriale di 14-28 giorni basato sulla strategia approvata, senza scrivere il copy finale.",
      "Distribuisci post singoli, caroselli, storytelling e storie singole solo dove il social li supporta realmente.",
      "Per GBP usa SINGLE_POST. Per LinkedIn non usare SINGLE_STORY. Instagram e Facebook possono usare tutti i tipi previsti.",
      "Evita i temi recenti e distribuisci intenti e funnel senza sequenze ripetitive.",
      "Rispetta la frequenza dei schedule abilitati; se un provider ha posts_per_week=0 o disabled non pianificarlo.",
      "Non inventare eventi, news o fatti: NEWS indica soltanto una direzione da affidare successivamente al Research Agent.",
      "Restituisci esclusivamente JSON conforme allo schema.",
    ].join("\n"),
    context: { profile: { name: input.profile.name, industry: input.profile.industry, timezone: input.profile.timezone }, strategy: input.strategy, schedules: input.schedules, recentTopics: input.recentTopics.slice(0, 40) },
  });
}

export async function runOpenAIStrategyPlanner(env: StrategyPlannerEnv, profileId: string, fetcher?: typeof fetch) {
  if (!env.DATABASE_URL) throw new Error("DATABASE_NOT_CONFIGURED");
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_NOT_CONFIGURED");
  const sql = neon(env.DATABASE_URL);
  const profiles = await sql`select id,name,industry,website_url,timezone from public.profiles where id=${profileId}::uuid and archived_at is null limit 1` as unknown as ProfileRow[];
  const profile = profiles[0];
  if (!profile) throw new Error("PROFILE_NOT_FOUND");
  const brands = await sql`select description,business_model,location,service_area,target_audience,tone_of_voice,goals,visual_identity from public.brand_profiles where profile_id=${profileId}::uuid limit 1` as unknown as BrandRow[];
  const current = await sql`select objectives,platform_strategy from public.content_strategies where profile_id=${profileId}::uuid limit 1` as unknown as StrategyRow[];
  const schedules = await sql`select provider,posts_per_week,preferred_slots,timezone,enabled from public.schedules where profile_id=${profileId}::uuid and enabled=true order by provider` as unknown as ScheduleRow[];
  const recent = await sql`select topic from public.content_items where profile_id=${profileId}::uuid order by created_at desc limit 40` as unknown as TopicRow[];

  const meter = new StrategyPlannerMetering(env.DATABASE_URL);
  const reservation = await meter.reserve({ profileId, cycle: "STRATEGY_PLAN" });
  if (reservation.status === "DENIED") throw new Error(reservation.code);
  if (reservation.status === "COMPLETED") return reservation.cached.response as OpenAIStrategyPlannerResponse;
  if (reservation.status === "IN_PROGRESS") throw new Error("STRATEGY_GENERATION_IN_PROGRESS");
  if (reservation.status === "RELEASED") throw new Error("METERING_FAILED");
  const eventId = reservation.eventId;
  let logicalCommitted = false;
  try {
    await meter.markProviderStarted(eventId);
    const strategyResult = await generateOpenAIStrategy({ apiKey: env.OPENAI_API_KEY, profile, brand: brands[0], existingObjectives: current[0]?.objectives, fetcher });
    await meter.persistTechnicalUsage(profileId, eventId, {
      operation: "AGENT_STRATEGIST", model: MODEL,
      inputTokens: strategyResult.usage.inputTokens, outputTokens: strategyResult.usage.outputTokens,
      responseId: strategyResult.responseId, requestId: strategyResult.requestId,
      metadata: { agent: "STRATEGIST", refresh: false },
    });
    const mixTotal = Object.values(strategyResult.output.contentMix).reduce((sum, value) => sum + value, 0);
    if (mixTotal !== 100) throw new Error("OPENAI_STRATEGIST_INVALID_MIX");
    const plannerResult = await generateOpenAIPlan({ apiKey: env.OPENAI_API_KEY, profile, strategy: strategyResult.output, schedules, recentTopics: recent.map((row) => row.topic).filter(Boolean), fetcher });
    await meter.persistTechnicalUsage(profileId, eventId, {
      operation: "AGENT_PLANNER", model: MODEL,
      inputTokens: plannerResult.usage.inputTokens, outputTokens: plannerResult.usage.outputTokens,
      responseId: plannerResult.responseId, requestId: plannerResult.requestId,
      metadata: { agent: "PLANNER", refresh: false, horizon_days: plannerResult.output.horizonDays, items: plannerResult.output.items.length },
    });

    const existing = object(current[0]?.platform_strategy);
    const now = new Date().toISOString();
    const persisted = { ...existing, aiStrategy: strategyResult.output, aiStrategyGeneratedAt: now, aiEditorialPlan: plannerResult.output, aiEditorialPlanGeneratedAt: now, aiAgentsVersion: 2, aiAgentsModel: MODEL };
    const responseBody: OpenAIStrategyPlannerResponse = { strategy: strategyResult.output, plan: plannerResult.output, generatedAt: now, model: MODEL };
    await sql`insert into public.content_strategies (profile_id,objectives,platform_strategy,updated_at)
              values (${profileId}::uuid,${JSON.stringify([strategyResult.output.primaryObjective])}::jsonb,${JSON.stringify(persisted)}::jsonb,${now}::timestamptz)
              on conflict (profile_id) do update set objectives=excluded.objectives,platform_strategy=excluded.platform_strategy,updated_at=excluded.updated_at`;
    await meter.storeResult(eventId, { response: responseBody });
    await meter.commit(eventId);
    logicalCommitted = true;
    return responseBody;
  } catch (reason) {
    if (!logicalCommitted) await meter.release(eventId, reason instanceof Error ? reason.message : "STRATEGY_GENERATION_FAILED").catch(() => undefined);
    throw reason;
  }
}
