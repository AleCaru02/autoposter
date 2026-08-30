import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyAuthEndpoint, evaluateManagedAuthVerification } from "../cloudflare/managed-auth-capabilities.js";

const authSource = readFileSync(new URL("../src/pages/auth-pages.tsx", import.meta.url), "utf8");
const entrySource = readFileSync(new URL("../cloudflare/entry.ts", import.meta.url), "utf8");

assert.equal(authSource.includes("/api/auth/account-exists"), false, "auth UI must not query whether an email is registered");
assert.equal(authSource.includes("accountExists("), false, "auth UI must not branch on account existence");
assert.equal(authSource.includes("Non esiste un account con questa email"), false, "auth UI must not disclose that an email is unregistered");
assert.equal(authSource.includes("Password non corretta."), false, "login must not distinguish valid email from invalid credentials");
assert.equal(authSource.includes("Email o password non corretti."), true, "login must use a generic credential error");
assert.equal(authSource.includes("Se esiste un account associato a questa email"), true, "password reset must use a neutral confirmation");

const blockedRoute = 'if (path === "/api/auth/account-exists") return json({ error: "API_NOT_FOUND" }, 404);';
assert.equal(entrySource.includes(blockedRoute), true, "production Worker entry must block the legacy account-existence endpoint");
assert.equal(entrySource.indexOf(blockedRoute) < entrySource.indexOf("return worker.fetch(request, env);"), true, "legacy account-existence route must be blocked before fallback routing");

const managedAuthRoute = 'if (path === "/api/security/managed-auth-capabilities") return handleManagedAuthCapabilities(request, env);';
assert.equal(entrySource.includes(managedAuthRoute), true, "FASE 3 managed auth audit must be routed server-side");
assert.equal(entrySource.indexOf(managedAuthRoute) < entrySource.indexOf("return worker.fetch(request, env);"), true, "managed auth audit must run before asset/API fallback");

assert.equal(classifyAuthEndpoint(401), "PROTECTED");
assert.equal(classifyAuthEndpoint(403), "PROTECTED");
assert.equal(classifyAuthEndpoint(404), "ABSENT");
assert.equal(classifyAuthEndpoint(200), "UNSAFE");
assert.equal(classifyAuthEndpoint(null), "NETWORK_ERROR");

const adminColumns = [
  { table_name: "user", column_name: "role" },
  { table_name: "user", column_name: "banned" },
  { table_name: "user", column_name: "ban_reason" },
  { table_name: "user", column_name: "ban_expires" },
  { table_name: "session", column_name: "impersonated_by" },
];
const protectedStatuses = {
  listUsers: 401,
  setRole: 401,
  banUser: 403,
  listUserSessions: 401,
  impersonateUser: 403,
  stopImpersonating: 401,
};
const active = evaluateManagedAuthVerification(adminColumns, protectedStatuses, 200);
assert.equal(active.adminPluginActive, true, "admin plugin requires both schema fields and live protected endpoints");
assert.equal(active.ready, true);

const schemaOnly = evaluateManagedAuthVerification(adminColumns, { ...protectedStatuses, setRole: 404 }, 200);
assert.equal(schemaOnly.adminPluginActive, false, "schema fields alone must not be treated as active Admin Plugin");

const unsafe = evaluateManagedAuthVerification(adminColumns, { ...protectedStatuses, setRole: 200 }, 200);
assert.equal(unsafe.ready, false, "an unauthenticated successful admin endpoint must fail the capability audit");

console.log("auth security: PASS");
