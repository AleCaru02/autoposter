import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createHiggsfieldSoulId,
  getHiggsfieldSoulId,
  higgsfieldConfigured,
  normalizeHiggsfieldSoulState,
  parseHiggsfieldCredentials,
} from "../api/_lib/higgsfield.js";

const credentials = parseHiggsfieldCredentials("00000000-0000-4000-8000-000000000001:server-secret");
assert.deepEqual(credentials, { keyId: "00000000-0000-4000-8000-000000000001", keySecret: "server-secret" });
assert.equal(parseHiggsfieldCredentials(""), null);
assert.equal(parseHiggsfieldCredentials("missing-separator"), null);
assert.equal(higgsfieldConfigured("id:secret"), true);
assert.equal(higgsfieldConfigured(undefined), false);

let createAuthorization = "";
const created = await createHiggsfieldSoulId({
  credentials: credentials!,
  name: "Alessandro Personal Brand",
  imageUrls: ["https://example.com/reference.jpg"],
  fetcher: (async (input, init) => {
    assert.equal(String(input), "https://api.higgsfield.ai/v1/custom-references");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), `Key ${credentials!.keyId}:${credentials!.keySecret}`);
    assert.equal(headers.get("hf-api-key"), null);
    assert.equal(headers.get("hf-secret"), null);
    createAuthorization = String(init?.body || "");
    return Response.json({ id: "11111111-1111-4111-8111-111111111111", name: "Alessandro Personal Brand", status: "queued" });
  }) as typeof fetch,
});
assert.equal(created.status, "queued");
assert.match(createAuthorization, /"model_version":"v2"/);
assert.match(createAuthorization, /"type":"image_url"/);
assert.match(createAuthorization, /https:\/\/example\.com\/reference\.jpg/);

const fetched = await getHiggsfieldSoulId({
  credentials: credentials!,
  referenceId: "11111111-1111-4111-8111-111111111111",
  fetcher: (async (input, init) => {
    assert.equal(String(input), "https://api.higgsfield.ai/v1/custom-references/11111111-1111-4111-8111-111111111111");
    assert.equal(new Headers(init?.headers).get("authorization"), `Key ${credentials!.keyId}:${credentials!.keySecret}`);
    return Response.json({ id: "11111111-1111-4111-8111-111111111111", name: "Alessandro Personal Brand", status: "completed" });
  }) as typeof fetch,
});
assert.equal(fetched.status, "completed");
assert.equal(normalizeHiggsfieldSoulState("completed"), "COMPLETED");
assert.equal(normalizeHiggsfieldSoulState("in_progress"), "CREATING");
assert.equal(normalizeHiggsfieldSoulState("failed"), "FAILED");

const route = fs.readFileSync("cloudflare/personal-brand-visual.ts", "utf8");
assert.match(route, /verifiedCustomerAuthUserId/, "identity status must require a verified customer session");
assert.match(route, /owner_auth_user_id/, "identity status must remain owner scoped");
assert.match(route, /profile_type !== "PERSONAL_BRAND"/, "business profiles must not expose Personal Brand identity runtime");
assert.match(route, /getHiggsfieldSoulId/, "identity status route must poll Higgsfield training state");
assert.match(route, /normalizeHiggsfieldSoulState/, "provider status must be normalized fail-closed");
assert.doesNotMatch(route, /HF_CREDENTIALS.*json|keySecret.*json/i, "credentials must never be returned to the browser");

const wrangler = fs.readFileSync("wrangler.jsonc", "utf8");
assert.doesNotMatch(wrangler, /HF_CREDENTIALS/, "Higgsfield credentials must never be a public Worker var");

const deployWorkflow = fs.readFileSync(".github/workflows/deploy-worker.yml", "utf8");
assert.match(deployWorkflow, /'HF_CREDENTIALS'/, "production deploy must require the Higgsfield Worker secret binding");
assert.match(deployWorkflow, /binding\?\.name === 'HF_CREDENTIALS' && binding\?\.type === 'plain_text'/, "production verifier must reject a plain_text Higgsfield binding");
assert.match(deployWorkflow, /Higgsfield frontend secret absence regression/, "production build must scan frontend bundle and source maps for server-only Higgsfield identifiers");
assert.match(deployWorkflow, /HF_CREDENTIALS\|hf-api-key\|hf-secret/, "frontend leak scan must cover the secret binding and provider auth header names");

console.log("Higgsfield runtime credential boundary: PASS");
