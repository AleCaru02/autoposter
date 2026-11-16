import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encryptTokenBundle, decryptTokenBundle } from "../api/_lib/social.js";
import { authorizeExport, keyExportEnabled, reencryptReference } from "../api/_lib/social-key-export.js";

const keyA = "a".repeat(43), keyB = "b".repeat(43);
assert.equal(keyExportEnabled({}), false, "disabled by default");
assert.equal(keyExportEnabled({ DATABASE_URL: "x", SOCIAL_TOKEN_KEY: keyA, SOCIAL_TOKEN_KEY_NEXT: keyB }), false, "needs the explicit flag");
assert.equal(keyExportEnabled({ DATABASE_URL: "x", SOCIAL_TOKEN_KEY: keyA, SOCIAL_TOKEN_KEY_NEXT: keyA, SOCIAL_KEY_EXPORT_ENABLED: "true" }), false, "next key must differ");
assert.equal(keyExportEnabled({ DATABASE_URL: "x", SOCIAL_TOKEN_KEY: keyA, SOCIAL_TOKEN_KEY_NEXT: keyB, SOCIAL_KEY_EXPORT_ENABLED: "true" }), false, "needs the pinned profile");
const PROFILE = "08d029d7-40dd-4885-b0fb-1114206923b5";
const enabled = { DATABASE_URL: "x", SOCIAL_TOKEN_KEY: keyA, SOCIAL_TOKEN_KEY_NEXT: keyB, SOCIAL_KEY_EXPORT_ENABLED: "true", SOCIAL_KEY_EXPORT_PROFILE_ID: PROFILE };
assert.equal(keyExportEnabled(enabled), true);
// Authorization: owner only, pinned profile only.
const deps = (caller: string | null, owner: string | null) => ({ callerId: async () => caller, ownerId: async () => owner });
assert.equal(await authorizeExport(enabled, "t", PROFILE, deps("owner-1", "owner-1")), null, "the owner is allowed");
assert.equal(await authorizeExport(enabled, "t", PROFILE, deps("member-2", "owner-1")), "KEY_EXPORT_OWNER_REQUIRED", "a member with profile access is refused");
assert.equal(await authorizeExport(enabled, "t", PROFILE, deps(null, "owner-1")), "SESSION_INVALID", "an invalid or banned session is refused");
assert.equal(await authorizeExport(enabled, "t", PROFILE, deps("owner-1", null)), "KEY_EXPORT_OWNER_REQUIRED", "archived/unknown profile is refused");
assert.equal(await authorizeExport(enabled, "t", "73486d3c-dca0-4aaa-a69e-d4b08cc6430f", deps("owner-1", "owner-1")), "KEY_EXPORT_PROFILE_NOT_ALLOWED", "only the pinned profile");
assert.equal(await authorizeExport({ ...enabled, SOCIAL_KEY_EXPORT_ENABLED: "false" }, "t", PROFILE, deps("owner-1", "owner-1")), "KEY_EXPORT_DISABLED");

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
assert.match(handler, /authorizeExport\(env, auth, profileId\)/, "owner-only authorization");
assert.doesNotMatch(handler, /canAccessProfile/, "profile read access alone is not enough");
console.log("PASS social key export: disattivato di default, ricifratura verificata, solo connessioni verificate, nessun log.");
