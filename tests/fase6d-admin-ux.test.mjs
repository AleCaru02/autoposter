import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync("src/pages/admin-pages.tsx", "utf8");
const css = readFileSync("src/admin-rebrand.css", "utf8");

assert.match(page, /adminRequest<AdminMe>\("\/api\/admin\/me"\)/, "server-authorized admin boundary missing");
assert.match(page, /body\.platformRole === "SUPER_ADMIN"/, "SUPER_ADMIN response check missing");
assert.match(page, /if \(state === "DENIED"\) return <Navigate to="\/app\/dashboard" replace \/>/, "admin UI must fail closed");
assert.match(page, /aria-label="Filtri clienti"/, "customer filters missing");
assert.match(page, /type="search" placeholder="Nome o email"/, "customer search missing");
for (const value of ["ACTIVE", "INCOMPLETE", "BANNED"]) assert.ok(page.includes(`<option value="${value}">`), `customer status filter missing: ${value}`);
assert.match(page, /data-label="Onboarding"/, "responsive customer row labels missing");
assert.match(page, /aria-label="Filtri attività"/, "activity filters missing");
assert.match(page, /<ProductBrand compact \/>/, "canonical product identity missing from Admin");
assert.match(css, /background:#fff;color:var\(--color-ink-950\)/, "Admin shell must use the light product direction");
assert.match(css, /@media\(max-width:700px\)/, "Admin mobile breakpoint missing");
assert.match(css, /content:attr\(data-label\)/, "mobile table labels missing");
assert.match(css, /\.admin-customers-table thead\{display:none\}/, "customer table must switch to mobile cards");

console.log("FASE 6D admin UX: PASS");
