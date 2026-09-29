import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [migration, store, composer, approvals, openai, autopilot] = await Promise.all([
  readFile("db/migrations/20260929_zzzz_content_carousel_slides.sql", "utf8"),
  readFile("src/features/content/content-store.ts", "utf8"),
  readFile("src/components/manual-content-composer.tsx", "utf8"),
  readFile("src/pages/approvals-page.tsx", "utf8"),
  readFile("api/_lib/openai-text.ts", "utf8"),
  readFile("api/_lib/autopilot.ts", "utf8"),
]);

assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.content_carousel_slides/);
for (const column of ["profile_id","content_id","variant_id","position","purpose","headline","body","hierarchy","visual_brief","alt_text","asset_id","width","height","qa_status"]) {
  assert.match(migration, new RegExp(`\\b${column}\\b`), `carousel slide must persist ${column}`);
}
assert.match(migration, /UNIQUE \(variant_id, position\)/);
assert.match(migration, /v_format IS DISTINCT FROM 'CAROUSEL'/, "slide rows must only bind to carousel variants");
assert.match(migration, /ALTER TABLE public\.content_carousel_slides FORCE ROW LEVEL SECURITY/);
assert.match(migration, /public\.owns_profile\(profile_id\)/);
assert.match(migration, /guard_carousel_variant_approval/);
assert.match(migration, /asset_id IS NOT NULL AND qa_status='PASS'/, "approval must require every slide visual and QA PASS");
assert.match(migration, /v_count < 4 OR v_count > 10 OR v_ready <> v_count/, "carousel must have a provider-safe slide count");

assert.match(openai, /carouselSlides/);
assert.match(openai, /OPENAI_INVALID_CAROUSEL_SLIDES/);
assert.match(openai, /Non creare un collage/);
assert.match(store, /content_carousel_slides/);
assert.match(store, /decision_record/);
assert.match(composer, /Carosello/);
assert.doesNotMatch(composer, /Carosello · in preparazione/);
assert.match(approvals, /carouselReady/);
assert.match(approvals, /QA PASS/);
assert.match(autopilot, /decisionRecord/);
assert.match(autopilot, /decision_record/);

console.log("Carousel content foundation: PASS — structured slides, scoped persistence, audit record and fail-closed approval.");
