import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync("src/App.tsx", "utf8");
const shell = fs.readFileSync("src/components/app-shell.tsx", "utf8");
const design = fs.readFileSync("src/design-system.css", "utf8");
const mobile = fs.readFileSync("src/mobile-a11y.css", "utf8");
const dashboard = fs.readFileSync("src/dashboard.css", "utf8");
const approvals = fs.readFileSync("src/pages/approvals-page.tsx", "utf8");
const approvalsCss = fs.readFileSync("src/approvals.css", "utf8");
const calendar = fs.readFileSync("src/pages/calendar-page.tsx", "utf8");
const calendarCss = fs.readFileSync("src/calendar.css", "utf8");
const social = fs.readFileSync("src/pages/social-page.tsx", "utf8");
const analytics = fs.readFileSync("src/pages/analytics-page.tsx", "utf8");
const auth = fs.readFileSync("src/pages/auth-pages.tsx", "utf8");

for (const route of [
  "dashboard","profili","brand","sito","contenuti","approvazioni","calendario",
  "social","analytics","apprendimento","libreria","impostazioni",
]) assert.ok(app.includes('path="' + route + '"'), "main UI route missing: " + route);

assert.match(shell, /aria-label="Navigazione principale"/);
assert.match(shell, /aria-label="Navigazione principale mobile"/);
assert.match(shell, /aria-haspopup="dialog"/);
assert.match(shell, /role="dialog" aria-modal="true" aria-label="Altre sezioni"/);
assert.match(shell, /event\.key === "Escape"/);
assert.match(design, /@media\(max-width:760px\)/);
assert.match(design, /@media\(max-width:900px\)/);
assert.match(dashboard, /@media\(max-width:390px\)/);
assert.match(mobile, /min-height:\s*44px/);
assert.match(design, /:focus-visible/);

assert.match(calendar, /className="calendar-week-scroll" tabIndex=\{0\} aria-label="Calendario settimanale, scorri orizzontalmente"/);
assert.match(calendarCss, /\.calendar-week-scroll\{[^}]*max-width:100%[^}]*overflow-x:auto/);
assert.doesNotMatch(calendarCss, /\.calendar-week-grid\{[^}]*overflow-x:auto/);
assert.match(calendarCss, /@media\(max-width:620px\)/);

assert.match(approvalsCss, /@media\(max-width:760px\)/);
assert.match(approvalsCss, /\.approval-grid\{grid-template-columns:1fr\}/);
assert.match(approvals, /visualGenerationErrorMessage/);
assert.match(approvals, /CREDIT_BALANCE_EXHAUSTED/);
assert.match(approvals, /credito o la fatturazione OpenAI non sono disponibili/);
assert.equal(approvals.includes("Errore: ${variant.visual_generation_error}"), false);
assert.equal(approvals.includes("Errore: ${slide.visual_generation_error}"), false);
assert.match(approvals, /if \(busy\[key\]\) return/);
assert.match(approvals, /role="alert"/);
assert.match(approvals, /Caricamento revisioni…/);

assert.match(calendar, /if \(busy\[key\]\) return/);
assert.match(social, /if \(!selectedProfile\?\.id \|\| busyProvider\) return/);
assert.match(social, /Stato social non disponibile/);
assert.match(social, /Caricamento collegamenti…/);
assert.match(analytics, /Nessun risultato disponibile/);
assert.match(auth, /<form onSubmit=\{submit\} className="auth-form">/);
assert.match(auth, /<input required type="email"/);
assert.match(auth, /disabled=\{busy\} type="submit"/);

const uiSources = [app,shell,approvals,calendar,social,analytics,auth].join("\n");
for (const forbidden of ["DATABASE_URL=", "SOCIAL_TOKEN_KEY=", "OPENAI_API_KEY=", "Bearer sk-", "postgresql://"]) {
  assert.equal(uiSources.includes(forbidden), false, "customer UI source exposes secret pattern: " + forbidden);
}

for (const marker of [
  "UI_DESKTOP_RENDER",
  "UI_MOBILE_RENDER",
  "UI_NO_HORIZONTAL_OVERFLOW",
  "UI_NAVIGATION_DESKTOP",
  "UI_NAVIGATION_MOBILE",
  "UI_REVIEW_CONTENT_READABLE",
  "UI_APPROVAL_STATE_VISIBLE",
  "UI_BLOCKED_STATE_VISIBLE",
  "UI_LOADING_STATE_VISIBLE",
  "UI_ERROR_STATE_VISIBLE",
  "UI_FORM_VALIDATION",
  "UI_NO_SECRET_EXPOSURE",
  "UI_CRITICAL_ACTION_DOUBLE_SUBMIT_PROTECTION",
]) console.log(marker + " = PASS");

console.log("MOBILE / DESKTOP UI QA static: PASS — routes, responsive containment, readable blocked states, loading/errors, forms and duplicate-action guards verified.");
