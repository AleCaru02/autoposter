import assert from "node:assert/strict";
import fs from "node:fs";

const social = fs.readFileSync("src/pages/social-page.tsx", "utf8");
const website = fs.readFileSync("src/pages/website-scan-page.tsx", "utf8");
const analytics = fs.readFileSync("src/pages/analytics-page.tsx", "utf8");
const shell = fs.readFileSync("src/components/app-shell.tsx", "utf8");
const design = fs.readFileSync("src/design-system.css", "utf8");

for (const forbidden of [
  "I token restano sul server",
  "credenziali sviluppatore",
  "provider realmente collegati",
  "OpenAI non è ancora configurato",
  "raccolta API riuscita",
]) {
  assert.ok(!`${social}\n${website}\n${analytics}`.includes(forbidden), `customer technical copy leaked: ${forbidden}`);
}

assert.match(shell, /event\.key === "Escape"/, "mobile dialog must close with Escape");
assert.match(shell, /document\.body\.style\.overflow = "hidden"/, "mobile dialog must lock background scroll");
assert.match(shell, /aria-haspopup="dialog"/, "mobile menu trigger must expose dialog semantics");
assert.match(shell, /mobileMoreCloseRef\.current\?\.focus\(\)/, "mobile dialog needs deterministic initial focus");
assert.match(design, /@media\(max-width:900px\)/, "tablet breakpoint missing");
assert.match(design, /@media\(max-width:760px\)/, "mobile breakpoint missing");
assert.match(design, /@media\(prefers-reduced-motion:reduce\)/, "reduced-motion support missing");
assert.match(design, /:focus-visible/, "keyboard focus style missing");

console.log("FASE6E_UX_POLISH_STATIC: PASS");
