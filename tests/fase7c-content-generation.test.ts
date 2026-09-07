import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { friendlyGenerationError, manualGenerationFingerprint, requestManualContent } from "../src/features/content/manual-content-generation.js";

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
const result = await requestManualContent(baseRequest, "test-jwt", "operation-000000000001", async (url, init) => {
  captured = { url: String(url), init };
  return new Response(JSON.stringify({ content: generated }), { status: 200, headers: { "content-type": "application/json" } });
});
assert.equal(result.variants.length, 2);
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
assert.doesNotMatch(friendlyGenerationError("METERING_FAILED"), /meter|capability|provider/i);

const [page, composer, store, workerText, entry, approvals] = await Promise.all([
  readFile("src/pages/content-generator-page.tsx", "utf8"),
  readFile("src/components/manual-content-composer.tsx", "utf8"),
  readFile("src/features/content/content-store.ts", "utf8"),
  readFile("cloudflare/generate-text.ts", "utf8"),
  readFile("cloudflare/entry.ts", "utf8"),
  readFile("src/pages/approvals-page.tsx", "utf8"),
]);

assert.match(page, /ManualContentComposer/, "customer content page must expose manual creation");
assert.match(composer, /requestManualContent/, "manual composer must call the guarded text endpoint");
assert.match(composer, /saveGeneratedContent/, "generated content must be persistible");
assert.match(composer, /INSTAGRAM/);
assert.match(composer, /FACEBOOK/);
assert.match(composer, /LINKEDIN/);
assert.match(composer, /Google Business Profile/);
assert.match(composer, /type="radio" name="manual-format" disabled/, "carousel must not be presented as complete while only one asset is supported");
assert.match(composer, /updateVariant\(index/, "copy and visual brief must be manually editable before save");
assert.match(composer, /\/app\/approvazioni/, "saved generation must continue to review and approval");
for (const term of ["capability key", "entitlement engine", "token budget", "technical usage", "Worker", "RLS"]) assert.equal(composer.includes(term), false, `customer composer exposes internal term: ${term}`);

assert.ok(store.indexOf('from("content_items").insert') < store.indexOf('from("content_variants").insert'), "content parent must be persisted before its variants");
assert.match(store, /profile_id: input\.profileId/g, "content and variants must carry the selected profile id");
assert.match(store, /from\("content_items"\)\.delete\(\)\.eq\("id", contentId\)\.eq\("profile_id", input\.profileId\)/, "failed variant persistence must clean up only the scoped parent");
assert.match(workerText, /normalizeEditorialResearchMode\(body\.researchMode\)/, "Cloudflare manual generation must honor the selected editorial mode");
assert.match(workerText, /requestFingerprint: \{ topic, objective, providers, formats, researchMode \}/, "research mode must be part of idempotency identity");
assert.match(workerText, /brand: context, researchMode, cacheKey/, "Cloudflare must pass customer research mode into the real AI prompt");
assert.ok(entry.indexOf('path === "/api/generate-text"') < entry.indexOf("return worker.fetch(request, env)"), "canonical Worker entry must route generation before asset fallback");
assert.match(approvals, /fetch\("\/api\/generate-image"/);
assert.match(approvals, /contentVariantId: variant\.id/);
assert.match(approvals, /setVariantApproval/);

console.log("FASE 7C manual content generation regression: PASS");
