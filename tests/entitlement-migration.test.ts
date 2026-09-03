import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const foundation = readFileSync(new URL("../db/migrations/20260903_fase4b_entitlement_usage_foundation.sql", import.meta.url), "utf8");
const grants = readFileSync(new URL("../db/migrations/20260903_fase4b_authenticated_entitlement_read_grants.sql", import.meta.url), "utf8");

function expect(pattern: RegExp, source: string, message: string) {
  assert.match(source, pattern, message);
}

expect(/CREATE TABLE IF NOT EXISTS public\.profile_entitlements/i, foundation, "profile entitlement source of truth missing");
expect(/CREATE TABLE IF NOT EXISTS public\.capability_usage_events/i, foundation, "usage ledger missing");
expect(/CREATE TABLE IF NOT EXISTS public\.capability_usage_buckets/i, foundation, "usage bucket missing");
expect(/UNIQUE \(profile_id, capability_key, idempotency_key\)/i, foundation, "usage idempotency key must be profile/capability scoped");
expect(/pg_advisory_xact_lock/i, foundation, "atomic reservation must serialize profile/capability/period consumption");
expect(/FOR UPDATE/i, foundation, "usage bucket must be row locked before consume");
expect(/ENABLE ROW LEVEL SECURITY/i, foundation, "RLS must be enabled");
expect(/FORCE ROW LEVEL SECURITY/i, foundation, "RLS must be forced");
expect(/USING \(public\.owns_profile\(profile_id\)\)/i, foundation, "customer reads must remain tenant scoped");
expect(/REVOKE ALL ON FUNCTION public\.reserve_capability_usage[\s\S]+FROM PUBLIC, authenticated/i, foundation, "customers must not call reservation function directly");
expect(/REVOKE ALL ON FUNCTION public\.commit_capability_usage[\s\S]+FROM PUBLIC, authenticated/i, foundation, "customers must not commit usage directly");
expect(/REVOKE ALL ON FUNCTION public\.release_capability_usage[\s\S]+FROM PUBLIC, authenticated/i, foundation, "customers must not release usage directly");
expect(/INTERNAL_BASELINE/i, foundation, "legacy baseline bootstrap missing");
expect(/AFTER INSERT ON public\.profiles/i, foundation, "new personal profiles must receive deterministic baseline until plan packaging");
assert.doesNotMatch(foundation, /stripe/i, "FASE 4B must not depend on Stripe");
assert.doesNotMatch(foundation, /price_id|subscription_id|customer_id/i, "billing identifiers are out of scope");

const tenantReadableTables = [
  "profile_entitlements",
  "capability_usage_events",
  "capability_usage_buckets",
] as const;

for (const table of tenantReadableTables) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  expect(new RegExp(`GRANT\\s+SELECT\\s+ON\\s+TABLE\\s+public\\.${escaped}\\s+TO\\s+authenticated\\s*;`, "i"), grants, `${table} must grant authenticated SELECT so its RLS SELECT policy is reachable`);
  assert.doesNotMatch(grants, new RegExp(`GRANT\\s+(?:INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|ALL(?:\\s+PRIVILEGES)?)\\b[\\s\\S]*?public\\.${escaped}[\\s\\S]*?authenticated`, "i"), `${table} must not grant authenticated write/elevation privileges`);
  assert.doesNotMatch(grants, new RegExp(`GRANT\\s+SELECT\\s+ON\\s+TABLE\\s+public\\.${escaped}\\s+TO\\s+(?:PUBLIC|anonymous)\\b`, "i"), `${table} must not grant anonymous/PUBLIC SELECT`);
}

assert.doesNotMatch(grants, /GRANT\s+EXECUTE\b/i, "corrective migration must not grant function execution");
assert.doesNotMatch(grants, /CREATE\s+POLICY|ALTER\s+TABLE[\s\S]*ROW\s+LEVEL\s+SECURITY/i, "corrective migration must not alter already-correct RLS policies");
assert.doesNotMatch(grants, /INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER/i, "corrective migration scope must remain SELECT-only");

console.log("PASS entitlement migration foundation and authenticated read-grant safety");
