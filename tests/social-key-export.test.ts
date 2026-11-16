import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encryptTokenBundle, decryptTokenBundle } from "../api/_lib/social.js";
import { keyExportEnabled, reencryptReference } from "../api/_lib/social-key-export.js";

const keyA = "a".repeat(43), keyB = "b".repeat(43);
assert.equal(keyExportEnabled({}), false, "disabled by default");
assert.equal(keyExportEnabled({ DATABASE_URL: "x", SOCIAL_TOKEN_KEY: keyA, SOCIAL_TOKEN_KEY_NEXT: keyB }), false, "needs the explicit flag");
assert.equal(keyExportEnabled({ DATABASE_URL: "x", SOCIAL_TOKEN_KEY: keyA, SOCIAL_TOKEN_KEY_NEXT: keyA, SOCIAL_KEY_EXPORT_ENABLED: "true" }), false, "next key must differ");
assert.equal(keyExportEnabled({ DATABASE_URL: "x", SOCIAL_TOKEN_KEY: keyA, SOCIAL_TOKEN_KEY_NEXT: keyB, SOCIAL_KEY_EXPORT_ENABLED: "true" }), true);

const original = await encryptTokenBundle({ accessToken: "page-token", refreshToken: "refresh", expiresAt: "2027-01-01T00:00:00Z" }, keyA);
const next = await reencryptReference(original, keyA, keyB);
assert.notEqual(next, original);
const opened = await decryptTokenBundle(next, keyB);
assert.equal(opened.accessToken, "page-token");
assert.equal(opened.refreshToken, "refresh");
await assert.rejects(decryptTokenBundle(next, keyA), "the old key cannot open the new ciphertext");
await assert.rejects(reencryptReference(original, keyB, keyA), "a wrong current key fails without output");

const source = readFileSync(new URL("../api/_lib/social-key-export.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /console\.(log|error|info|warn)/, "never logs");
assert.match(source, /revoke all on public\.social_token_exports from authenticated/, "export table is server-only");
assert.match(source, /lastVerification'->>'ok'\)='true'/, "only provider-verified connections are exported");
const social = readFileSync(new URL("../api/_lib/social.ts", import.meta.url), "utf8");
const handler = social.slice(social.indexOf("async function handleKeyExport"), social.indexOf("async function handleDisconnect"));
assert.ok(handler.indexOf("keyExportEnabled(env)") < handler.indexOf("bearer(request)"), "disabled endpoint answers 404 before anything else");
assert.match(handler, /canAccessProfile\(profileId, auth\)/, "owner-only");
console.log("PASS social key export: disattivato di default, ricifratura verificata, solo connessioni verificate, nessun log.");
