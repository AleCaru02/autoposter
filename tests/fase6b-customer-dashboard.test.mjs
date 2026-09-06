import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("src/pages/dashboard-page.tsx", "utf8");
const css = readFileSync("src/dashboard.css", "utf8");
const main = readFileSync("src/main.tsx", "utf8");

for (const answer of ["Cosa richiede attenzione oggi", "Prossime pubblicazioni", "Pubblicato di recente", "Come stanno andando i social", "Consiglio AI", "Problemi da risolvere"]) {
  assert.ok(page.includes(answer), `customer question is not answered: ${answer}`);
}
for (const destination of ["/app/contenuti", "/app/approvazioni", "/app/calendario", "/app/social", "/app/analytics", "/app/apprendimento"]) {
  assert.ok(page.includes(destination), `operational dashboard link missing: ${destination}`);
}
for (const table of ["content_items", "content_variants", "publication_jobs", "social_connections", "metric_snapshots", "learning_insights"]) {
  assert.ok(page.includes(`from(\"${table}\")`), `real dashboard source missing: ${table}`);
}
assert.ok((page.match(/\.eq\(\"profile_id\", profileId\)/g) ?? []).length >= 6, "every dashboard read must remain profile-scoped");
assert.equal(page.includes("/api/health"), false, "customer dashboard must not present runtime health");
for (const forbidden of ["PostgreSQL", "RLS", "OpenAI", "entitlement", "Worker", "technical usage"]) {
  assert.equal(page.includes(forbidden), false, `customer dashboard exposes technical term: ${forbidden}`);
}
assert.match(page, /role="alert"/, "load failure must be announced");
assert.match(page, /aria-label="Caricamento panoramica"/, "loading state must have an accessible name");
assert.match(main, /import "\.\/dashboard\.css";/, "dashboard styles must load globally");
assert.match(css, /@media\(max-width:1040px\)/, "tablet dashboard breakpoint missing");
assert.match(css, /@media\(max-width:760px\)/, "mobile dashboard breakpoint missing");
assert.match(css, /@media\(max-width:390px\)/, "375px dashboard hardening missing");

console.log("FASE 6B customer dashboard: PASS");
