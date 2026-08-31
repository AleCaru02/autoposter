import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../src/pages/admin-pages.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../src/lib/admin-api.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/admin.css", import.meta.url), "utf8");

const sessionsStart = page.indexOf("type AdminSession");
const sessionsEnd = page.indexOf("function CustomerDetailPage");
assert.ok(sessionsStart >= 0 && sessionsEnd > sessionsStart, "Session UI block missing");
const sessionUi = page.slice(sessionsStart, sessionsEnd);
const sessionType = page.slice(sessionsStart, page.indexOf("type ConfirmAction", sessionsStart));

assert.equal(page.includes("<CustomerSessions customerId={data.customer.auth_user_id} />"), true, "customer detail must reuse the existing detail page for Session Management");
assert.equal(page.includes("/api/admin/customers/${encodeURIComponent(customerId)}/sessions"), true, "Session UI must fetch the certified customer-scoped endpoint");
assert.equal(sessionUi.includes("Caricamento sessioni…"), true, "Session loading state missing");
assert.equal(sessionUi.includes("admin-session-list"), true, "Session loaded state missing");
assert.equal(sessionUi.includes("Nessuna sessione attiva."), true, "Session empty state missing");
assert.equal(sessionUi.includes("Sessioni non disponibili. Riprova."), true, "Session error state missing");
assert.equal(sessionUi.includes(">Riprova</button>"), true, "Session retry action missing");
assert.equal(sessionUi.includes("setSessions([]);"), true, "Session load must clear stale rows before/after a failed refresh");
assert.equal(sessionUi.includes("const [loadError"), true, "load error must be separate from mutation error");
assert.equal(sessionUi.includes("const [mutationError"), true, "mutation error must not replace the loaded session list");

for (const safe of ["id", "createdAt", "updatedAt", "expiresAt", "ipAddress", "userAgent"]) {
  assert.equal(sessionType.includes(`${safe}:`), true, `AdminSession safe field missing: ${safe}`);
}
for (const forbidden of ["token", "userId", "impersonatedBy", "activeOrganizationId", "jwt", "cookie"]) {
  assert.equal(sessionType.toLowerCase().includes(forbidden.toLowerCase()), false, `AdminSession frontend type must not contain ${forbidden}`);
  assert.equal(sessionUi.includes(`session.${forbidden}`), false, `Session UI must not access ${forbidden}`);
}
assert.equal(page.includes("dangerouslySetInnerHTML"), false, "session metadata must be rendered as ordinary escaped React text");
assert.equal(sessionUi.includes("<script>"), false, "Session UI must not embed executable HTML fixtures or markup");
assert.equal(sessionUi.includes("fetch("), false, "Session UI must use the existing Admin API client, not a second fetch/auth path");
assert.equal(sessionUi.includes("adminRequest<"), true, "Session UI must route through the existing Admin API client");
assert.equal(sessionUi.includes("body:"), false, "Session mutations must not send an arbitrary target userId body");
assert.equal(client.includes("console.log"), false, "Admin API client must not log auth/session credentials");
assert.equal(client.includes("localStorage"), false, "Admin API client must not persist the Admin token in browser storage");

for (const browser of ["Chrome", "Safari", "Firefox", "Edge", "Browser non disponibile"]) {
  assert.equal(sessionUi.includes(`\"${browser}\"`), true, `conservative browser fallback/parsing missing: ${browser}`);
}
assert.equal(sessionUi.includes("iPhone"), true, "coarse iPhone platform label missing");
assert.equal(sessionUi.includes("Android"), true, "coarse Android platform label missing");
assert.equal(sessionUi.includes("Dispositivo non disponibile"), true, "device fallback missing");
for (const invented of ["Trusted", "Suspicious", "Compromised", "Sicura", "Sospetta"]) {
  assert.equal(sessionUi.includes(invented), false, `unsupported session status must not be invented: ${invented}`);
}
assert.equal(sessionUi.includes('return expiry > Date.now() ? "Attiva" : "Scaduta"'), true, "session status must derive only from expiresAt");
assert.equal(page.match(/timeZone: "Europe\/Rome"/g)?.length, 2, "Admin date formatting must use Europe/Rome consistently");
assert.equal(page.includes('Number.isNaN(date.getTime()) ? "Non disponibile"'), true, "invalid dates must fail to a readable fallback");
assert.equal(sessionUi.includes("Nessuna geolocalizzazione dell’IP."), true, "UI must explicitly avoid IP geolocation semantics");
assert.equal(sessionUi.includes("geo"), true, "expected no-geolocation product copy missing");
assert.equal(sessionUi.includes("https://"), false, "Session UI must not call external IP/device lookup services");

assert.equal(sessionUi.includes('if (!endpoint || !confirmAction || busy) return;'), true, "revoke must fail closed for missing customer target and double submit");
assert.equal(sessionUi.includes('disabled={busy}>Revoca sessione</button>'), true, "single revoke button must disable during mutation");
const revokeAllRender = '!loading && !loadError && sessions.length > 0 ? <button type="button" className="admin-danger-button" onClick={() => setConfirmAction({ kind: "all" })} disabled={!endpoint || busy}>Revoca tutte le sessioni</button> : null';
assert.equal(sessionUi.includes(revokeAllRender), true, "revoke-all must be rendered only after a successful non-empty list load");
assert.equal(sessionUi.includes('disabled={!endpoint || loading || busy || Boolean(loadError) || sessions.length === 0}'), false, "empty/loading state must not leave a disabled revoke-all button rendered");
assert.equal(sessionUi.includes('`${endpoint}/${encodeURIComponent(confirmAction.session.id)}`'), true, "single revoke must use only the opened customer endpoint plus safe session id");
assert.equal(sessionUi.includes('{ method: "DELETE" }'), true, "Session revoke mutations must use DELETE");
assert.equal(sessionUi.includes("setRefreshKey((value) => value + 1)"), true, "successful revoke must refresh the canonical list");
assert.equal(sessionUi.includes("La lista non è stata modificata e nessun successo è stato mostrato."), true, "mutation failure must not claim success or remove a session");
const firstAwait = sessionUi.indexOf("await adminRequest");
const firstFeedback = sessionUi.indexOf("setFeedback(\"Sessione revocata");
assert.ok(firstAwait >= 0 && firstFeedback > firstAwait, "single revoke success feedback must occur only after backend success");

assert.equal(page.includes('if (!data.customer.auth_user_id) return <ErrorState message="Identificatore cliente non disponibile. Gestione sessioni bloccata." />;'), true, "missing target must not fall back to current SUPER_ADMIN");
assert.equal(page.includes('data.customer.platform_role === "SUPER_ADMIN"'), true, "SUPER_ADMIN target must be handled explicitly");
assert.equal(page.includes("Gestione sessioni non disponibile per account SUPER_ADMIN."), true, "Admin session self-target UI must be unavailable");
assert.equal(page.includes('adminRequest<AdminMe>("/api/admin/me")'), true, "Admin shell must keep server-authorized CUSTOMER/OWNER denial boundary");
assert.equal(page.includes('if (state === "DENIED") return <Navigate to="/app/dashboard" replace />;'), true, "CUSTOMER/OWNER Admin UI must fail closed after /api/admin/me denial");

assert.equal(sessionUi.includes('role="dialog"'), true, "revoke modal dialog semantics missing");
assert.equal(sessionUi.includes('aria-modal="true"'), true, "revoke modal aria-modal missing");
assert.equal(sessionUi.includes('aria-labelledby="session-confirm-title"'), true, "revoke modal title association missing");
assert.equal(sessionUi.includes("autoFocus"), true, "revoke modal should place focus on a safe action");
assert.equal(sessionUi.includes('event.key === "Escape"'), true, "revoke modal should support Escape cancel while idle");
assert.equal(sessionUi.includes(">Annulla</button>"), true, "revoke modal cancel action missing");

assert.equal(css.includes("grid-template-columns:repeat(4,minmax(0,1fr))"), true, "desktop session metadata grid missing");
assert.equal(css.includes("@media(max-width:520px)"), true, "mobile breakpoint missing");
assert.equal(css.includes(".admin-session-details{grid-template-columns:1fr}"), true, "mobile session metadata must stack");
assert.equal(css.includes(".admin-session-revoke{width:100%}"), true, "mobile single revoke CTA must remain reachable");
assert.equal(css.includes(".admin-section-heading>.admin-danger-button{width:100%}"), true, "mobile revoke-all CTA must remain reachable");
assert.equal(css.includes("max-height:calc(100vh - 36px)"), true, "modal must remain inside short mobile viewports");
assert.equal(css.includes("overflow:auto"), true, "modal/session layout must permit contained scrolling instead of viewport clipping");

console.log("Admin session UI regression: PASS");