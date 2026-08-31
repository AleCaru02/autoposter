import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TENANT_TABLES } from "../cloudflare/tenant-security.js";

const migration = readFileSync(new URL("../db/migrations/20260831_banned_user_rls_barrier.sql", import.meta.url), "utf8");

assert.equal(TENANT_TABLES.length, 17, "tenant security contract must remain 17 tables");
assert.equal(migration.includes("CREATE OR REPLACE FUNCTION public.current_auth_user_is_active()"), true, "active-user helper missing");
assert.equal(migration.includes("STABLE"), true, "active-user helper must be stable within a statement");
assert.equal(migration.includes("SECURITY DEFINER"), true, "active-user helper must read provider state server-side");
assert.equal(migration.includes("FROM neon_auth.user nu"), true, "ban barrier must read Better Auth source of truth");
assert.equal(migration.includes("nu.id::text = (SELECT auth.user_id())::text"), true, "ban barrier must resolve the current authenticated identity");
assert.equal(migration.includes("nu.banned IS FALSE"), true, "only an explicitly non-banned identity may pass");
assert.equal(migration.includes("REVOKE ALL ON FUNCTION public.current_auth_user_is_active() FROM PUBLIC"), true, "active helper must not be public-executable");
assert.equal(migration.includes("GRANT EXECUTE ON FUNCTION public.current_auth_user_is_active() TO authenticated"), true, "authenticated Data API role must be able to evaluate the barrier");
assert.equal(migration.includes("AS RESTRICTIVE FOR ALL TO PUBLIC"), true, "banned-user barrier must remain restrictive for every operation");
assert.equal(migration.includes("USING (((select auth.user_id()) IS NOT NULL) AND public.current_auth_user_is_active())"), true, "read/update/delete barrier missing active-state check");
assert.equal(migration.includes("WITH CHECK (((select auth.user_id()) IS NOT NULL) AND public.current_auth_user_is_active())"), true, "insert/update barrier missing active-state check");

for (const table of TENANT_TABLES) {
  assert.equal(migration.includes(`'${table}'`), true, `banned-user barrier missing tenant table ${table}`);
}

for (const forbidden of ["is_banned", "account_status", "CREATE TABLE", "role = 'admin'", "role='admin'", "banned claim", "jwt.banned"]) {
  assert.equal(migration.toLowerCase().includes(forbidden.toLowerCase()), false, `banned-user barrier must not introduce ${forbidden}`);
}

assert.equal(migration.includes("banExpires"), false, "RLS must follow current provider banned state rather than duplicate expiry semantics");
assert.equal(migration.includes("DELETE FROM"), false, "security migration must not delete product data");
assert.equal(migration.includes("UPDATE neon_auth.user"), false, "security migration must not mutate provider user state");

console.log("banned-user RLS regression: PASS");
