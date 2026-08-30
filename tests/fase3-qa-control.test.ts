import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleFase3QaControl } from "../cloudflare/fase3-qa-control.js";

const source = readFileSync(new URL("../cloudflare/fase3-qa-control.ts", import.meta.url), "utf8");
const entry = readFileSync(new URL("../cloudflare/entry.ts", import.meta.url), "utf8");

const missing = await handleFase3QaControl(new Request("https://example.test/api/internal/fase3/qa-control", { method: "POST" }), {});
assert.equal(missing.status, 404, "QA control must not exist without the ephemeral secret");

const wrong = await handleFase3QaControl(new Request("https://example.test/api/internal/fase3/qa-control", {
  method: "POST",
  headers: { "x-fase3-qa-token": "wrong" },
}), { FASE3_QA_TOKEN: "correct" });
assert.equal(wrong.status, 403, "QA control must reject the wrong secret");

const invalidMarker = await handleFase3QaControl(new Request("https://example.test/api/internal/fase3/qa-control", {
  method: "POST",
  headers: { "x-fase3-qa-token": "correct", "content-type": "application/json" },
  body: JSON.stringify({ action: "state", marker: "../real-user" }),
}), { FASE3_QA_TOKEN: "correct", DATABASE_URL: "postgresql://not-used.invalid/db" });
assert.equal(invalidMarker.status, 400, "QA marker must be strictly constrained before DB access");

assert.equal(source.includes("fase3-qa-${marker}-%@example.invalid"), true, "QA DB scope must be restricted to generated QA emails");
assert.equal(source.includes('users.length > 3'), true, "cleanup must fail closed if QA scope expands unexpectedly");
assert.equal(source.includes("delete from neon_auth.user where id::text = ${user.id}"), true, "cleanup may delete only IDs first resolved from the QA email scope");
assert.equal(source.includes("targetAuthUserId") || source.includes("userId: body") || source.includes("body.userId"), false, "QA control must never accept an arbitrary auth user id");
assert.equal(entry.includes('path === "/api/internal/fase3/qa-control"'), true);

console.log("fase3 QA control security: PASS");
