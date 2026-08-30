import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

console.log("auth security: PASS");
