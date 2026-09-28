import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workerConfig = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const deployWorkflow = readFileSync(new URL("../.github/workflows/deploy-worker.yml", import.meta.url), "utf8");
const socialSource = readFileSync(new URL("../api/_lib/social.ts", import.meta.url), "utf8");

const config = JSON.parse(workerConfig) as {
  keep_vars?: boolean;
  vars?: Record<string, string>;
};
const vars = config.vars ?? {};

assert.equal(vars.SAFE_MODE, "true", "FASE 6 must not disable Safe Mode");
assert.equal(vars.APP_BASE_URL, "https://autoposter.02alessandrocaruso.workers.dev", "OAuth callbacks must use the canonical Cloudflare production origin");
assert.equal(vars.META_GRAPH_VERSION, "v26.0", "Meta Graph version must be explicit in production config");
assert.equal(vars.LINKEDIN_API_VERSION, "202608", "LinkedIn API version must be explicit in production config");
assert.equal(vars.LINKEDIN_ORGANIZATION_ACCESS, "false", "organization mode must remain disabled until provider approval is explicitly available");
assert.equal(config.keep_vars, true, "Cloudflare dashboard bindings not declared in wrangler must be preserved");

for (const name of [
  "DATABASE_URL",
  "SOCIAL_TOKEN_KEY",
  "META_APP_SECRET",
  "LINKEDIN_CLIENT_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
]) {
  assert.match(deployWorkflow, new RegExp(`['"]${name}['"]`), `${name} must be part of the production binding preflight`);
}

for (const sourceName of [
  "SOCIAL_TOKEN_KEY_SOURCE",
  "META_APP_SECRET_SOURCE",
  "LINKEDIN_CLIENT_SECRET_SOURCE",
  "GOOGLE_CLIENT_ID_SOURCE",
  "GOOGLE_CLIENT_SECRET_SOURCE",
]) {
  assert.match(deployWorkflow, new RegExp(sourceName), `${sourceName} must be optionally provisioned from GitHub secrets when available`);
}

assert.match(deployWorkflow, /wrangler secret list --format json/, "deploy must verify the real Worker secret binding names after deployment");
assert.match(socialSource, /const callbackUri = `\$\{baseUrl\(env, request\.url\)\}\/api\/social\/callback\/\$\{provider\.toLowerCase\(\)\}`;/, "OAuth callback URI must be generated from the canonical server base URL");
assert.match(socialSource, /if \(!await canAccessProfile\(profileId, token\)\) return socialJson\(\{ error: "PROFILE_NOT_FOUND" \}, 404\);/, "CONNECT must remain profile-isolated");
assert.match(socialSource, /if \(!await canAccessProfile\(profileId, auth\)\) return socialJson\(\{ error: "PROFILE_NOT_FOUND" \}, 404\);/, "SELECT and DISCONNECT must remain profile-isolated");
assert.match(socialSource, /insert into public\.social_oauth_callbacks \(nonce, profile_id, provider, status, expires_at\)/, "OAuth callbacks must retain durable single-use nonce claiming");
assert.match(socialSource, /encryptTokenBundle/, "provider tokens must remain encrypted before persistence");
assert.doesNotMatch(deployWorkflow, /GEMINI_API_KEY|gemini/i, "FASE 6 deploy must remain OpenAI-only");

console.log("social runtime preflight: PASS");
