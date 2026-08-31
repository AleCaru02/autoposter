import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TENANT_TABLES } from "../cloudflare/tenant-security.js";

const barrier = readFileSync(new URL("../db/migrations/20260831_banned_user_rls_barrier.sql", import.meta.url), "utf8");
const expiry = readFileSync(new URL("../db/migrations/20260831_banned_user_expiry_semantics.sql", import.meta.url), "utf8");

assert.equal(TENANT_TABLES.length, 17, "tenant security contract must remain 17 tables");
assert.equal(barrier.includes("CREATE OR REPLACE FUNCTION public.current_auth_user_is_active()"), true, "active-user helper missing");
assert.equal(barrier.includes("STABLE"), true, "active-user helper must be stable within a statement");
assert.equal(barrier.includes("SECURITY DEFINER"), true, "active-user helper must read provider state server-side");
assert.equal(barrier.includes("FROM neon_auth.user nu"), true, "ban barrier must read Better Auth source of truth");
assert.equal(barrier.includes("nu.id::text = (SELECT auth.user_id())::text"), true, "ban barrier must resolve the current authenticated identity");
assert.equal(barrier.includes("nu.banned IS FALSE"), true, "base barrier must require explicitly non-banned state");
assert.equal(barrier.includes("REVOKE ALL ON FUNCTION public.current_auth_user_is_active() FROM PUBLIC"), true, "active helper must not be public-executable");
assert.equal(barrier.includes("GRANT EXECUTE ON FUNCTION public.current_auth_user_is_active() TO authenticated"), true, "authenticated Data API role must be able to evaluate the barrier");
assert.equal(barrier.includes("AS RESTRICTIVE FOR ALL TO PUBLIC"), true, "banned-user barrier must remain restrictive for every operation");
assert.equal(barrier.includes("USING (((select auth.user_id()) IS NOT NULL) AND public.current_auth_user_is_active())"), true, "read/update/delete barrier missing active-state check");
assert.equal(barrier.includes("WITH CHECK (((select auth.user_id()) IS NOT NULL) AND public.current_auth_user_is_active())"), true, "insert/update barrier missing active-state check");

for (const table of TENANT_TABLES) {
  assert.equal(barrier.includes(`'${table}'`), true, `banned-user barrier missing tenant table ${table}`);
}

for (const forbidden of ["is_banned", "account_status", "CREATE TABLE", "role = 'admin'", "role='admin'", "banned claim", "jwt.banned"]) {
  assert.equal((barrier + expiry).toLowerCase().includes(forbidden.toLowerCase()), false, `banned-user barrier must not introduce ${forbidden}`);
}

assert.equal(expiry.includes("LANGUAGE plpgsql"), true, "expiry-aware helper must fail closed on invalid provider expiry data");
assert.equal(expiry.includes("FROM neon_auth.user nu"), true, "expiry semantics must still read the Better Auth user row");
assert.equal(expiry.includes("nu.id::text = (SELECT auth.user_id())::text"), true, "expiry helper must resolve the current auth identity");
assert.equal(expiry.includes("IF NOT FOUND THEN"), true, "missing provider identity must fail closed");
assert.equal(expiry.includes("IF current_banned IS FALSE THEN"), true, "banned=false must remain active");
assert.equal(expiry.includes("IF current_banned IS DISTINCT FROM TRUE THEN"), true, "null/unknown banned state must fail closed");
assert.equal(expiry.includes("to_jsonb(nu)->>'banExpires'"), true, "temporary-ban expiry must use the native Better Auth field");
assert.equal(expiry.includes("IF current_ban_expires IS NULL THEN"), true, "permanent ban must remain denied");
assert.equal(expiry.includes("current_ban_expires::timestamptz <= now()"), true, "expired temporary ban must become active at the DB boundary");
assert.equal(expiry.includes("EXCEPTION WHEN OTHERS THEN"), true, "invalid expiry state must fail closed instead of allowing access");
assert.equal(expiry.includes("RETURN FALSE;"), true, "expiry helper must contain explicit deny paths");
assert.equal(expiry.includes("REVOKE ALL ON FUNCTION public.current_auth_user_is_active() FROM PUBLIC"), true, "expiry replacement must preserve helper privilege hardening");
assert.equal(expiry.includes("GRANT EXECUTE ON FUNCTION public.current_auth_user_is_active() TO authenticated"), true, "expiry replacement must preserve authenticated execution");

assert.equal((barrier + expiry).includes("DELETE FROM"), false, "security migrations must not delete product data");
assert.equal((barrier + expiry).includes("UPDATE neon_auth.user"), false, "security migrations must not mutate provider user state");

console.log("banned-user RLS regression: PASS");
