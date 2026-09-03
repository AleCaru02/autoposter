import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../db/migrations/20260903_fase4b_entitlement_usage_foundation.sql", import.meta.url), "utf8");

function expect(pattern: RegExp, message: string) {
  assert.match(sql, pattern, message);
}

expect(/CREATE TABLE IF NOT EXISTS public\.profile_entitlements/i, "profile entitlement source of truth missing");
expect(/CREATE TABLE IF NOT EXISTS public\.capability_usage_events/i, "usage ledger missing");
expect(/CREATE TABLE IF NOT EXISTS public\.capability_usage_buckets/i, "usage bucket missing");
expect(/UNIQUE \(profile_id, capability_key, idempotency_key\)/i, "usage idempotency key must be profile/capability scoped");
expect(/pg_advisory_xact_lock/i, "atomic reservation must serialize profile/capability/period consumption");
expect(/FOR UPDATE/i, "usage bucket must be row locked before consume");
expect(/ENABLE ROW LEVEL SECURITY/i, "RLS must be enabled");
expect(/FORCE ROW LEVEL SECURITY/i, "RLS must be forced");
expect(/USING \(public\.owns_profile\(profile_id\)\)/i, "customer reads must remain tenant scoped");
expect(/REVOKE ALL ON FUNCTION public\.reserve_capability_usage[\s\S]+FROM PUBLIC, authenticated/i, "customers must not call reservation function directly");
expect(/REVOKE ALL ON FUNCTION public\.commit_capability_usage[\s\S]+FROM PUBLIC, authenticated/i, "customers must not commit usage directly");
expect(/REVOKE ALL ON FUNCTION public\.release_capability_usage[\s\S]+FROM PUBLIC, authenticated/i, "customers must not release usage directly");
expect(/INTERNAL_BASELINE/i, "legacy baseline bootstrap missing");
expect(/AFTER INSERT ON public\.profiles/i, "new personal profiles must receive deterministic baseline until plan packaging");
assert.doesNotMatch(sql, /stripe/i, "FASE 4B must not depend on Stripe");
assert.doesNotMatch(sql, /price_id|subscription_id|customer_id/i, "billing identifiers are out of scope");

console.log("PASS entitlement migration foundation static safety");
