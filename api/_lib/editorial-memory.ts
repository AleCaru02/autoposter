import type { SocialFormat, SocialProvider } from "./openai-text.js";

export type ProfileType = "BUSINESS" | "PERSONAL_BRAND";

export type EditorialMemoryRecentContent = {
  id: string;
  topic: string;
  angle: string | null;
  pillar: string | null;
  hook: string | null;
  cta: string | null;
  provider: SocialProvider | null;
  format: SocialFormat | null;
  visualArchetype: string | null;
  subjectStrategy: string | null;
  seriesId: string | null;
  sequenceNumber: number | null;
  nextTopicIntent: string | null;
  continuityReason: string | null;
  createdAt: string;
  publishedAt: string | null;
  sourceRefs: unknown;
};

export type EditorialMemoryFeedback = {
  code: string;
  note: string | null;
  weight: number;
  createdAt: string;
};

export type EditorialMemoryLearning = {
  dimension: string;
  value: string;
  confidence: string;
  upliftPct: number;
  sampleSize: number;
};

export type EditorialMemoryCalendarItem = {
  provider: SocialProvider;
  format: SocialFormat | null;
  scheduledAt: string;
  state: string;
  topic: string | null;
};

export type EditorialMemorySnapshot = {
  version: 1;
  profileType: ProfileType;
  builtAt: string;
  sourceContentCount: number;
  recent: {
    topics: string[];
    hooks: string[];
    ctas: string[];
    pillars: Array<{ value: string; count: number }>;
    formats: Array<{ value: string; count: number }>;
    visualArchetypes: Array<{ value: string; count: number }>;
    subjects: Array<{ value: string; count: number }>;
    productsOrServices: string[];
    sources: string[];
  };
  balance: {
    strategyPillars: string[];
    underusedPillars: string[];
    overusedPillars: string[];
  };
  continuity: {
    activeSeries: Array<{
      seriesId: string;
      lastContentId: string;
      sequenceNumber: number;
      nextTopicIntent: string;
      continuityReason: string | null;
    }>;
    suggestedNextTopicIntent: string | null;
  };
  feedback: {
    weightedSignals: Array<{ code: string; score: number; count: number; lastSeenAt: string }>;
    recentNotes: string[];
  };
  calendar: {
    futureCount: number;
    providers: Array<{ value: string; count: number }>;
    formats: Array<{ value: string; count: number }>;
  };
  learning: EditorialMemoryLearning[];
};

type Sql = any;

function clean(value: unknown, max = 240) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function unique(values: Array<string | null | undefined>, max = 24) {
  return [...new Set(values.map((value) => clean(value)).filter(Boolean))].slice(0, max);
}

function counts(values: Array<string | null | undefined>, max = 20) {
  const map = new Map<string, number>();
  for (const raw of values) {
    const value = clean(raw, 160);
    if (!value) continue;
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, max);
}

function urlsFrom(value: unknown, out = new Set<string>(), depth = 0) {
  if (depth > 4 || out.size >= 40 || value == null) return [...out];
  if (typeof value === "string") {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" || url.protocol === "http:") out.add(url.toString());
    } catch { /* not a url */ }
    return [...out];
  }
  if (Array.isArray(value)) for (const item of value) urlsFrom(item, out, depth + 1);
  else if (typeof value === "object") for (const item of Object.values(value as Record<string, unknown>)) urlsFrom(item, out, depth + 1);
  return [...out];
}

function decayWeight(createdAt: string, weight: number, now: Date) {
  const timestamp = Date.parse(createdAt);
  const ageDays = Number.isFinite(timestamp) ? Math.max(0, (now.getTime() - timestamp) / 86_400_000) : 365;
  return Math.max(0.05, weight) * Math.exp(-ageDays / 45);
}

export function buildEditorialMemorySnapshot(input: {
  profileType: ProfileType;
  recent: EditorialMemoryRecentContent[];
  feedback: EditorialMemoryFeedback[];
  strategyPillars?: string[];
  calendar?: EditorialMemoryCalendarItem[];
  learning?: EditorialMemoryLearning[];
  now?: Date;
}): EditorialMemorySnapshot {
  const now = input.now ?? new Date();
  const strategyPillars = unique(input.strategyPillars ?? [], 20);
  const pillarCounts = counts(input.recent.map((row) => row.pillar));
  const countByPillar = new Map(pillarCounts.map((row) => [row.value.toLowerCase(), row.count]));
  const underusedPillars = strategyPillars
    .map((pillar) => ({ pillar, count: countByPillar.get(pillar.toLowerCase()) ?? 0 }))
    .sort((a, b) => a.count - b.count || a.pillar.localeCompare(b.pillar))
    .filter((row, index, all) => row.count <= Math.max(0, all[0]?.count ?? 0) + 1)
    .slice(0, 4)
    .map((row) => row.pillar);
  const maxPillarCount = pillarCounts[0]?.count ?? 0;
  const overusedPillars = maxPillarCount >= 3
    ? pillarCounts.filter((row) => row.count >= Math.max(3, maxPillarCount - 1)).map((row) => row.value).slice(0, 3)
    : [];

  const series = new Map<string, EditorialMemoryRecentContent>();
  for (const row of input.recent) {
    if (!row.seriesId || !clean(row.nextTopicIntent)) continue;
    const previous = series.get(row.seriesId);
    if (!previous || Date.parse(row.createdAt) > Date.parse(previous.createdAt)) series.set(row.seriesId, row);
  }
  const activeSeries = [...series.entries()]
    .map(([seriesId, row]) => ({
      seriesId,
      lastContentId: row.id,
      sequenceNumber: Math.max(1, row.sequenceNumber ?? 1),
      nextTopicIntent: clean(row.nextTopicIntent, 300),
      continuityReason: clean(row.continuityReason, 300) || null,
    }))
    .filter((row) => Boolean(row.nextTopicIntent))
    .slice(0, 8);

  const feedbackMap = new Map<string, { score: number; count: number; lastSeenAt: string }>();
  for (const item of input.feedback) {
    const code = clean(item.code, 80).toUpperCase();
    if (!code) continue;
    const weighted = decayWeight(item.createdAt, Number.isFinite(item.weight) ? item.weight : 1, now);
    const current = feedbackMap.get(code) ?? { score: 0, count: 0, lastSeenAt: item.createdAt };
    current.score += weighted;
    current.count += 1;
    if (Date.parse(item.createdAt) > Date.parse(current.lastSeenAt)) current.lastSeenAt = item.createdAt;
    feedbackMap.set(code, current);
  }
  const weightedSignals = [...feedbackMap.entries()]
    .map(([code, value]) => ({ code, score: Math.round(value.score * 1000) / 1000, count: value.count, lastSeenAt: value.lastSeenAt }))
    .sort((a, b) => b.score - a.score || b.count - a.count)
    .slice(0, 10);

  const calendar = input.calendar ?? [];
  const subjectCounts = counts(input.recent.map((row) => row.subjectStrategy));
  const visualCounts = counts(input.recent.map((row) => row.visualArchetype));

  return {
    version: 1,
    profileType: input.profileType,
    builtAt: now.toISOString(),
    sourceContentCount: input.recent.length,
    recent: {
      topics: unique(input.recent.map((row) => row.topic), 40),
      hooks: unique(input.recent.map((row) => row.hook), 30),
      ctas: unique(input.recent.map((row) => row.cta), 24),
      pillars: pillarCounts,
      formats: counts(input.recent.map((row) => row.format)),
      visualArchetypes: visualCounts,
      subjects: subjectCounts,
      productsOrServices: [],
      sources: unique(input.recent.flatMap((row) => urlsFrom(row.sourceRefs)), 30),
    },
    balance: {
      strategyPillars,
      underusedPillars,
      overusedPillars,
    },
    continuity: {
      activeSeries,
      suggestedNextTopicIntent: activeSeries[0]?.nextTopicIntent ?? null,
    },
    feedback: {
      weightedSignals,
      recentNotes: unique(input.feedback.map((item) => item.note), 12),
    },
    calendar: {
      futureCount: calendar.length,
      providers: counts(calendar.map((item) => item.provider)),
      formats: counts(calendar.map((item) => item.format)),
    },
    learning: (input.learning ?? []).slice(0, 12),
  };
}

export function buildEditorialMemoryInstruction(memory: EditorialMemorySnapshot) {
  const parts = [
    "MEMORIA SMM DEL PROFILO — usa questi segnali prima di decidere il prossimo contenuto.",
    `Profile type: ${memory.profileType}.`,
    memory.recent.topics.length ? `Temi recenti da non duplicare: ${memory.recent.topics.slice(0, 12).join(" | ")}.` : null,
    memory.recent.hooks.length ? `Hook recenti da non riciclare quasi uguali: ${memory.recent.hooks.slice(0, 8).join(" | ")}.` : null,
    memory.recent.ctas.length ? `CTA recenti: ${memory.recent.ctas.slice(0, 8).join(" | ")}. Evita ripetizione meccanica.` : null,
    memory.balance.underusedPillars.length ? `Pillar relativamente trascurati: ${memory.balance.underusedPillars.join(" | ")}. Considerali se coerenti con obiettivo e calendario.` : null,
    memory.balance.overusedPillars.length ? `Pillar recentemente sovrautilizzati: ${memory.balance.overusedPillars.join(" | ")}. Non insistere senza motivo.` : null,
    memory.recent.subjects.length ? `Subject recenti: ${memory.recent.subjects.slice(0, 8).map((item) => `${item.value}×${item.count}`).join(", ")}. Mantieni varietà.` : null,
    memory.recent.visualArchetypes.length ? `Archetipi visual recenti: ${memory.recent.visualArchetypes.slice(0, 8).map((item) => `${item.value}×${item.count}`).join(", ")}. Non ripetere sempre la stessa composizione.` : null,
    memory.continuity.suggestedNextTopicIntent ? `Continuità disponibile: ${memory.continuity.suggestedNextTopicIntent}. Usala solo se è il naturale prossimo passo, non forzare una serie.` : null,
    memory.feedback.weightedSignals.length ? `Feedback ricorrente ponderato per recenza/frequenza: ${memory.feedback.weightedSignals.slice(0, 6).map((item) => `${item.code}(score ${item.score}, n=${item.count})`).join(", ")}. Una singola rejection non è una regola permanente.` : null,
    memory.learning.length ? `Learning affidabile disponibile: ${memory.learning.slice(0, 6).map((item) => `${item.dimension}=${item.value} [${item.confidence}, n=${item.sampleSize}]`).join("; ")}.` : null,
    memory.calendar.futureCount ? `Calendario futuro: ${memory.calendar.futureCount} contenuti/job già presenti. Bilancia il feed rispetto a ciò che è già programmato.` : null,
  ].filter(Boolean);
  return parts.join("\n");
}

export async function refreshProfileEditorialMemory(input: {
  sql: Sql;
  profileId: string;
  profileType: ProfileType;
  strategyPillars?: string[];
  now?: Date;
}) {
  const { sql, profileId, profileType } = input;
  const recent = await sql`
    select
      ci.id::text as id,
      ci.topic,
      ci.title as angle,
      ci.pillar,
      ci.series_id::text as series_id,
      ci.sequence_number,
      ci.next_topic_intent,
      ci.continuity_reason,
      ci.visual_archetype,
      ci.subject_strategy,
      ci.source_refs,
      ci.created_at::text,
      cv.hook,
      cv.cta,
      cv.provider,
      cv.format,
      cv.published_at::text
    from public.content_items ci
    left join lateral (
      select hook,cta,provider,format,published_at
      from public.content_variants
      where profile_id=ci.profile_id and content_id=ci.id
      order by created_at asc
      limit 1
    ) cv on true
    where ci.profile_id=${profileId}::uuid
    order by ci.created_at desc
    limit 60
  ` as unknown as Array<{
    id:string; topic:string; angle:string|null; pillar:string|null; series_id:string|null; sequence_number:number|null;
    next_topic_intent:string|null; continuity_reason:string|null; visual_archetype:string|null; subject_strategy:string|null;
    source_refs:unknown; created_at:string; hook:string|null; cta:string|null; provider:SocialProvider|null; format:SocialFormat|null; published_at:string|null;
  }>;

  const feedback = await sql`
    select feedback_code,note,weight::float8 as weight,created_at::text
    from public.content_feedback_events
    where profile_id=${profileId}::uuid
    order by created_at desc
    limit 80
  ` as unknown as Array<{feedback_code:string;note:string|null;weight:number;created_at:string}>;

  const calendar = await sql`
    select j.provider,cv.format,j.scheduled_at::text,j.state,ci.topic
    from public.publication_jobs j
    join public.content_variants cv on cv.id=j.variant_id and cv.profile_id=j.profile_id
    join public.content_items ci on ci.id=cv.content_id and ci.profile_id=cv.profile_id
    where j.profile_id=${profileId}::uuid
      and j.scheduled_at>=now()
      and j.state in ('SCHEDULED','QUEUED','BLOCKED_APPROVAL')
    order by j.scheduled_at asc
    limit 80
  ` as unknown as EditorialMemoryCalendarItem[];

  const learning = await sql`
    select dimension,dimension_value as value,confidence,uplift_pct::float8 as uplift_pct,sample_size
    from public.learning_insights
    where profile_id=${profileId}::uuid
      and active=true
      and source_type='PROVIDER_API'
      and confidence in ('MEDIUM','HIGH')
    order by confidence desc,uplift_pct desc
    limit 20
  ` as unknown as EditorialMemoryLearning[];

  const snapshot = buildEditorialMemorySnapshot({
    profileType,
    strategyPillars: input.strategyPillars,
    recent: recent.map((row) => ({
      id:row.id,topic:row.topic,angle:row.angle,pillar:row.pillar,hook:row.hook,cta:row.cta,provider:row.provider,format:row.format,
      visualArchetype:row.visual_archetype,subjectStrategy:row.subject_strategy,seriesId:row.series_id,sequenceNumber:row.sequence_number,
      nextTopicIntent:row.next_topic_intent,continuityReason:row.continuity_reason,createdAt:row.created_at,publishedAt:row.published_at,sourceRefs:row.source_refs,
    })),
    feedback: feedback.map((row) => ({code:row.feedback_code,note:row.note,weight:Number(row.weight),createdAt:row.created_at})),
    calendar,
    learning,
    now: input.now,
  });

  await sql`
    insert into public.profile_editorial_memory(profile_id,memory_version,snapshot,source_content_count,refreshed_at,updated_at)
    values(${profileId}::uuid,1,${JSON.stringify(snapshot)}::jsonb,${snapshot.sourceContentCount},now(),now())
    on conflict(profile_id) do update set
      memory_version=excluded.memory_version,
      snapshot=excluded.snapshot,
      source_content_count=excluded.source_content_count,
      refreshed_at=excluded.refreshed_at,
      updated_at=excluded.updated_at
  `;

  return snapshot;
}


export type ContinuityDecision =
  | { mode: "STANDALONE"; seriesId: null; sequenceNumber: null; previousContentId: null; nextTopicIntent: null; continuityReason: null }
  | { mode: "START_SERIES"; seriesId: string; sequenceNumber: 1; previousContentId: null; nextTopicIntent: string; continuityReason: string }
  | { mode: "CONTINUE_SERIES"; seriesId: string; sequenceNumber: number; previousContentId: string; nextTopicIntent: string | null; continuityReason: string };

function topicTokens(value: string) {
  return new Set(value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").split(/[^a-z0-9]+/).filter((part)=>part.length>=4));
}

function topicOverlap(a: string, b: string) {
  const left=topicTokens(a); const right=topicTokens(b);
  if(!left.size||!right.size)return 0;
  let common=0; for(const token of left) if(right.has(token)) common+=1;
  return common/Math.min(left.size,right.size);
}

export function deriveContinuityDecision(input:{
  memory:EditorialMemorySnapshot;
  profileType:ProfileType;
  contentType:string;
  intent:string;
  topic:string;
}):ContinuityDecision {
  const active=input.memory.continuity.activeSeries
    .map((series)=>({series,score:topicOverlap(input.topic,series.nextTopicIntent)}))
    .sort((a,b)=>b.score-a.score)[0];
  if(active && active.score>=0.34){
    const shouldContinueAgain = input.contentType==="STORYTELLING" || input.intent==="CASE_STUDY";
    return {
      mode:"CONTINUE_SERIES",
      seriesId:active.series.seriesId,
      sequenceNumber:active.series.sequenceNumber+1,
      previousContentId:active.series.lastContentId,
      nextTopicIntent:shouldContinueAgain
        ? `Prosegui naturalmente dopo “${clean(input.topic,180)}” mostrando il passaggio, la conseguenza o la lezione successiva senza ripetere ciò che è già stato detto.`
        : null,
      continuityReason:`Il nuovo tema sviluppa il nextTopicIntent della serie attiva (overlap ${active.score.toFixed(2)}).`,
    };
  }

  const seriesWorthy=input.contentType==="STORYTELLING" || input.intent==="CASE_STUDY";
  if(seriesWorthy){
    return {
      mode:"START_SERIES",
      seriesId:crypto.randomUUID(),
      sequenceNumber:1,
      previousContentId:null,
      nextTopicIntent:input.profileType==="PERSONAL_BRAND"
        ? `Continua il percorso personale dopo “${clean(input.topic,180)}” con ciò che è successo, ciò che è stato imparato o il passaggio successivo.`
        : `Approfondisci “${clean(input.topic,180)}” con il processo, la conseguenza o il caso successivo senza ripetere il contenuto iniziale.`,
      continuityReason:`Contenuto ${input.contentType}/${input.intent} adatto a una serie; la serie nasce solo perché esiste un naturale passo successivo.`,
    };
  }

  return {mode:"STANDALONE",seriesId:null,sequenceNumber:null,previousContentId:null,nextTopicIntent:null,continuityReason:null};
}
