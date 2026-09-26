import assert from "node:assert/strict";
import fs from "node:fs";
import { buildFeedbackLoopRecords, type MetricSnapshotRecord } from "../api/_lib/feedback-loop.js";
import { buildAutopilotLearningInstruction, learnedFormatPreference, learnedTimingPreference, learningContext, type PersistedLearningInsight } from "../api/_lib/learning-guidance.js";
import { candidateSlots } from "../api/_lib/autopilot.js";
import { generateOpenAIPlan, type OpenAIStrategy } from "../api/_lib/openai-strategy-planner.js";

const profileId = "11111111-1111-4111-8111-111111111111";
const otherProfileId = "22222222-2222-4222-8222-222222222222";
const snapshots: MetricSnapshotRecord[] = Array.from({ length: 12 }, (_, index) => {
  const strong = index < 6;
  return {
    profile_id: profileId,
    provider: strong ? "INSTAGRAM" : "FACEBOOK",
    external_post_id: `${strong ? "ig" : "fb"}-post-${index}`,
    format: strong ? "STORY" : "POST",
    topic: strong ? "Case study proprietari" : "Notizie generiche",
    published_at: new Date(Date.UTC(2026, 8, 1 + index, strong ? 16 : 8)).toISOString(),
    captured_at: new Date(Date.UTC(2026, 8, 2 + index, 10)).toISOString(),
    metrics: strong
      ? { reach: 1000, likes: 100, comments: 20, shares: 12, saves: 18, clicks: 25 }
      : { reach: 1000, likes: 8, comments: 1, shares: 0, saves: 0, clicks: 2 },
  };
});

const feedback = buildFeedbackLoopRecords(profileId, snapshots, { generatedAt: "2026-09-17T10:00:00.000Z" });
assert.equal(feedback.result.status, "READY");
const rows = feedback.records as PersistedLearningInsight[];
assert.ok(rows.some((row) => row.dimension === "PROVIDER" && row.dimension_value === "INSTAGRAM" && row.confidence === "MEDIUM"));
assert.ok(rows.some((row) => row.dimension === "FORMAT" && row.dimension_value === "STORY"));
assert.ok(rows.some((row) => row.dimension === "TOPIC" && row.dimension_value === "Case study proprietari"));

const foreign: PersistedLearningInsight = { ...rows[0]!, profile_id: otherProfileId, dimension: "TOPIC", dimension_value: "SEGRETO ALTRO TENANT" };
const low: PersistedLearningInsight = { ...rows[0]!, confidence: "LOW", dimension: "TOPIC", dimension_value: "SEGNALE DEBOLE" };
const allRows = [...rows, foreign, low];
const context = learningContext(profileId, allRows);
assert.ok(context.length > 0);
assert.equal(context.some((row) => row.value === "SEGRETO ALTRO TENANT"), false, "another profile must never influence learning");
assert.equal(context.some((row) => row.value === "SEGNALE DEBOLE"), false, "LOW confidence must not affect future decisions");
assert.equal(learnedFormatPreference(profileId, "INSTAGRAM", ["POST", "STORY"], allRows), "STORY", "real results must change the next supported format decision");
assert.match(buildAutopilotLearningInstruction(profileId, "INSTAGRAM", allRows) ?? "", /Case study proprietari/);
const timing = learnedTimingPreference(profileId, "INSTAGRAM", allRows);
assert.equal(timing?.source, "LEARNING");
const now = new Date("2026-09-20T08:00:00.000Z");
const learnedSlots = candidateSlots({ provider: "INSTAGRAM", timezone: "Europe/Rome", posts_per_week: 1, preferred_slots: [], auto_choose: true, enabled: true }, now, timing);
assert.equal(learnedSlots[0]?.timingSource, "LEARNING", "verified timing must alter the next schedule when user slots are absent");
const userSlots = candidateSlots({ provider: "INSTAGRAM", timezone: "Europe/Rome", posts_per_week: 1, preferred_slots: [{ day: 1, time: "07:30" }], auto_choose: true, enabled: true }, now, timing);
assert.equal(userSlots[0]?.timingSource, "USER_CONFIG", "explicit user slots must override learning");

const strategy: OpenAIStrategy = {
  summary: "Strategia", primaryObjective: "Lead", audience: "Proprietari", positioning: "Competenza",
  contentPillars: ["Educazione", "Casi reali", "Servizio"],
  contentMix: { educational: 30, promotional: 20, news: 10, tips: 25, storytelling: 15 },
  platformPriorities: ["INSTAGRAM", "FACEBOOK"], ctaPolicy: "CTA chiara", localityPolicy: "Milano",
  seasonalityPolicy: "Solo eventi verificati", doNotClaim: ["Risultati inventati"],
};
let plannerContext: Record<string, unknown> | null = null;
const fetcher: typeof fetch = async (_url, init) => {
  const request = JSON.parse(String(init?.body)) as { input: string };
  plannerContext = JSON.parse(request.input) as Record<string, unknown>;
  return Response.json({ id: "resp_learning", output_text: JSON.stringify({ horizonDays: 14, planningSummary: "I risultati reali privilegiano i casi studio", items: [{ dayOffset: 1, provider: "INSTAGRAM", contentType: "SINGLE_STORY", intent: "CASE_STUDY", topicDirection: "Case study proprietari con un nuovo angolo", objective: "Lead", funnelStage: "CONSIDERATION" }] }), usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } });
};
const plan = await generateOpenAIPlan({
  apiKey: "test", profile: { id: profileId, name: "Il Tuo Property Manager", industry: "Property management", website_url: "https://iltuopropertymanager.it", timezone: "Europe/Rome" },
  strategy, schedules: [{ provider: "INSTAGRAM", posts_per_week: 2, preferred_slots: [], timezone: "Europe/Rome", enabled: true }], recentTopics: ["Tema precedente"], learningInsights: allRows, fetcher,
});
assert.match(plan.output.items[0]?.topicDirection ?? "", /Case study proprietari/);
const plannerLearning = plannerContext?.evidenceBasedLearning as Array<{ value?: string }>;
assert.ok(plannerLearning.some((row) => row.value === "Case study proprietari"));
assert.equal(plannerLearning.some((row) => row.value === "SEGRETO ALTRO TENANT"), false);

const migration = fs.readFileSync("db/migrations/20260917_fase7i_learning_runtime.sql", "utf8");
for (const fragment of ["refresh_learning_insights", "pg_advisory_xact_lock", "learning_insights_customer_read", "FORCE ROW LEVEL SECURITY", "REVOKE ALL ON FUNCTION"]) assert.ok(migration.includes(fragment), `missing learning persistence invariant: ${fragment}`);
for (const legacyColumn of ["scope", "insight", "evidence", "recommended_action", "applied_at", "created_at"]) assert.ok(migration.includes(legacyColumn), `production learning contract must preserve ${legacyColumn}`);
assert.match(migration, /ALTER COLUMN confidence TYPE text USING confidence::text/, "numeric production confidence must be migrated before structured confidence is persisted");
assert.match(migration, /WHERE dimension IS NOT NULL AND dimension_value IS NOT NULL/, "legacy rows must be excluded from structured deduplication");
const runtime = fs.readFileSync("api/_lib/learning-runtime.ts", "utf8");
assert.match(runtime, /distinct on \(snapshot\.provider,snapshot\.external_post_id\)/, "hourly captures must not inflate evidence");
assert.match(runtime, /order by latest\.published_at desc,latest\.provider,latest\.external_post_id/, "the bounded learning window must keep the latest unique posts rather than arbitrary provider IDs");
assert.match(runtime, /snapshot\.source='PROVIDER_API'/, "only real provider snapshots may feed learning");
assert.match(runtime, /snapshot\.provider in \('FACEBOOK','INSTAGRAM','LINKEDIN'\)/, "personal learning must include every analytics-ready post-level provider");
assert.match(runtime, /result\.errors\.push\("LEARNING_REFRESH_FAILED"\)/, "customer runtime response must not expose raw database errors");
assert.equal(runtime.includes("result.errors.push(`${profile.id}"), false, "profile ids and raw errors must not be returned to the browser");
const entry = fs.readFileSync("cloudflare/entry.ts", "utf8");
assert.ok(entry.indexOf("await processDueAnalytics(env)") < entry.indexOf("await runLearningRuntime(env)"));
assert.ok(entry.indexOf("await runLearningRuntime(env)") < entry.indexOf("await runContentAutopilotSerialized(env)"));

console.log("PASS FASE 7I: real snapshots produce profile-scoped persisted insights that change planner/autopilot decisions with confidence gates.");
