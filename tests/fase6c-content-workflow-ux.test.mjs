import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const journey = readFileSync("src/components/customer-workflow-journey.tsx", "utf8");
const content = readFileSync("src/pages/content-generator-page.tsx", "utf8");
const approvals = readFileSync("src/pages/approvals-page.tsx", "utf8");
const calendar = readFileSync("src/pages/calendar-page.tsx", "utf8");
const css = readFileSync("src/workflow-journey.css", "utf8");
const calendarCss = readFileSync("src/calendar.css", "utf8");

for (const route of ["/app/contenuti", "/app/approvazioni", "/app/calendario"]) assert.ok(journey.includes(route), `journey route missing: ${route}`);
assert.match(journey, /aria-label="Percorso di pubblicazione"/, "journey navigation label missing");
assert.match(journey, /aria-current=\{active \? "step"/, "current workflow step semantics missing");
assert.match(content, /CustomerWorkflowJourney current="CREATE"/, "content step missing");
assert.match(approvals, /CustomerWorkflowJourney current="REVIEW"/, "review step missing");
assert.match(calendar, /CustomerWorkflowJourney current="PLAN"/, "calendar step missing");
assert.match(approvals, /Nessun contenuto da controllare/, "review empty state missing");
assert.match(approvals, /Apri Contenuti/, "review empty-state primary action missing");
assert.match(approvals, /providerLabel\(variant\.provider\)/, "customer-friendly social label missing");
assert.match(css, /\.calendar-manual\{display:block!important\}/, "manual scheduling exception must remain reachable");
assert.match(css, /@media\(max-width:620px\)/, "workflow mobile breakpoint missing");
assert.match(calendarCss, /\.calendar-manual/, "calendar manual flow unexpectedly removed");
for (const term of ["OpenAI", "GPT-Image-2"]) assert.equal(content.includes(term), false, `customer content flow exposes model name: ${term}`);

console.log("FASE 6C content workflow UX: PASS");
