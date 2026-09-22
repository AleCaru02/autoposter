import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bootstrap = readFileSync("db/migrations/20260713_canonical_schema_bootstrap.sql", "utf8");
const grants = readFileSync("db/migrations/20260903_fase4b_authenticated_entitlement_read_grants.sql", "utf8");
const foundation = readFileSync("db/migrations/20260903_fase4b_entitlement_usage_foundation.sql", "utf8");
const publication = readFileSync("db/migrations/20260908_fase7f_safe_publication_engine.sql", "utf8");

const requiredCoreTables = [
  "app_users","profiles","profile_members","brand_profiles","website_scans","website_pages",
  "content_strategies","assets","content_items","content_variants","social_connections",
  "schedules","publication_jobs","publication_attempts","ai_usage_events","audit_log",
] as const;

for (const table of requiredCoreTables) {
  assert.match(
    bootstrap,
    new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`, "i"),
    `canonical bootstrap must create ${table}`,
  );
}

for (const table of ["profile_entitlements","capability_usage_events","capability_usage_buckets"]) {
  assert.match(
    bootstrap,
    new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`, "i"),
    `${table} must exist before the alphabetically-earlier FASE 4B grants migration`,
  );
  assert.match(grants, new RegExp(`GRANT\\s+SELECT[\\s\\S]*public\\.${table}[\\s\\S]*authenticated`, "i"));
}

assert.match(bootstrap, /CREATE OR REPLACE FUNCTION public\.current_auth_user_id\(\)/i);
assert.match(bootstrap, /CREATE OR REPLACE FUNCTION public\.current_app_user_id\(\)/i);
assert.match(bootstrap, /CREATE OR REPLACE FUNCTION public\.owns_profile\(p_profile_id uuid\)/i);

assert.match(
  bootstrap,
  /CREATE POLICY publication_attempts_bootstrap_owner[\s\S]*FROM public\.publication_jobs job[\s\S]*job\.id = publication_attempts\.job_id/i,
  "publication attempts must derive tenant scope through publication_jobs.profile_id",
);
const publicationAttemptsTable = /CREATE TABLE IF NOT EXISTS public\.publication_attempts \(([\s\S]*?)\n\);/i.exec(bootstrap)?.[1] ?? "";
assert.ok(publicationAttemptsTable, "publication_attempts definition must be readable");
assert.doesNotMatch(
  publicationAttemptsTable,
  /\bprofile_id\b/i,
  "publication_attempts must not duplicate tenant ownership; job_id is the tenant link",
);
assert.doesNotMatch(
  publicationAttemptsTable,
  /\bprovider\b/i,
  "publication_attempts provider is derived from its publication job",
);

assert.match(bootstrap, /UNIQUE \(profile_id, capability_key\)/i);
assert.match(bootstrap, /UNIQUE \(profile_id, capability_key, idempotency_key\)/i);
assert.match(bootstrap, /PRIMARY KEY \(profile_id, capability_key, period_start, period_end\)/i);
assert.match(bootstrap, /REFERENCES public\.profiles\(id\) ON DELETE CASCADE/i);
assert.match(bootstrap, /capability_usage_events_state_check CHECK \(state IN \('RESERVED','COMMITTED','RELEASED'\)\)/i);
assert.match(bootstrap, /profile_entitlements_period_type_check CHECK \(period_type IN \('NONE','DAY','MONTH','CUSTOM'\)\)/i);

assert.doesNotMatch(bootstrap, /reserve_capability_usage\s*\(/i, "FASE 4B functions must remain owned by the FASE 4B migration");
assert.doesNotMatch(bootstrap, /bootstrap_profile_entitlements\s*\(/i, "FASE 4B entitlement population must not be anticipated");
assert.doesNotMatch(bootstrap, /profile_entitlements_customer_read/i, "FASE 4B read policy must remain in the FASE 4B migration");
assert.doesNotMatch(bootstrap, /profile_entitlements_profile_idx/i, "FASE 4B index must remain in the FASE 4B migration");
assert.doesNotMatch(bootstrap, /stripe|subscription_id|price_id|customer_id/i, "canonical bootstrap must stay billing-provider independent");

assert.match(foundation, /CREATE POLICY profile_entitlements_customer_read/i);
assert.match(foundation, /CREATE OR REPLACE FUNCTION public\.reserve_capability_usage/i);
assert.match(foundation, /CREATE TRIGGER profile_entitlements_bootstrap_trigger/i);

for (const column of ["error_code","error_message","provider_request_id"]) {
  assert.match(
    publication,
    new RegExp(`ALTER TABLE public\\.publication_attempts ADD COLUMN IF NOT EXISTS ${column}\\b`, "i"),
    `FASE 7F must version its own ${column} column before functions use it`,
  );
}
assert.doesNotMatch(
  publication,
  /INSERT INTO public\.publication_attempts\([\s\S]*?profile_id[\s\S]*?provider[\s\S]*?\)/i,
  "FASE 7F must not write non-canonical publication_attempts tenant/provider columns",
);

console.log("canonical bootstrap regression: PASS");
