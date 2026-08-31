import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizePlatformRole, requireSuperAdmin } from "../cloudflare/platform-rbac.js";

const api = readFileSync(new URL("../cloudflare/admin-api.ts", import.meta.url), "utf8");
const ui = readFileSync(new URL("../src/pages/admin-audit-page.tsx", import.meta.url), "utf8");
const adminPages = readFileSync(new URL("../src/pages/admin-pages.tsx", import.meta.url), "utf8");
const entry = readFileSync(new URL("../cloudflare/entry.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../db/migrations/20260830_platform_admin_audit.sql", import.meta.url), "utf8");

const denied = await requireSuperAdmin(new Request("https://example.test/api/admin/audit"), {});
assert.equal(denied.ok, false, "unauthenticated/customer Audit API must fail closed");
if (!denied.ok) assert.equal(denied.response.status, 401);
assert.equal(normalizePlatformRole("OWNER"), "CUSTOMER", "workspace OWNER must remain denied from global Audit API");
assert.equal(normalizePlatformRole("user"), "CUSTOMER");
assert.equal(normalizePlatformRole("admin"), "SUPER_ADMIN");

assert.equal(entry.includes('path.startsWith("/api/admin/")'), true, "Audit API must use central Admin handler");
assert.equal(api.includes('if (path === "/api/admin/audit")'), true, "Audit API endpoint missing");
assert.equal(api.indexOf("requireSuperAdmin(request, env)") < api.indexOf('if (path === "/api/admin/audit")'), true, "privileged Audit SQL must run only after requireSuperAdmin");
assert.equal(api.includes("hasDuplicateAuditParams(url.searchParams)"), true, "duplicate Audit params must be rejected");
assert.equal(api.includes('positiveInteger(url.searchParams.get("limit"), 25, 100)'), true, "Audit limit must be capped server-side");
assert.equal(api.includes('positiveInteger(url.searchParams.get("page"), 1, 100000)'), true, "Audit page must be validated");
for (const filter of ["action", "actor", "target", "from", "to"]) assert.equal(api.includes(`url.searchParams.get("${filter}")`), true, `Audit ${filter} filter missing`);
assert.equal(api.includes("INVALID_AUDIT_DATE_RANGE"), true, "reversed Audit date range must be rejected");
assert.equal(api.includes("order by a.created_at desc, a.id desc"), true, "Audit pagination order must be stable and newest-first");
assert.equal(api.includes("limit ${limit} offset ${offset}"), true, "Audit pagination must be parameterized");
assert.equal(api.includes("${action}") && api.includes("${actor}") && api.includes("${target}"), true, "Audit filters must use parameterized SQL values");
assert.equal(api.includes("safeAuditMetadata(row.metadata)"), true, "Audit metadata must be sanitized before response");
for (const sensitive of ["password", "jwt", "authorization", "cookie", "sessiontoken", "accesstoken", "refreshtoken", "apikey", "databaseurl", "clientsecret"]) {
  assert.equal(api.includes(`"${sensitive}"`), true, `Audit backend sensitive-key defense missing ${sensitive}`);
}
assert.equal(api.includes('"[REDACTED]"'), true, "sensitive Audit metadata must be redacted");
assert.equal(migration.includes("REVOKE ALL ON TABLE public.platform_admin_audit FROM authenticated"), true, "browser/customer direct Audit DB access must remain revoked");

assert.equal(adminPages.includes('to="/admin/audit"'), true, "Audit navigation link missing");
assert.equal(adminPages.includes('path="audit" element={<AdminAuditPage />}'), true, "Audit Admin route missing");
assert.equal(ui.includes('adminRequest<AuditResponse>(path)'), true, "Audit UI must use protected Admin API client");
for (const field of ["Azione", "Actor", "Target", "Da", "A"]) assert.equal(ui.includes(`>${field}<`), true, `Audit UI filter missing ${field}`);
assert.equal(ui.includes('type="datetime-local"'), true, "Audit dates must capture local date/time explicitly");
assert.equal(ui.includes("toISOString()"), true, "Audit local date/time must be converted to an absolute ISO timestamp");
assert.equal(ui.includes("KNOWN_ACTIONS[action]"), true, "known Audit actions should have readable labels");
assert.equal(ui.includes('replace(/^ADMIN_/, "")'), true, "unknown future Audit action types need a readable fallback");
assert.equal(ui.includes("Nessun evento trovato."), true, "Audit empty state missing");
assert.equal(ui.includes("Audit non disponibile."), true, "Audit error state missing");
assert.equal(ui.includes("Caricamento…"), true, "Audit loading state missing");
assert.equal(ui.includes("admin-pagination"), true, "Audit pagination UI missing");
assert.equal(ui.includes("admin-audit-desktop") && ui.includes("admin-audit-mobile"), true, "Audit desktop/mobile renderers missing");
assert.equal(ui.includes("dangerouslySetInnerHTML"), false, "Audit metadata must never use raw HTML rendering");
assert.equal(ui.includes("platform_admin_audit"), false, "browser must not access Audit DB table directly");
assert.equal(ui.includes("localStorage") || ui.includes("sessionStorage"), false, "Audit authorization/filter state must not use browser storage");
assert.equal(entry.includes("/api/internal/fase3/qa-control"), false, "Audit Viewer must not reintroduce temporary FASE 3 QA route");

console.log("Admin audit viewer regression: PASS");
