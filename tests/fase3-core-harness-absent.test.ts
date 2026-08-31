import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const entry = readFileSync(new URL("../cloudflare/entry.ts", import.meta.url), "utf8");
const adminApi = readFileSync(new URL("../cloudflare/admin-api.ts", import.meta.url), "utf8");
const deploy = readFileSync(new URL("../.github/workflows/deploy-worker.yml", import.meta.url), "utf8");

for (const path of [
  "../cloudflare/fase3-qa-control.ts",
  "../tests/fase3-runtime-qa.ts",
  "../tests/fase3-audit-detail-runtime.ts",
  "../tests/fase3-qa-control.test.ts",
  "../tests/fase3-browser-qa.mjs",
  "../.github/workflows/fase3-runtime-qa.yml",
]) {
  assert.equal(existsSync(new URL(path, import.meta.url)), false, `temporary FASE 3 harness residue: ${path}`);
}

assert.equal(entry.includes("handleFase3QaControl"), false, "temporary QA handler must be physically absent");
assert.equal(entry.includes("FASE3_QA_TOKEN"), false, "temporary QA secret binding must be physically absent");
assert.equal(entry.includes('/api/internal/fase3/qa-control'), false, "temporary QA route must not be registered");

for (const action of [
  "ADMIN_ACCESS",
  "ADMIN_OVERVIEW_VIEW",
  "ADMIN_CUSTOMERS_LIST",
  "ADMIN_CUSTOMER_DETAIL_VIEW",
  "ADMIN_ACTIVITIES_LIST",
]) assert.equal(adminApi.includes(`"${action}"`), true, `permanent audit writer missing ${action}`);

// Sensitive key names may legitimately appear in a defensive redaction deny-list.
// What the permanent CORE contract forbids is sourcing credentials from the
// request/browser and persisting them into audit metadata.
assert.equal(adminApi.includes("request.headers.get"), false, "Admin audit/API must not read browser headers for audit metadata");
assert.equal(adminApi.includes("request.json("), false, "read-only Admin audit/API must not accept browser bodies for audit metadata");
assert.equal(adminApi.includes("authorization: ") || adminApi.includes("cookie: "), false, "Admin audit/API must not construct persisted credential fields");
assert.equal(adminApi.includes("access_token:") || adminApi.includes("refresh_token:"), false, "Admin audit/API must not persist OAuth tokens");
assert.equal(adminApi.includes("JSON.stringify(metadata)"), true, "Admin audit metadata must remain explicit server-generated metadata");
assert.equal(adminApi.includes("DATABASE_URL") && adminApi.includes("metadata"), true, "Admin audit remains server-side and metadata-bound");

assert.equal(deploy.includes('/api/internal/fase3/qa-control'), true, "normal deploy must verify the removed QA route is 404");
assert.equal(deploy.includes("FASE3_QA_TOKEN"), true, "normal deploy must verify the removed QA secret name is absent");

console.log("FASE 3 permanent harness absence/audit regression: PASS");
