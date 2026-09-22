import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("src/pages/brand-page.tsx", "utf8");
const migration = fs.readFileSync("db/migrations/20260923_brand_user_context.sql", "utf8");

for (const field of ["targetSegments", "toneTraits", "services", "differentiators", "valuePropositions", "visualSummary", "colors", "userContext"]) {
  assert.match(page, new RegExp(`patch\\(\\"${field}\\"`), `${field} must be customer-editable`);
  assert.match(page, new RegExp(`draft\\.${field}`), `${field} must be loaded from persisted profile data`);
}
assert.match(page, /brand_profiles"\)\.update\(payload\)/, "existing brand intelligence must persist profile-scoped");
assert.match(page, /brand_profiles"\)\.insert\(payload\)/, "a missing brand row must be creatable for the selected profile");
assert.match(page, /autosave\.flush\(\)/, "the customer must have an explicit save action");
assert.match(page, /aria-live="polite"/, "save status must be announced accessibly");
assert.match(page, /Aggiungi quello che il sito non dice/, "the user must understand where to add missing website information");
assert.match(page, /Servizi non ancora sul sito[\s\S]*Zone che gestisci davvero[\s\S]*Clienti che vuoi acquisire/, "guided examples must explain useful context");
assert.match(page, /user_context:\s*draft\.userContext\.trim\(\)/, "user context must persist in the selected brand profile");
assert.match(page, /maxLength=\{5000\}/, "user context must have a bounded payload");
assert.match(migration, /ADD COLUMN IF NOT EXISTS user_context text/);
assert.match(migration, /char_length\(user_context\) <= 5000/);

console.log("FASE 7A editable brand intelligence regression: PASS");
