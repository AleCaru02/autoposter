import { neon } from "@neondatabase/serverless";

type PlanItem = { dayOffset?: unknown; provider?: unknown; contentType?: unknown };
type CostBasis = { capability: string; eurPerOperation: number; source: "HISTORICAL" | "CONFIGURED_RESERVE"; samples: number };
type Breakdown = {
  strategyPlanningEur: number;
  copyAdaptationsEur: number;
  researchFactCheckEur: number;
  visualAiEur: number;
  qaEur: number;
  reserveEur: number;
};

export type AiBudgetRecommendation = {
  profileId: string;
  mode: "ESTIMATED" | "DATA_DRIVEN";
  activeSocials: number;
  monthlyChannelSlots: number;
  plannedImageOperations: number;
  minimumOperationalEur: number;
  recommendedEur: number;
  intensiveEur: number;
  breakdown: Breakdown;
  costBasis: CostBasis[];
  explanation: string;
  assumptions: string[];
};

type ScheduleRow = { provider: string; posts_per_week: number | string; enabled: boolean };
type StrategyRow = { platform_strategy: unknown };
type HistoryRow = { capability_key: string; samples: number | string; avg_eur: number | string };
type ReserveRow = { capability_key: string; reserve_usd: number | string; fx_rate: number | string };
type UsageMixRow = { text_attempts: number | string; image_attempts: number | string };
type AssetMixRow = { total_images: number | string; ai_images: number | string };

function n(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}
function money(value: number) { return Math.round(Math.max(value, 0) * 100) / 100; }
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function planItems(strategy: unknown): PlanItem[] {
  const items = object(object(strategy).aiEditorialPlan).items;
  return Array.isArray(items) ? items.filter((item): item is PlanItem => Boolean(item && typeof item === "object")) : [];
}

export function calculateAiBudgetRecommendation(input: {
  profileId: string;
  schedules: ScheduleRow[];
  platformStrategy: unknown;
  history: HistoryRow[];
  reserves: ReserveRow[];
  usageMix: UsageMixRow | null;
  assetMix: AssetMixRow | null;
}): AiBudgetRecommendation {
  const enabledSchedules = input.schedules.filter((row) => row.enabled && n(row.posts_per_week) > 0);
  const activeSocials = new Set(enabledSchedules.map((row) => row.provider)).size;
  const scheduleSlots = enabledSchedules.reduce((sum, row) => sum + n(row.posts_per_week), 0) * 52 / 12;

  const items = planItems(input.platformStrategy);
  const validOffsets = items.map((item) => n(item.dayOffset, Number.NaN)).filter(Number.isFinite);
  const horizonDays = validOffsets.length ? Math.max(7, Math.max(...validOffsets) + 1) : 0;
  const planMonthlySlots = horizonDays ? items.length * 30 / horizonDays : 0;
  const monthlyChannelSlots = Math.max(scheduleSlots, planMonthlySlots);

  const historyByCapability = new Map(input.history.map((row) => [row.capability_key, { samples: Math.floor(n(row.samples)), avgEur: n(row.avg_eur) }]));
  const reserveByCapability = new Map(input.reserves.map((row) => [row.capability_key, n(row.reserve_usd) * n(row.fx_rate, 1)]));

  const basisFor = (capability: string): CostBasis => {
    const history = historyByCapability.get(capability);
    if (history && history.samples >= 5 && history.avgEur > 0) {
      return { capability, eurPerOperation: history.avgEur, source: "HISTORICAL", samples: history.samples };
    }
    return { capability, eurPerOperation: reserveByCapability.get(capability) ?? 0, source: "CONFIGURED_RESERVE", samples: history?.samples ?? 0 };
  };

  const textBasis = basisFor("ai.content.generate_text");
  const imageBasis = basisFor("ai.image.generate");
  const strategyBasis = basisFor("ai.strategy.generate");

  const textAttempts = n(input.usageMix?.text_attempts);
  const imageAttempts = n(input.usageMix?.image_attempts);
  const historicalImageRate = textAttempts >= 5 ? Math.min(1, imageAttempts / Math.max(textAttempts, 1)) : null;
  const explicitVisualItems = items.filter((item) => ["CAROUSEL", "STORYTELLING", "SINGLE_STORY"].includes(String(item.contentType ?? ""))).length;
  const plannedVisualRate = items.length ? explicitVisualItems / items.length : 0;
  const imageRate = historicalImageRate ?? plannedVisualRate;

  const totalImages = n(input.assetMix?.total_images);
  const aiImages = n(input.assetMix?.ai_images);
  const realAssetReuseRate = totalImages >= 5 ? Math.max(0, Math.min(0.8, (totalImages - aiImages) / totalImages)) : 0;
  const plannedImageOperations = monthlyChannelSlots * imageRate * (1 - realAssetReuseRate);

  const strategy = object(input.platformStrategy);
  const economics = object(strategy.aiEconomics);
  const strategyRefreshDays = Math.max(1, n(economics.strategyRefreshDays, 30));
  const strategyOps = Math.max(1, 30 / strategyRefreshDays);

  // Research/fact-check and QA are already part of the text pipeline technical
  // events. They are not added a second time here; their real cost is included
  // in historical text averages, while the configured text reserve is the
  // conservative pre-history ceiling.
  const strategyPlanningEur = strategyOps * strategyBasis.eurPerOperation;
  const copyAdaptationsEur = monthlyChannelSlots * textBasis.eurPerOperation;
  const visualAiEur = plannedImageOperations * imageBasis.eurPerOperation;
  const researchFactCheckEur = 0;
  const qaEur = 0;
  const base = strategyPlanningEur + copyAdaptationsEur + visualAiEur;
  const reserveEur = base * 0.08;
  const recommendedEur = base + reserveEur;
  const minimumOperationalEur = base * 0.72;
  const intensiveEur = base * 1.45;

  const dataDriven = [textBasis, imageBasis, strategyBasis].filter((basis) => basis.source === "HISTORICAL").length >= 2;
  const assumptions: string[] = [];
  if (!dataDriven) assumptions.push("Stima pre-storico: usa i reserve provider configurati dove non esistono almeno 5 operazioni reali.");
  if (historicalImageRate === null) assumptions.push("Mix immagini stimato dal piano editoriale persistito; verrà sostituito dal mix reale appena disponibile.");
  if (realAssetReuseRate === 0) assumptions.push("Nessuna riduzione per riuso asset applicata senza uno storico sufficiente.");
  assumptions.push("Research/fact-check e QA non vengono conteggiati due volte: sono inclusi nel costo reale/riservato della pipeline testo.");

  const explanation = `Stima per questa attività: ${activeSocials} social con circa ${Math.round(monthlyChannelSlots)} slot-canale/mese e circa ${Math.round(plannedImageOperations)} nuove generazioni immagine. ${dataDriven ? "Il calcolo usa prevalentemente costi storici reali." : "Dove lo storico non è sufficiente usa i reserve provider configurati come stima conservativa."}`;

  return {
    profileId: input.profileId,
    mode: dataDriven ? "DATA_DRIVEN" : "ESTIMATED",
    activeSocials,
    monthlyChannelSlots: money(monthlyChannelSlots),
    plannedImageOperations: money(plannedImageOperations),
    minimumOperationalEur: money(minimumOperationalEur),
    recommendedEur: money(recommendedEur),
    intensiveEur: money(intensiveEur),
    breakdown: {
      strategyPlanningEur: money(strategyPlanningEur),
      copyAdaptationsEur: money(copyAdaptationsEur),
      researchFactCheckEur,
      visualAiEur: money(visualAiEur),
      qaEur,
      reserveEur: money(reserveEur),
    },
    costBasis: [textBasis, imageBasis, strategyBasis],
    explanation,
    assumptions,
  };
}

export class AiBudgetRecommendationEngine {
  private readonly sql: ReturnType<typeof neon>;
  constructor(databaseUrl: string) {
    if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
    this.sql = neon(databaseUrl);
  }

  async recommend(profileId: string): Promise<AiBudgetRecommendation> {
    const schedules = await this.sql`
      select provider,posts_per_week,enabled
      from public.schedules
      where profile_id=${profileId}::uuid
    ` as unknown as ScheduleRow[];
    const strategies = await this.sql`
      select platform_strategy
      from public.content_strategies
      where profile_id=${profileId}::uuid
      limit 1
    ` as unknown as StrategyRow[];

    const history = await this.sql`
      select capability_key,count(*)::int as samples,
             avg(greatest(reserved_usd,coalesce(actual_usd,0))*fx_usd_to_eur_rate)::float8 as avg_eur
      from public.provider_cost_attempts
      where profile_id=${profileId}::uuid
        and provider_started_at>=now()-interval '90 days'
      group by capability_key
    ` as unknown as HistoryRow[];

    const reserves = await this.sql`
      select c.capability_key,c.provider_attempt_reserve_usd::float8 as reserve_usd,
             coalesce(p.usd_to_eur_rate,1)::float8 as fx_rate
      from public.profile_entitlement_package_assignments a
      join public.entitlement_package_capabilities c
        on c.package_key=a.package_key and c.package_version=a.package_version
      left join public.activity_ai_budget_policies p on p.profile_id=a.profile_id
      where a.profile_id=${profileId}::uuid and a.revoked_at is null
        and c.capability_key in ('ai.content.generate_text','ai.image.generate','ai.strategy.generate')
        and c.enabled=true
    ` as unknown as ReserveRow[];

    const mixRows = await this.sql`
      select
        count(*) filter(where capability_key='ai.content.generate_text')::int as text_attempts,
        count(*) filter(where capability_key='ai.image.generate')::int as image_attempts
      from public.provider_cost_attempts
      where profile_id=${profileId}::uuid
        and provider_started_at>=now()-interval '90 days'
    ` as unknown as UsageMixRow[];

    const assetRows = await this.sql`
      select count(*) filter(where kind='IMAGE')::int as total_images,
             count(*) filter(where kind='IMAGE' and source='AI_IMAGE')::int as ai_images
      from public.assets
      where profile_id=${profileId}::uuid
        and created_at>=now()-interval '90 days'
    ` as unknown as AssetMixRow[];

    return calculateAiBudgetRecommendation({
      profileId,
      schedules,
      platformStrategy: strategies[0]?.platform_strategy ?? {},
      history,
      reserves,
      usageMix: mixRows[0] ?? null,
      assetMix: assetRows[0] ?? null,
    });
  }
}
