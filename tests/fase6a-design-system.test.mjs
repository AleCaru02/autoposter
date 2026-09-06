import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync("src/components/app-shell.tsx", "utf8");
const brand = readFileSync("src/components/product-brand.tsx", "utf8");
const auth = readFileSync("src/pages/auth-pages.tsx", "utf8");
const css = readFileSync("src/design-system.css", "utf8");
const main = readFileSync("src/main.tsx", "utf8");

assert.match(css, /--color-brand-500:#19c95d/, "canonical bright-green brand token missing");
assert.match(css, /--color-ink-950:#111713/, "canonical anthracite text token missing");
assert.match(css, /--color-surface:#ffffff/, "white surface token missing");
assert.match(css, /--space-10:40px/, "spacing scale incomplete");
assert.match(css, /--radius-lg:20px/, "radius scale incomplete");
assert.match(css, /:focus-visible/, "keyboard focus treatment missing");
assert.match(css, /prefers-reduced-motion:reduce/, "reduced-motion support missing");
assert.match(css, /@media\(max-width:760px\)/, "mobile shell breakpoint missing");
assert.match(css, /@media\(max-width:900px\)/, "tablet shell breakpoint missing");
assert.match(main, /import "\.\/design-system\.css";/, "design-system layer must load globally");

for (const group of ["Oggi", "Crea e pubblica", "Canali e risultati", "La tua attività"]) {
  assert.ok(shell.includes(`label: "${group}"`), `navigation group missing: ${group}`);
}
assert.match(shell, /aria-label="Navigazione principale"/, "desktop navigation landmark missing");
assert.match(shell, /aria-label="Navigazione principale mobile"/, "mobile navigation landmark missing");
assert.match(shell, /className="skip-link"/, "keyboard skip link missing");
assert.match(shell, /id="main-content" tabIndex=\{-1\}/, "skip-link target must be programmatically focusable");
assert.match(shell, /<ProductBrand \/>/, "desktop product identity missing");
assert.match(shell, /<ProductBrand compact \/>/, "mobile product identity missing");
assert.match(brand, /Il tuo social team AI/, "customer-facing product promise missing");
assert.match(auth, /Gestisci contenuti, calendario e risultati social con l’AI/, "auth value proposition missing");

for (const forbidden of ["entitlement engine", "technical usage event", "internal capability key", "token budget"]) {
  assert.equal(shell.toLowerCase().includes(forbidden), false, `customer shell exposes technical term: ${forbidden}`);
  assert.equal(auth.toLowerCase().includes(forbidden), false, `auth surface exposes technical term: ${forbidden}`);
}

console.log("FASE 6A design system and app shell: PASS");
