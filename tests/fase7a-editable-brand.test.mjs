import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("src/pages/brand-page.tsx", "utf8");
const migration = fs.readFileSync("db/migrations/20260923_brand_user_context.sql", "utf8");
const brandCss = fs.readFileSync("src/brand.css", "utf8");

for (const field of ["targetSegments", "toneTraits", "services", "differentiators", "valuePropositions", "visualSummary", "colors", "userContext"]) {
  assert.match(page, new RegExp(`patch\\(\\"${field}\\"`), `${field} must be customer-editable`);
  assert.match(page, new RegExp(`draft\\.${field}`), `${field} must be loaded from persisted profile data`);
}
assert.match(page, /brand_profiles"\)\.update\(payload\)/, "existing brand intelligence must persist profile-scoped");
assert.match(page, /brand_profiles"\)\.insert\(payload\)/, "a missing brand row must be creatable for the selected profile");
assert.match(page, /autosave\.flush\(\)/, "the customer must have an explicit save action");
assert.match(page, /aria-live="polite"/, "save status must be announced accessibly");
assert.match(page, /Informazioni aggiuntive/, "the confirmed user context must have a clear heading");
assert.match(page, /Aggiungi dettagli non presenti sul sito che vuoi associare a questa attività\./, "the helper copy must explain the purpose without AI-template language");
assert.match(page, /Es\. servizi particolari, aree servite, modalità di lavoro, punti di forza o informazioni che non compaiono sul sito\.\.\./, "the textarea must provide a useful placeholder");
assert.match(page, /Identità rilevata dal sito/, "the detected brand section must use neutral product language");
assert.doesNotMatch(page, /<Sparkles|\bSparkles\b/, "brand UI must not use decorative AI sparkle icons");
assert.doesNotMatch(page, /l’AI deve conoscere/, "brand UI must not expose AI-template helper copy");
assert.match(page, /brand-insight-list/, "long audience and service findings must use readable lists instead of only pill chips");
assert.match(page, /Non inserire password, chiavi API o dati sensibili\./, "sensitive-data guidance must stay visible");
assert.match(page, /Salvataggio automatico/, "the real autosave behavior must be visible");
assert.match(page, /draft\.userContext\.length\}\/5000/, "the real database-backed character limit must be visible");
assert.match(brandCss, /\.brand-context-field textarea[\s\S]*min-height:168px/, "the additional context textarea must be full-size and usable");
assert.match(brandCss, /@media\(max-width:760px\)[\s\S]*\.brand-context-field textarea/, "the context textarea must remain responsive on mobile");
assert.match(page, /user_context:\s*draft\.userContext\.trim\(\)/, "user context must persist in the selected brand profile");
assert.match(page, /maxLength=\{5000\}/, "user context must have a bounded payload");
assert.match(migration, /ADD COLUMN IF NOT EXISTS user_context text/);
assert.match(migration, /char_length\(user_context\) <= 5000/);

console.log("FASE 7A editable brand intelligence regression: PASS");
