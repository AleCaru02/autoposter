import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../src/pages/admin-ban-panel.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/pages/admin-pages.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../src/lib/admin-api.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/admin-ban.css", import.meta.url), "utf8");

assert.equal(page.includes('import { AdminBanPanel } from "./admin-ban-panel";'), true, "customer detail must import the canonical Ban UI panel");
assert.equal(page.includes("<AdminBanPanel"), true, "customer detail must render Ban UI for customer accounts");
assert.equal(page.includes('data.customer.platform_role === "SUPER_ADMIN"'), true, "SUPER_ADMIN target must remain explicit");
assert.equal(page.includes("Ban/Unban non disponibile per account SUPER_ADMIN."), true, "SUPER_ADMIN self-target Ban UI must be unavailable");
assert.equal(page.includes('adminRequest<AdminMe>("/api/admin/me")'), true, "Admin shell must keep server-authorized access boundary");
assert.equal(page.includes('if (state === "DENIED") return <Navigate to="/app/dashboard" replace />;'), true, "CUSTOMER/OWNER Admin UI must fail closed");

assert.equal(panel.includes('/api/admin/customers/${encodeURIComponent(customerId)}'), true, "Ban UI must derive its endpoint only from the opened customer id");
assert.equal(panel.includes('`${endpoint}/ban`'), true, "Ban UI must use the certified ban endpoint");
assert.equal(panel.includes('`${endpoint}/unban`'), true, "Ban UI must use the certified unban endpoint");
assert.equal(panel.includes('method: "POST"'), true, "Ban/Unban mutations must use POST");
assert.equal(panel.includes("adminRequest<BanMutationResponse>"), true, "Ban UI must reuse the existing Admin API client");
assert.equal(panel.includes("fetch("), false, "Ban UI must not create a second auth/fetch path");
assert.equal(client.includes("localStorage"), false, "Admin bearer token must not be persisted in browser storage");
assert.equal(client.includes("console.log"), false, "Admin client must not log credentials");

const bodyStart = panel.indexOf('const body: { reason?: string; expiresAt?: string } = {}');
const bodyEnd = panel.indexOf("const response = await adminRequest<BanMutationResponse>", bodyStart);
assert.ok(bodyStart >= 0 && bodyEnd > bodyStart, "Ban request body construction missing");
const bodyBlock = panel.slice(bodyStart, bodyEnd);
for (const forbidden of ["customerId", "userId", "auth_user_id", "role", "banned"]) {
  assert.equal(bodyBlock.includes(forbidden), false, `Ban request body must not carry target/authority field ${forbidden}`);
}
assert.equal(bodyBlock.includes("body.reason = trimmedReason"), true, "optional reason must be the only descriptive ban input");
assert.equal(bodyBlock.includes("body.expiresAt = expiresAt"), true, "optional expiry must be the only duration input");
assert.equal(panel.includes('adminRequest<BanMutationResponse>(`${endpoint}/unban`, { method: "POST" })'), true, "Unban must send no arbitrary body");

assert.equal(panel.includes("trimmedReason.length > 500"), true, "reason length guard missing");
assert.equal(panel.includes("maxLength={500}"), true, "reason input maxLength missing");
assert.equal(panel.includes("366 * 24 * 60 * 60 * 1000"), true, "temporary-ban maximum duration guard missing");
assert.equal(panel.includes('type="datetime-local"'), true, "temporary ban expiry input missing");
assert.equal(panel.includes("parsed.toISOString()"), true, "temporary ban must send an absolute ISO timestamp");
assert.equal(panel.includes("Lascia la scadenza vuota per un ban senza scadenza."), true, "permanent-ban semantics must be explicit");

const banAwait = panel.indexOf('await adminRequest<BanMutationResponse>(`${endpoint}/ban`');
const banState = panel.indexOf("setState({\n        banned: true", banAwait);
assert.ok(banAwait >= 0 && banState > banAwait, "Ban state must update only after backend success");
const unbanAwait = panel.indexOf('await adminRequest<BanMutationResponse>(`${endpoint}/unban`');
const unbanState = panel.indexOf("setState({ banned: false", unbanAwait);
assert.ok(unbanAwait >= 0 && unbanState > unbanAwait, "Unban state must update only after backend success");
assert.equal(panel.includes('response.customer.id !== customerId || response.customer.banned !== true'), true, "Ban success must validate returned target and canonical state");
assert.equal(panel.includes('response.customer.id !== customerId || response.customer.banned !== false'), true, "Unban success must validate returned target and canonical state");
assert.equal(panel.includes("Lo stato mostrato non è stato modificato."), true, "mutation failure must not claim or render success");
assert.equal(panel.includes("if (!endpoint || dialog !== \"BAN\" || busy) return;"), true, "Ban must fail closed for missing target and double submit");
assert.equal(panel.includes("if (!endpoint || dialog !== \"UNBAN\" || busy) return;"), true, "Unban must fail closed for missing target and double submit");

assert.equal(panel.includes('role="dialog"'), true, "Ban confirmation dialog semantics missing");
assert.equal(panel.includes('aria-modal="true"'), true, "Ban confirmation aria-modal missing");
assert.equal(panel.includes('aria-labelledby="ban-confirm-title"'), true, "Ban dialog title association missing");
assert.equal(panel.includes('aria-labelledby="unban-confirm-title"'), true, "Unban dialog title association missing");
assert.equal(panel.includes("autoFocus"), true, "destructive dialogs should focus a safe cancel action");
assert.equal(panel.includes('event.key === "Escape"'), true, "dialogs must support Escape cancellation while idle");
assert.equal(panel.includes(">Annulla</button>"), true, "confirmation cancel action missing");
assert.equal(panel.includes("Le vecchie sessioni revocate non vengono ripristinate."), true, "Unban UI must not imply restored sessions");
assert.equal(panel.includes("L’operazione non elimina i suoi dati."), true, "Ban UI must describe non-destructive data semantics");
assert.equal(panel.includes("dangerouslySetInnerHTML"), false, "Ban reason must render as ordinary escaped React text");

assert.equal(css.includes("@media(max-width:520px)"), true, "Ban UI mobile breakpoint missing");
assert.equal(css.includes(".admin-ban-meta{grid-template-columns:1fr}"), true, "Ban metadata must stack on mobile");
assert.equal(css.includes("width:100%"), true, "mobile Ban actions must remain reachable");
assert.equal(css.includes("max-height:calc(100vh - 36px)"), true, "Ban modal must remain inside short viewports");
assert.equal(css.includes("overflow:auto"), true, "Ban modal must allow contained scrolling");

console.log("Admin Ban Unban UI regression: PASS");
