import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encryptTokenBundle } from "../api/_lib/social.js";
import { historicalMetricsEnabled, importHistoricalMetrics, instagramFormat, topicFromCaption } from "../api/_lib/historical-metrics.js";

assert.equal(historicalMetricsEnabled(undefined), true, "read-only import on by default");
assert.equal(historicalMetricsEnabled("false"), false);
assert.equal(topicFromCaption("#affittibrevi\nCome preparare casa per il primo ospite 🏡 #milano @iltuopm\nseconda riga"), "Come preparare casa per il primo ospite 🏡");
assert.equal(topicFromCaption(""), "Post senza testo");
assert.equal(instagramFormat("VIDEO", "REELS"), "REEL");
assert.equal(instagramFormat("CAROUSEL_ALBUM", "FEED"), "CAROUSEL");
assert.equal(instagramFormat("IMAGE", "FEED"), "POST");

const KEY = "k".repeat(43);
const tokenReference = await encryptTokenBundle({ accessToken: "page-token", refreshToken: null, expiresAt: null } as never, KEY);
const PERMS = ["instagram_basic", "instagram_manage_insights", "pages_read_engagement"];
const connections = [
  { profile_id: "11111111-1111-1111-1111-111111111111", provider: "INSTAGRAM", status: "ACTIVE", provider_account_id: "1784", token_reference: tokenReference, permissions: PERMS, expires_at: null, metadata: {} },
  { profile_id: "11111111-1111-1111-1111-111111111111", provider: "FACEBOOK", status: "ACTIVE", provider_account_id: "7122", token_reference: tokenReference, permissions: PERMS, expires_at: null, metadata: { pageId: "7122" } },
];
const inserts: unknown[][] = [];
const queries: string[] = [];
const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join("?");
  queries.push(text);
  if (/from public\.social_connections c/.test(text)) return connections;
  if (/insert into public\.metric_snapshots/.test(text)) { inserts.push(values); return []; }
  throw new Error("unexpected query " + text.slice(0, 80));
}) as never;

const calls: string[] = [];
const fakeFetch = (async (input: URL | string) => {
  const url = new URL(String(input));
  calls.push(`${url.pathname}?${url.searchParams.get("fields") ?? url.searchParams.get("metric") ?? ""}`);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.pathname.endsWith("/1784/media")) return json({ data: [
    { id: "ig1", caption: "Checklist check-in\n#milano", media_type: "CAROUSEL_ALBUM", media_product_type: "FEED", timestamp: "2026-11-01T10:00:00+0000" },
    { id: "ig2", caption: "Reel tour", media_type: "VIDEO", media_product_type: "REELS", timestamp: "2026-11-03T18:00:00+0000" },
  ] });
  if (url.pathname.endsWith("/7122/published_posts")) return json({ data: [{ id: "7122_1", message: "Novità affitti brevi", created_time: "2026-11-02T09:00:00+0000" }] });
  if (url.pathname.endsWith("/insights")) return json({ data: [{ name: url.searchParams.get("metric"), values: [{ value: 42 }] }] });
  if (/\/(ig1|ig2)$/.test(url.pathname)) return json({ id: "x", like_count: 5, comments_count: 2 });
  if (url.pathname.endsWith("/7122_1")) {
    const fields = url.searchParams.get("fields") ?? "";
    if (fields.startsWith("reactions")) return json({ reactions: { summary: { total_count: 7 } } });
    if (fields.startsWith("comments")) return json({ comments: { summary: { total_count: 1 } } });
    if (fields === "shares") return json({ shares: { count: 3 } });
    return json({ id: "7122_1" });
  }
  return json({ error: "unexpected" }, 500);
}) as typeof fetch;

const result = await importHistoricalMetrics({ DATABASE_URL: "postgres://fake", SOCIAL_TOKEN_KEY: KEY, META_GRAPH_VERSION: "v23.0" }, { sql, runtime: { fetch: fakeFetch } });
assert.equal(result.connections, 2);
assert.equal(result.posts, 3);
assert.equal(result.synced, 3, JSON.stringify(result));
assert.equal(result.failed, 0, JSON.stringify(result.codes));
assert.equal(inserts.length, 3);
const [igCarousel] = inserts;
assert.equal(igCarousel[2], "ig1"); assert.equal(igCarousel[3], "CAROUSEL"); assert.equal(igCarousel[4], "Checklist check-in");
const metrics = JSON.parse(String(igCarousel[6])) as Record<string, number>;
assert.ok(Object.keys(metrics).length >= 3, "real counters and insights stored");
assert.ok(inserts.every((row) => row[0] === "11111111-1111-1111-1111-111111111111"));
assert.ok(queries.some((q) => /'PROVIDER_API', 'PROVIDER_REAL'/.test(q)), "stored as real provider data");
assert.ok(queries.some((q) => /make_interval\(hours => \?\)/.test(q)), "20h freshness guard in the selection query");
// Read-only: only GET requests to Graph API, never media/publish endpoints.
assert.ok(!calls.some((c) => /media_publish|\/feed|\/photos/.test(c)), calls.join("\n"));

// A revoked permission stops that account early instead of hammering every post.
const denied = (async (input: URL | string) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith("/media")) return new Response(JSON.stringify({ data: [{ id: "a", timestamp: "2026-11-01T00:00:00+0000" }, { id: "b", timestamp: "2026-11-01T00:00:00+0000" }] }), { status: 200 });
  if (url.pathname.endsWith("/published_posts")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
  return new Response("{}", { status: 401 });
}) as typeof fetch;
inserts.length = 0;
const deniedResult = await importHistoricalMetrics({ DATABASE_URL: "postgres://fake", SOCIAL_TOKEN_KEY: KEY }, { sql, runtime: { fetch: denied } });
assert.equal(deniedResult.synced, 0); assert.equal(deniedResult.failed, 1, JSON.stringify(deniedResult)); assert.equal(inserts.length, 0);

const cron = readFileSync(new URL("../api/cron.ts", import.meta.url), "utf8");
assert.ok(cron.indexOf("importHistoricalMetrics(") < cron.indexOf("runLearningRuntime(env)"), "metrics import precedes learning");
assert.ok(cron.indexOf("importHistoricalMetrics(") < cron.indexOf("cronAutopilotAiEnabled("), "import does not depend on the paid autopilot switch");

console.log("historical-metrics: PASS");
