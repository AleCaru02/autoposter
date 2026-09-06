import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("src/pages/brand-page.tsx", "utf8");

for (const field of ["targetSegments", "toneTraits", "services", "differentiators", "valuePropositions", "visualSummary", "colors"]) {
  assert.match(page, new RegExp(`patch\\(\\"${field}\\"`), `${field} must be customer-editable`);
  assert.match(page, new RegExp(`draft\\.${field}`), `${field} must be loaded from persisted profile data`);
}
assert.match(page, /brand_profiles"\)\.update\(payload\)/, "existing brand intelligence must persist profile-scoped");
assert.match(page, /brand_profiles"\)\.insert\(payload\)/, "a missing brand row must be creatable for the selected profile");
assert.match(page, /autosave\.flush\(\)/, "the customer must have an explicit save action");
assert.match(page, /aria-live="polite"/, "save status must be announced accessibly");

console.log("FASE 7A editable brand intelligence regression: PASS");
