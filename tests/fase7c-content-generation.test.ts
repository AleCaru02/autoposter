import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ManualGenerationError, friendlyGenerationError, manualGenerationFingerprint, requestManualContent, requestManualContentStatus } from "../src/features/content/manual-content-generation.js";

const baseRequest = {
  profileId: "11111111-1111-4111-8111-111111111111",
  topic: "Consigli per proprietari",
  objective: "Richieste qualificate",
  providers: ["INSTAGRAM", "LINKEDIN"] as const,
  format: "POST" as const,
  researchMode: "BALANCED" as const,
};

assert.equal(
  manualGenerationFingerprint(baseRequest),
  manualGenerationFingerprint({ ...baseRequest, providers: ["LINKEDIN", "INSTAGRAM"] }),
  "the same logical request must keep a stable replay fingerprint",
);
assert.notEqual(manualGenerationFingerprint(baseRequest), manualGenerationFingerprint({ ...baseRequest, profileId: "22222222-2222-4222-8222-222222222222" }), "generation identity must remain profile-scoped");

let captured: { url?: string; init?: RequestInit } = {};
const generated = {
  editorialTopic: "Gestione consapevole",
  editorialAngle: "Tre errori pratici da prevenire",
  strategySummary: "Contenuto educativo",
  variants: [
    { provider: "INSTAGRAM", format: "POST", eligible: true, hook: "Tre errori", caption: "Copy Instagram", cta: "Scopri di più", hashtags: ["#casa"], visualBrief: "Casa luminosa", altText: "Interno luminoso", factualBasis: ["BASE BRAND/SITO"] },
    { provider: "LINKEDIN", format: "POST", eligible: true, hook: "Una gestione migliore", caption: "Copy LinkedIn", cta: null, hashtags: [], visualBrief: "Professionista al lavoro", altText: "Professionista al lavoro", factualBasis: ["BASE BRAND/SITO"] },
  ],
} as const;
const editorialContext = {
  profileType: "BUSINESS" as const,
  pillar: null,
  sourceProfileId: null,
  sourceProfileIds: [],
  sourceRefs: [],
  audience: {},
  factProvenance: [],
  externalSources: [],
};
const result = await requestManualContent(baseRequest, "test-jwt", "operation-000000000001", async (url, init) => {
  captured = { url: String(url), init };
  return new Response(JSON.stringify({ content: generated, editorialContext }), { status: 200, headers: { "content-type": "application/json" } });
});
assert.equal(result.content.variants.length, 2);
assert.deepEqual(result.editorialContext, editorialContext);
assert.equal(captured.url, "/api/generate-text");
assert.equal(captured.init?.method, "POST");
const headers = new Headers(captured.init?.headers);
assert.equal(headers.get("authorization"), "Bearer test-jwt");
assert.equal(headers.get("x-post-automatici-operation-id"), "operation-000000000001");
const payload = JSON.parse(String(captured.init?.body));
assert.deepEqual(payload.providers, ["INSTAGRAM", "LINKEDIN"]);
assert.deepEqual(payload.formats, ["POST"]);
assert.equal(payload.researchMode, "BALANCED");

await assert.rejects(
  requestManualContent(baseRequest, "test-jwt", "operation-000000000001", async () => new Response(JSON.stringify({ error: "CAPABILITY_LIMIT_REACHED" }), { status: 429 })),
  /limite di generazione/,
);
assert.match(friendlyGenerationError("DUPLICATE_CONTENT"), /simile/);
assert.match(friendlyGenerationError("FACTCHECK_NEEDS_SOURCE"), /fonti sufficienti/i);
assert.doesNotMatch(friendlyGenerationError("METERING_FAILED"), /meter|capability|provider/i);

const progressResult = await requestManualContentStatus("11111111-1111-4111-8111-111111111111", "test-jwt", "operation-000000000001", async (url, init) => {
  assert.equal(String(url), "/api/generate-text/status");
  const statusHeaders = new Headers(init?.headers);
  assert.equal(statusHeaders.get("x-post-automatici-operation-id"), "operation-000000000001");
  return new Response(JSON.stringify({
    jobId: "22222222-2222-4222-8222-222222222222",
    operationId: "operation-000000000001",
    state: "COMPLETED",
    percent: 100,
    stage: "COMMITTED",
    startedAt: "2026-10-01T12:00:00.000Z",
    updatedAt: "2026-10-01T12:00:05.000Z",
    result: { content: generated, editorialContext },
  }), { status: 200, headers: { "content-type": "application/json" } });
});
assert.equal(progressResult.state, "COMPLETED");
assert.equal(progressResult.percent, 100);
assert.equal(progressResult.result?.content.editorialTopic, generated.editorialTopic);
assert.equal(progressResult.jobId, "22222222-2222-4222-8222-222222222222");
assert.equal(progressResult.operationId, "operation-000000000001");
assert.equal(progressResult.startedAt, "2026-10-01T12:00:00.000Z");
assert.equal(progressResult.updatedAt, "2026-10-01T12:00:05.000Z");

await assert.rejects(
  requestManualContent(baseRequest, "test-jwt", "operation-000000000001", async () => new Response(JSON.stringify({ error: "FACTCHECK_NEEDS_SOURCE" }), { status: 422 })),
  (reason: unknown) => reason instanceof ManualGenerationError && reason.code === "FACTCHECK_NEEDS_SOURCE" && /fonti sufficienti/i.test(reason.message),
);

const [page, composer, store, workerText, entry, approvals, metering] = await Promise.all([
  readFile("src/pages/content-generator-page.tsx", "utf8"),
  readFile("src/components/manual-content-composer.tsx", "utf8"),
  readFile("src/features/content/content-store.ts", "utf8"),
  readFile("cloudflare/generate-text.ts", "utf8"),
  readFile("cloudflare/entry.ts", "utf8"),
  readFile("src/pages/approvals-page.tsx", "utf8"),
  readFile("api/_lib/text-generation-metering.ts", "utf8"),
]);

assert.match(page, /ManualContentComposer/, "customer content page must expose manual creation");
assert.match(composer, /requestManualContent/, "manual composer must call the guarded text endpoint");
assert.match(composer, /requestManualContentStatus/, "manual composer must poll real server-side progress");
assert.match(composer, /sessionStorage/, "manual composer must survive navigation and refresh in the same tab");
assert.match(composer, /aria-valuenow=\{progress\.percent\}/, "manual composer must expose a real progress percentage");
assert.match(composer, /Puoi aprire Calendario/, "manual composer must explain that navigation no longer cancels the operation");
assert.match(composer, /operation: op/, "pending operation must be persisted instead of being lost on navigation");
assert.match(composer, /canonical\.state === "FAILED"/, "request failures must be reconciled with the canonical backend operation state");
assert.match(composer, /friendlyGenerationError\(canonical\.error\)/, "the UI must show the real verified failure reason instead of a generic provider error");
assert.match(composer, /saveGeneratedContent/, "generated content must be persistible");
assert.match(composer, /INSTAGRAM/);
assert.match(composer, /FACEBOOK/);
assert.match(composer, /LINKEDIN/);
assert.match(composer, /Google Business Profile/);
assert.match(composer, /format === "CAROUSEL"/, "carousel must be selectable as a real structured format");
assert.doesNotMatch(composer, /manual-format" disabled/, "carousel must no longer be a disabled placeholder");
assert.match(composer, /updateCarouselSlide/, "carousel slide copy and visual specification must be editable before save");
assert.match(composer, /updateVariant\(index/, "copy and visual brief must be manually editable before save");
assert.match(composer, /\/app\/approvazioni/, "saved generation must continue to review and approval");
for (const term of ["capability key", "entitlement engine", "token budget", "technical usage", "Worker", "RLS"]) assert.equal(composer.includes(term), false, `customer composer exposes internal term: ${term}`);

assert.ok(store.indexOf('from("content_items").insert') < store.indexOf('from("content_variants").insert'), "content parent must be persisted before its variants");
assert.match(store, /profile_id: input\.profileId/g, "content and variants must carry the selected profile id");
assert.match(store, /from\("content_items"\)\.delete\(\)\.eq\("id", contentId\)\.eq\("profile_id", input\.profileId\)/, "failed variant persistence must clean up only the scoped parent");
assert.match(store, /from\("content_carousel_slides"\)\.insert\(carouselRows\)/, "real carousel slides must be persisted as first-class rows");
assert.match(store, /decision_record/, "content must persist an auditable decision record");
assert.match(workerText, /normalizeEditorialResearchMode\(body\.researchMode\)/, "Cloudflare manual generation must honor the selected editorial mode");
assert.match(workerText, /handleWorkerGenerateTextStatus/, "Cloudflare must expose generation status for resume");
const statusHandlerSource = workerText.slice(workerText.indexOf("export async function handleWorkerGenerateTextStatus"), workerText.indexOf("async function recentContentForDedupe"));
assert.match(statusHandlerSource, /profiles\?id=eq\./, "progress polling must use the lightweight tenant-scoped Data API check");
assert.doesNotMatch(statusHandlerSource, /verifiedCustomerAuthUserId|loadEditorialProfile/, "progress polling must not redo the full managed-auth/profile load every 1.2 seconds");
assert.match(statusHandlerSource, /STATUS_UNAVAILABLE/, "status polling must fail explicitly instead of silently looking frozen");
assert.match(workerText, /FACTCHECK_NEEDS_SOURCE/, "factual verification failures must no longer collapse into a generic error");
assert.match(workerText, /onProgress:/, "server must persist actual pipeline stages");
assert.match(metering, /client_operation_identity/, "metering must persist client operation identity for navigation resume");
assert.match(metering, /getOperationStatus/, "metering must support operation progress lookup");
assert.match(metering, /progress_percent/, "metering must persist real progress percentage");
assert.match(metering, /progress_updated_at/, "server progress must persist updatedAt instead of relying on frontend timers");
assert.match(workerText, /jobId: status\.eventId/, "status response must expose a durable server job id");
assert.match(workerText, /startedAt: status\.createdAt/, "status response must expose server startedAt");
assert.match(workerText, /updatedAt: status\.updatedAt/, "status response must expose server updatedAt");
for (const stage of ["CHANNEL_STRATEGY","VISUAL_BRIEF","SOURCE_VALIDATION"]) assert.match(metering + workerText, new RegExp(stage), `real progress stage missing: ${stage}`);
assert.match(composer, /Adatto la strategia ai canali/, "UI must show the channel-strategy step");
assert.match(composer, /Preparo i brief visuali/, "UI must show visual-brief creation separately");
assert.match(composer, /Normalizzo e valido le fonti/, "UI must show source validation separately");
assert.match(workerText, /requestFingerprint: \{ topic, objective, providers, formats, researchMode, sourceProfileId: editorialContext\.sourceProfileId, pillar: editorialContext\.pillar \}/, "research mode and Personal Brand source context must be part of idempotency identity");
assert.match(workerText, /brand:\s*context,[\s\S]{0,160}researchMode,[\s\S]{0,160}cacheKey/, "Cloudflare must pass customer research mode into the real AI prompt");
assert.ok(entry.indexOf('path === "/api/generate-text/status"') < entry.indexOf('path === "/api/generate-text"'), "status route must not be swallowed by the main generation route");
assert.ok(entry.indexOf('path === "/api/generate-text"') < entry.indexOf("return worker.fetch(request, env)"), "canonical Worker entry must route generation before asset fallback");
assert.match(approvals, /fetch\("\/api\/generate-image"/);
assert.match(approvals, /contentVariantId: variant\.id/);
assert.match(approvals, /reviewVariant/);
assert.match(approvals, /approvalStatus/);
assert.match(approvals, /slide\.asset_id && slide\.qa_status === "PASS"/, "carousel approval must fail closed until every slide has an asset and QA PASS");
assert.match(approvals, /generazione singola è bloccata/, "single-image generation must never masquerade as a carousel");

console.log("FASE 7C manual content generation regression: PASS");
