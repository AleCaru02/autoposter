import { neon } from "@neondatabase/serverless";
import { ACTIVITY_BUDGET_EUR, activityBudgetBand, type ActivityBudgetBand, type BrainTask, type ContentImportance } from "./ai-brain-policy.js";

const ECB_DAILY_XML = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const FX_CACHE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const CONSERVATIVE_USD_PER_EUR_FALLBACK = 0.80;

type Sql = ReturnType<typeof neon>;

type FxRow = { effective_date: string; usd_per_eur: number | string; source: string };
type MoneyRow = { amount: number | string | null };
type CountRow = { count: number | string | null };

export type ActivityBudgetSnapshot = {
  profileId: string;
  currency: "EUR";
  hardCapEur: number;
  spendEur: number;
  accountedEur: number;
  remainingEur: number;
  monthDailyAverageEur: number;
  last7DailyAverageEur: number;
  averageContentCostEur: number;
  upcomingScheduledCount: number;
  forecastEndOfMonthEur: number;
  band: ActivityBudgetBand;
  fx: {
    usdPerEur: number;
    effectiveDate: string | null;
    source: string;
  };
};

export type ActivityBudgetPreflight = ActivityBudgetSnapshot & {
  allowed: boolean;
  reason: "AI_BUDGET_HARD_STOP" | null;
  preferReuse: boolean;
  allowPremium: boolean;
};

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function monthBounds(now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

function daysInMonth(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
}

function safeUsdPerEur(reference: number) {
  if (!Number.isFinite(reference) || reference <= 0) return CONSERVATIVE_USD_PER_EUR_FALLBACK;
  // Never let currency conversion make the safety budget less conservative than 1:1.
  // When EUR trades below USD, use the actual ECB rate with a 2% safety haircut.
  return Math.min(1, reference * 0.98);
}

function parseEcbUsdRate(xml: string) {
  const rateMatch = xml.match(/currency=['"]USD['"]\s+rate=['"]([0-9.]+)['"]/i);
  const dateMatch = xml.match(/<Cube\s+time=['"]([0-9]{4}-[0-9]{2}-[0-9]{2})['"]/i);
  if (!rateMatch) return null;
  const rate = Number(rateMatch[1]);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return { rate, date: dateMatch?.[1] ?? new Date().toISOString().slice(0, 10) };
}

async function latestFx(sql: Sql) {
  const rows = await sql`
    select effective_date::text, usd_per_eur, source
    from public.ai_fx_rates
    where base_currency='EUR' and quote_currency='USD'
    order by effective_date desc
    limit 1
  ` as unknown as FxRow[];
  return rows[0] ?? null;
}

async function resolveUsdPerEur(sql: Sql, now: Date, fetcher: typeof fetch) {
  let cached = await latestFx(sql);
  const cachedTime = cached ? Date.parse(`${cached.effective_date}T16:00:00Z`) : Number.NaN;
  const freshEnough = Number.isFinite(cachedTime) && now.getTime() - cachedTime <= FX_CACHE_MAX_AGE_MS;
  if (!freshEnough) {
    try {
      const response = await fetcher(ECB_DAILY_XML, { headers: { accept: "application/xml,text/xml;q=0.9,*/*;q=0.1" } });
      if (response.ok) {
        const parsed = parseEcbUsdRate(await response.text());
        if (parsed) {
          await sql`
            insert into public.ai_fx_rates(base_currency,quote_currency,effective_date,usd_per_eur,source,updated_at)
            values ('EUR','USD',${parsed.date}::date,${parsed.rate},'ECB_REFERENCE',now())
            on conflict (base_currency,quote_currency,effective_date)
            do update set usd_per_eur=excluded.usd_per_eur,source=excluded.source,updated_at=now()
          `;
          cached = { effective_date: parsed.date, usd_per_eur: parsed.rate, source: "ECB_REFERENCE" };
        }
      }
    } catch {
      // Use the last stored official rate below; if none exists use a deliberately conservative fallback.
    }
  }
  const reference = cached ? number(cached.usd_per_eur) : 0;
  return {
    usdPerEur: safeUsdPerEur(reference),
    effectiveDate: cached?.effective_date ?? null,
    source: cached ? cached.source : "CONSERVATIVE_FALLBACK",
  };
}

export async function activityBudgetSnapshot(input: {
  databaseUrl: string;
  profileId: string;
  now?: Date;
  fetcher?: typeof fetch;
}): Promise<ActivityBudgetSnapshot> {
  if (!input.databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  if (!input.profileId) throw new Error("PROFILE_ID_REQUIRED");
  const now = input.now ?? new Date();
  const fetcher = input.fetcher ?? fetch;
  const sql = neon(input.databaseUrl);
  const { start, end } = monthBounds(now);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fx = await resolveUsdPerEur(sql, now, fetcher);

  const [actualRows, accountedRows, recentRows, contentRows, upcomingRows] = await Promise.all([
    sql`select coalesce(sum(cost_usd),0)::float8 amount from public.ai_usage_events where profile_id=${input.profileId}::uuid and created_at>=${start.toISOString()}::timestamptz and created_at<${end.toISOString()}::timestamptz` as unknown as MoneyRow[],
    sql`select coalesce(sum(greatest(reserved_usd,coalesce(actual_usd,0))),0)::float8 amount from public.provider_cost_attempts where profile_id=${input.profileId}::uuid and period_start=${start.toISOString()}::timestamptz and period_end=${end.toISOString()}::timestamptz` as unknown as MoneyRow[],
    sql`select coalesce(sum(cost_usd),0)::float8 amount from public.ai_usage_events where profile_id=${input.profileId}::uuid and created_at>=${sevenDaysAgo.toISOString()}::timestamptz and created_at<=${now.toISOString()}::timestamptz` as unknown as MoneyRow[],
    sql`select count(distinct nullif(metadata->>'logical_usage_event_id',''))::int count from public.ai_usage_events where profile_id=${input.profileId}::uuid and created_at>=${start.toISOString()}::timestamptz and created_at<${end.toISOString()}::timestamptz` as unknown as CountRow[],
    sql`select count(*)::int count from public.publication_jobs where profile_id=${input.profileId}::uuid and scheduled_at>${now.toISOString()}::timestamptz and scheduled_at<${end.toISOString()}::timestamptz and state in ('SCHEDULED','BLOCKED_APPROVAL','QUEUED')` as unknown as CountRow[],
  ]);

  const actualUsd = number(actualRows[0]?.amount);
  const accountedUsd = Math.max(actualUsd, number(accountedRows[0]?.amount));
  const recentUsd = number(recentRows[0]?.amount);
  const contentUnits = Math.max(0, Math.floor(number(contentRows[0]?.count)));
  const upcomingScheduledCount = Math.max(0, Math.floor(number(upcomingRows[0]?.count)));
  const spendEur = actualUsd / fx.usdPerEur;
  const accountedEur = accountedUsd / fx.usdPerEur;
  const day = Math.max(1, now.getUTCDate());
  const totalDays = daysInMonth(now);
  const remainingDays = Math.max(0, totalDays - day);
  const monthDailyAverageEur = spendEur / day;
  const last7DailyAverageEur = (recentUsd / fx.usdPerEur) / Math.min(7, day);
  const averageContentCostEur = contentUnits > 0 ? spendEur / contentUnits : 0;
  const velocityForecast = spendEur + Math.max(monthDailyAverageEur, last7DailyAverageEur) * remainingDays;
  const calendarForecast = spendEur + averageContentCostEur * upcomingScheduledCount;
  const forecastEndOfMonthEur = Math.max(spendEur, velocityForecast, calendarForecast);
  const remainingEur = Math.max(ACTIVITY_BUDGET_EUR.hardCap - accountedEur, 0);

  return {
    profileId: input.profileId,
    currency: "EUR",
    hardCapEur: ACTIVITY_BUDGET_EUR.hardCap,
    spendEur,
    accountedEur,
    remainingEur,
    monthDailyAverageEur,
    last7DailyAverageEur,
    averageContentCostEur,
    upcomingScheduledCount,
    forecastEndOfMonthEur,
    band: activityBudgetBand(accountedEur),
    fx,
  };
}

export async function preflightActivityBudget(input: {
  databaseUrl: string;
  profileId: string;
  task: BrainTask;
  importance?: ContentImportance;
  now?: Date;
  fetcher?: typeof fetch;
}): Promise<ActivityBudgetPreflight> {
  const snapshot = await activityBudgetSnapshot(input);
  const band = snapshot.band;
  const allowed = band !== "HARD_STOP";
  const highForecast = snapshot.forecastEndOfMonthEur > ACTIVITY_BUDGET_EUR.ordinaryTargetStart;
  return {
    ...snapshot,
    allowed,
    reason: allowed ? null : "AI_BUDGET_HARD_STOP",
    preferReuse: highForecast || band !== "NORMAL",
    allowPremium: allowed && band !== "EMERGENCY_ONLY" && (band === "NORMAL" || input.importance === "PREMIUM" || input.importance === "CRITICAL"),
  };
}
