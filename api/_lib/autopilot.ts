import { neon } from "@neondatabase/serverless";
import { estimateTextRequestUpperBoundUsd, generateSocialText, type BrandContext, type SocialFormat, type SocialProvider } from "./openai-text.js";
import { generateOpenAIImage, type ImageSocialFormat, type ImageSocialProvider } from "./openai-image.js";

export type ApprovalMode = "MANUAL_REVIEW" | "AUTOMATIC";

export type AutopilotEnv = {
  DATABASE_URL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_TEXT_MONTHLY_BUDGET_USD?: string;
  OPENAI_IMAGE_MONTHLY_LIMIT?: string;
};

type Sql = ReturnType<typeof neon>;
type ProfileRow = { id: string; name: string; website_url: string | null; industry: string | null; timezone: string };
type BrandRow = { description: string | null; business_model: string | null; location: string | null; service_area: string | null; target_audience: unknown; tone_of_voice: unknown; goals: unknown };
type StrategyRow = { objectives: unknown; platform_strategy: unknown };
type ScheduleRow = { provider: SocialProvider; timezone: string; posts_per_week: number; preferred_slots: unknown; auto_choose: boolean; enabled: boolean };
type PreferredSlot = { day: number; time: string };
type PageRow = { url: string; title: string | null; content_text: string | null };
type JobRow = { provider: SocialProvider; scheduled_at: string };
type RecentItemRow = { topic: string };
type CountRow = { count: number | string };
type SpendRow = { spend: number | string | null };

type RunOptions = { profileId?: string; maxGenerations?: number };
type RunResult = { profilesChecked: number; generated: number; scheduled: number; blockedForReview: number; skipped: number; errors: string[] };

const DEFAULT_TEXT_BUDGET_USD = 5;
const DEFAULT_IMAGE_LIMIT = 20;
const MAX_PROFILES_PER_RUN = 100;
const DEFAULT_GENERATIONS_PER_RUN = 12;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const DEFAULT_SCHEDULES: Array<{ provider: SocialProvider; posts: number }> = [
  { provider: "INSTAGRAM", posts: 2 },
  { provider: "FACEBOOK", posts: 1 },
  { provider: "LINKEDIN", posts: 1 },
  { provider: "GBP", posts: 1 },
];

const PROVIDER_BASE_TIME: Record<SocialProvider, string> = {
  INSTAGRAM: "18:00",
  FACEBOOK: "12:30",
  LINKEDIN: "09:00",
  GBP: "10:00",
};

const PROVIDER_OFFSET: Record<SocialProvider, number> = {
  INSTAGRAM: 0,
  FACEBOOK: 1,
  LINKEDIN: 2,
  GBP: 3,
};

const FORMAT_ROTATION: Record<SocialProvider, SocialFormat[]> = {
  INSTAGRAM: ["POST", "CAROUSEL", "STORY"],
  FACEBOOK: ["POST", "CAROUSEL", "STORY"],
  LINKEDIN: ["POST", "CAROUSEL"],
  GBP: ["POST"],
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function summary(value: unknown) {
  const text = asObject(value).summary;
  return typeof text === "string" && text.trim() ? text.trim() : null;
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
}

function normalizeSlots(value: unknown): PreferredSlot[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const slots: PreferredSlot[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const day = Number((item as Record<string, unknown>).day);
    const time = String((item as Record<string, unknown>).time ?? "");
    if (!Number.isInteger(day) || day < 1 || day > 7 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) continue;
    const key = `${day}:${time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    slots.push({ day, time });
  }
  return slots.sort((a, b) => a.day - b.day || a.time.localeCompare(b.time));
}

function textBudget(env: AutopilotEnv) {
  const parsed = Number(env.OPENAI_TEXT_MONTHLY_BUDGET_USD ?? DEFAULT_TEXT_BUDGET_USD);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0.1), 100) : DEFAULT_TEXT_BUDGET_USD;
}

function imageLimit(env: AutopilotEnv) {
  const parsed = Number(env.OPENAI_IMAGE_MONTHLY_LIMIT ?? DEFAULT_IMAGE_LIMIT);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 1), 500) : DEFAULT_IMAGE_LIMIT;
}

function monthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: pick("year"), month: pick("month"), day: pick("day"), hour: pick("hour"), minute: pick("minute"), second: pick("second") };
}

function offsetAt(timestamp: number, timeZone: string) {
  const parts = zonedParts(new Date(timestamp), timeZone);
  const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return representedAsUtc - Math.floor(timestamp / 1000) * 1000;
}

function zonedLocalToIso(localValue: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localValue);
  if (!match) throw new Error("INVALID_LOCAL_DATETIME");
  const [, y, m, d, h, min] = match;
  const localAsUtc = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), 0);
  let instant = localAsUtc - offsetAt(localAsUtc, timeZone);
  instant = localAsUtc - offsetAt(instant, timeZone);
  const roundtrip = zonedParts(new Date(instant), timeZone);
  if (roundtrip.year !== Number(y) || roundtrip.month !== Number(m) || roundtrip.day !== Number(d) || roundtrip.hour !== Number(h) || roundtrip.minute !== Number(min)) throw new Error("NON_EXISTENT_LOCAL_TIME");
  return new Date(instant).toISOString();
}

function localDateKey(date: Date, timezone: string) {
  const parts = zonedParts(date, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function isoWeekdayFromLocalDate(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function uniqueFutureLocalDates(now: Date, timezone: string, count = 14) {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; keys.length < count && index < count + 5; index += 1) {
    const key = localDateKey(new Date(now.getTime() + index * DAY_MS), timezone);
    if (!seen.has(key)) { seen.add(key); keys.push(key); }
  }
  return keys;
}

function candidateSlots(schedule: ScheduleRow, now = new Date()) {
  const target = Math.min(Math.max(Math.floor(Number(schedule.posts_per_week) || 0), 0), 21);
  if (!target) return [];
  const timezone = schedule.timezone || "Europe/Rome";
  const dates = uniqueFutureLocalDates(now, timezone, 14);
  const preferred = normalizeSlots(schedule.preferred_slots);
  const candidates: string[] = [];

  if (preferred.length) {
    for (const date of dates) {
      const weekday = isoWeekdayFromLocalDate(date);
      for (const slot of preferred) {
        if (slot.day !== weekday) continue;
        try {
          const iso = zonedLocalToIso(`${date}T${slot.time}`, timezone);
          if (new Date(iso).getTime() > now.getTime() + HOUR_MS) candidates.push(iso);
        } catch { /* DST gap: skip this one slot */ }
      }
    }
  }

  if (candidates.length < target) {
    const base = PROVIDER_BASE_TIME[schedule.provider] || "12:00";
    for (let index = 0; index < target * 3 && candidates.length < target * 2; index += 1) {
      const spread = Math.floor((index % Math.max(target, 1)) * 7 / Math.max(target, 1));
      const cycle = Math.floor(index / Math.max(target, 1));
      const dateIndex = PROVIDER_OFFSET[schedule.provider] + spread + cycle * 7;
      const date = dates[dateIndex];
      if (!date) continue;
      const time = cycle === 0 ? base : cycle === 1 ? "13:00" : "09:00";
      try {
        const iso = zonedLocalToIso(`${date}T${time}`, timezone);
        if (new Date(iso).getTime() > now.getTime() + HOUR_MS && !candidates.includes(iso)) candidates.push(iso);
      } catch { /* ignore invalid DST slot */ }
    }
  }

  return candidates.sort((a, b) => a.localeCompare(b)).slice(0, target);
}

function settingsFromStrategy(value: unknown) {
  const strategy = asObject(value);
  return {
    enabled: strategy.autopilotEnabled !== false,
    approvalMode: strategy.approvalMode === "AUTOMATIC" ? "AUTOMATIC" as ApprovalMode : "MANUAL_REVIEW" as ApprovalMode,
  };
}

async function ensureStrategy(sql: Sql, profileId: string) {
  const defaults = JSON.stringify({ autopilotEnabled: true, approvalMode: "MANUAL_REVIEW" });
  await sql`insert into public.content_strategies (profile_id, platform_strategy, updated_at)
            values (${profileId}::uuid, ${defaults}::jsonb, now())
            on conflict (profile_id) do nothing`;
}

async function ensureSchedules(sql: Sql, profile: ProfileRow) {
  for (const item of DEFAULT_SCHEDULES) {
    await sql`insert into public.schedules (profile_id, provider, timezone, posts_per_week, preferred_slots, auto_choose, enabled, updated_at)
              select ${profile.id}::uuid, ${item.provider}, ${profile.timezone || "Europe/Rome"}, ${item.posts}, '[]'::jsonb, true, true, now()
              where not exists (
                select 1 from public.schedules where profile_id = ${profile.id}::uuid and provider = ${item.provider}
              )`;
  }
}

async function loadBrandContext(sql: Sql, profile: ProfileRow): Promise<BrandContext> {
  const brandRows = await sql`select description,business_model,location,service_area,target_audience,tone_of_voice,goals
                              from public.brand_profiles where profile_id=${profile.id}::uuid limit 1` as unknown as BrandRow[];
  const brand = brandRows[0];
  const scans = await sql`select id from public.website_scans
                          where profile_id=${profile.id}::uuid and state in ('COMPLETE','PARTIAL')
                          order by created_at desc limit 1` as unknown as Array<{ id: string }>;
  let pages: PageRow[] = [];
  if (scans[0]?.id) {
    pages = await sql`select url,title,content_text from public.website_pages
                      where profile_id=${profile.id}::uuid and scan_id=${scans[0].id}::uuid and status='ANALYZED'
                      order by depth asc, url asc limit 100` as unknown as PageRow[];
  }
  return {
    profileName: profile.name,
    industry: profile.industry,
    websiteUrl: profile.website_url,
    description: brand?.description ?? null,
    businessModel: brand?.business_model ?? null,
    location: brand?.location ?? null,
    serviceArea: brand?.service_area ?? null,
    target: summary(brand?.target_audience),
    tone: summary(brand?.tone_of_voice),
    goals: strings(brand?.goals),
    confirmedWebsiteContent: pages.filter((page) => Boolean(page.content_text)).map((page) => ({ url: page.url, title: page.title, text: page.content_text ?? "" })),
  };
}

function chooseFormat(provider: SocialProvider, recentCount: number): SocialFormat {
  const rotation = FORMAT_ROTATION[provider];
  return rotation[recentCount % rotation.length] ?? "POST";
}

async function recentTopics(sql: Sql, profileId: string) {
  const rows = await sql`select topic from public.content_items where profile_id=${profileId}::uuid order by created_at desc limit 8` as unknown as RecentItemRow[];
  return rows.map((row) => row.topic).filter(Boolean);
}

async function recentVariantCount(sql: Sql, profileId: string, provider: SocialProvider) {
  const rows = await sql`select count(*)::int as count from public.content_variants where profile_id=${profileId}::uuid and provider=${provider}` as unknown as CountRow[];
  return Number(rows[0]?.count ?? 0);
}

async function currentSpend(sql: Sql) {
  const rows = await sql`select coalesce(sum(cost_usd),0)::float8 as spend from public.ai_usage_events
                         where created_at >= ${monthStartIso()}::timestamptz and operation='GENERATE_SOCIAL_TEXT'` as unknown as SpendRow[];
  return Number(rows[0]?.spend ?? 0) || 0;
}

async function currentImageCount(sql: Sql) {
  const rows = await sql`select count(*)::int as count from public.ai_usage_events
                         where created_at >= ${monthStartIso()}::timestamptz and operation='GENERATE_SOCIAL_IMAGE'` as unknown as CountRow[];
  return Number(rows[0]?.count ?? 0) || 0;
}

async function createPlannedContent(input: {
  sql: Sql;
  env: Required<Pick<AutopilotEnv, "OPENAI_API_KEY">> & AutopilotEnv;
  profile: ProfileRow;
  strategy: StrategyRow | undefined;
  provider: SocialProvider;
  scheduledAt: string;
  approvalMode: ApprovalMode;
  budget: { textSpent: number; textLimit: number; imagesUsed: number; imageLimit: number };
}) {
  const { sql, env, profile, strategy, provider, scheduledAt, approvalMode, budget } = input;
  const context = await loadBrandContext(sql, profile);
  if (!context.confirmedWebsiteContent.length) throw new Error("AUTOPILOT_WEBSITE_CONTEXT_MISSING");
  const topics = await recentTopics(sql, profile.id);
  const count = await recentVariantCount(sql, profile.id, provider);
  const format = chooseFormat(provider, count);
  const objective = strings(strategy?.objectives)[0] ?? context.goals[0] ?? null;
  const topic = [
    "Scegli autonomamente un nuovo tema editoriale specifico e utile per questa attività.",
    "Usa esclusivamente i fatti confermati dal sito e dal brand.",
    `Il contenuto è destinato a ${provider} nel formato ${format}.`,
    topics.length ? `Evita di ripetere questi temi recenti: ${topics.join(" | ")}.` : "Evita temi generici e ripetitivi.",
  ].join(" ");
  const upper = estimateTextRequestUpperBoundUsd({ topic, objective, providers: [provider], formats: [format], brand: context });
  if (budget.textSpent >= budget.textLimit || budget.textSpent + upper > budget.textLimit) throw new Error("AUTOPILOT_TEXT_BUDGET_REACHED");

  const generated = await generateSocialText({
    apiKey: env.OPENAI_API_KEY,
    topic,
    objective,
    providers: [provider],
    formats: [format],
    brand: context,
    cacheKey: `post-automatici:${profile.id}`,
  });
  budget.textSpent += generated.usage.estimatedCostUsd ?? 0;
  await sql`insert into public.ai_usage_events (profile_id,operation,model,input_tokens,output_tokens,cost_usd,metadata)
            values (${profile.id}::uuid,'GENERATE_SOCIAL_TEXT',${generated.model},${generated.usage.inputTokens},${generated.usage.outputTokens},${generated.usage.estimatedCostUsd},${JSON.stringify({ openai_response_id: generated.responseId, openai_request_id: generated.requestId, source: "AUTOPILOT", provider, format })}::jsonb)`;

  const variant = generated.content.variants.find((item) => item.provider === provider && item.format === format);
  if (!variant) throw new Error("AUTOPILOT_VARIANT_MISSING");
  const contentId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const now = new Date().toISOString();

  await sql`insert into public.content_items (id,profile_id,topic,objective,title,status,updated_at)
            values (${contentId}::uuid,${profile.id}::uuid,${topic},${objective},${generated.content.strategySummary.slice(0,240)},'IN_REVIEW',${now}::timestamptz)`;
  await sql`insert into public.content_variants (id,content_id,profile_id,provider,format,eligible,hook,caption,cta,hashtags,visual_brief,alt_text,approval_status,updated_at)
            values (${variantId}::uuid,${contentId}::uuid,${profile.id}::uuid,${provider},${format},${variant.eligible},${variant.hook},${variant.caption},${variant.cta},${JSON.stringify(variant.hashtags)}::jsonb,${variant.visualBrief},${variant.altText},'PENDING',${now}::timestamptz)`;

  let imageAssetId: string | null = null;
  if (variant.eligible && budget.imagesUsed < budget.imageLimit) {
    try {
      const image = await generateOpenAIImage({
        apiKey: env.OPENAI_API_KEY,
        profileName: profile.name,
        industry: profile.industry,
        tone: context.tone,
        provider: provider as ImageSocialProvider,
        format: format as ImageSocialFormat,
        visualBrief: variant.visualBrief,
        caption: variant.caption,
      });
      budget.imagesUsed += 1;
      imageAssetId = crypto.randomUUID();
      const dataUrl = `data:${image.mimeType};base64,${image.base64}`;
      await sql`insert into public.ai_usage_events (profile_id,operation,model,input_tokens,output_tokens,cost_usd,metadata)
                values (${profile.id}::uuid,'GENERATE_SOCIAL_IMAGE',${image.model},${image.usage.inputTokens},${image.usage.outputTokens},${image.usage.estimatedCostUsd},${JSON.stringify({ openai_request_id: image.requestId, source: "AUTOPILOT", provider, format, quality: image.quality, size: image.size })}::jsonb)`;
      await sql`insert into public.assets (id,profile_id,source,kind,name,storage_url,mime_type,tags,metadata)
                values (${imageAssetId}::uuid,${profile.id}::uuid,'OPENAI_GPT_IMAGE_2','IMAGE',${`${provider}-${format}-${variantId}.png`},${dataUrl},${image.mimeType},${JSON.stringify([provider,format,"AI_GENERATED","AUTOPILOT"])}::jsonb,${JSON.stringify({ model: image.model, quality: image.quality, size: image.size, openai_request_id: image.requestId, storage_mode: "DATABASE_DATA_URL_V1" })}::jsonb)`;
    } catch (reason) {
      console.error("autopilot-image", { profileId: profile.id, provider, detail: reason instanceof Error ? reason.message : "unknown" });
    }
  }

  const canAutoApprove = approvalMode === "AUTOMATIC" && variant.eligible && Boolean(imageAssetId);
  if (imageAssetId) {
    await sql`update public.content_variants set image_asset_id=${imageAssetId}::uuid, approval_status=${canAutoApprove ? "APPROVED" : "PENDING"}, updated_at=now()
              where id=${variantId}::uuid and profile_id=${profile.id}::uuid`;
  } else if (canAutoApprove) {
    throw new Error("AUTOPILOT_IMAGE_REQUIRED_FOR_AUTO_APPROVAL");
  }
  await sql`update public.content_items set status=${canAutoApprove ? "APPROVED" : "IN_REVIEW"}, updated_at=now()
            where id=${contentId}::uuid and profile_id=${profile.id}::uuid`;

  if (variant.eligible) {
    const jobId = crypto.randomUUID();
    const state = canAutoApprove ? "SCHEDULED" : "BLOCKED_APPROVAL";
    const idempotencyKey = `autopilot:${variantId}:${scheduledAt}`;
    await sql`insert into public.publication_jobs (id,profile_id,variant_id,provider,state,scheduled_at,idempotency_key,attempt_count,updated_at)
              values (${jobId}::uuid,${profile.id}::uuid,${variantId}::uuid,${provider},${state},${scheduledAt}::timestamptz,${idempotencyKey},0,now())
              on conflict (idempotency_key) do nothing`;
    return { scheduled: canAutoApprove, blocked: !canAutoApprove };
  }
  return { scheduled: false, blocked: false };
}

export async function runContentAutopilot(env: AutopilotEnv, options: RunOptions = {}): Promise<RunResult> {
  if (!env.DATABASE_URL) throw new Error("DATABASE_NOT_CONFIGURED");
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_NOT_CONFIGURED");
  const sql = neon(env.DATABASE_URL);
  const maxGenerations = Math.min(Math.max(options.maxGenerations ?? DEFAULT_GENERATIONS_PER_RUN, 1), 50);
  const profiles = options.profileId
    ? await sql`select id,name,website_url,industry,timezone from public.profiles where id=${options.profileId}::uuid and archived_at is null and onboarding_completed=true limit 1` as unknown as ProfileRow[]
    : await sql`select id,name,website_url,industry,timezone from public.profiles where archived_at is null and onboarding_completed=true order by created_at asc limit ${MAX_PROFILES_PER_RUN}` as unknown as ProfileRow[];

  const result: RunResult = { profilesChecked: 0, generated: 0, scheduled: 0, blockedForReview: 0, skipped: 0, errors: [] };
  const budget = { textSpent: await currentSpend(sql), textLimit: textBudget(env), imagesUsed: await currentImageCount(sql), imageLimit: imageLimit(env) };
  const now = new Date();
  const horizon = new Date(now.getTime() + 8 * DAY_MS).toISOString();

  for (const profile of profiles) {
    if (result.generated >= maxGenerations) break;
    result.profilesChecked += 1;
    try {
      await ensureStrategy(sql, profile.id);
      await ensureSchedules(sql, profile);
      const strategies = await sql`select objectives,platform_strategy from public.content_strategies where profile_id=${profile.id}::uuid limit 1` as unknown as StrategyRow[];
      const strategy = strategies[0];
      const settings = settingsFromStrategy(strategy?.platform_strategy);
      if (!settings.enabled) { result.skipped += 1; continue; }
      const schedules = await sql`select provider,timezone,posts_per_week,preferred_slots,auto_choose,enabled from public.schedules
                                  where profile_id=${profile.id}::uuid and provider is not null and enabled=true and posts_per_week>0
                                  order by provider asc` as unknown as ScheduleRow[];

      for (const schedule of schedules) {
        if (result.generated >= maxGenerations) break;
        const desired = Math.min(Math.max(Math.floor(schedule.posts_per_week), 0), 21);
        if (!desired) continue;
        const jobs = await sql`select provider,scheduled_at from public.publication_jobs
                               where profile_id=${profile.id}::uuid and provider=${schedule.provider}
                                 and scheduled_at>${now.toISOString()}::timestamptz and scheduled_at<${horizon}::timestamptz
                                 and state in ('SCHEDULED','BLOCKED_APPROVAL','QUEUED')
                               order by scheduled_at asc` as unknown as JobRow[];
        if (jobs.length >= desired) continue;
        const usedDates = new Set(jobs.map((job) => localDateKey(new Date(job.scheduled_at), schedule.timezone || profile.timezone || "Europe/Rome")));
        const candidates = candidateSlots(schedule, now).filter((slot) => !usedDates.has(localDateKey(new Date(slot), schedule.timezone || profile.timezone || "Europe/Rome")));
        const missing = Math.max(desired - jobs.length, 0);
        for (const slot of candidates.slice(0, missing)) {
          if (result.generated >= maxGenerations) break;
          try {
            const created = await createPlannedContent({ sql, env: env as Required<Pick<AutopilotEnv, "OPENAI_API_KEY">> & AutopilotEnv, profile, strategy, provider: schedule.provider, scheduledAt: slot, approvalMode: settings.approvalMode, budget });
            result.generated += 1;
            if (created.scheduled) result.scheduled += 1;
            if (created.blocked) result.blockedForReview += 1;
          } catch (reason) {
            const detail = reason instanceof Error ? reason.message : "AUTOPILOT_GENERATION_FAILED";
            result.errors.push(`${profile.id}:${schedule.provider}:${detail}`);
            if (detail === "AUTOPILOT_TEXT_BUDGET_REACHED") return result;
          }
        }
      }
    } catch (reason) {
      result.errors.push(`${profile.id}:${reason instanceof Error ? reason.message : "AUTOPILOT_PROFILE_FAILED"}`);
    }
  }
  return result;
}
