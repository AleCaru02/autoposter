import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const migrationName = "20260920_persistent_demo_tenant.sql";
const migration = await readFile(`db/migrations/${migrationName}`, "utf8");
const migrations = (await readdir("db/migrations")).filter((name) => name.endsWith(".sql")).sort();
const index = migrations.indexOf(migrationName);

assert.ok(index > 0, "release-candidate migration must have prior schema dependencies");
assert.equal(migrations[index - 1], "20260917_fase7i_learning_runtime.sql", "demo migration must follow the learning runtime migration");
assert.match(migration, /^--[\s\S]*\nBEGIN;/);
assert.match(migration, /COMMIT;\s*$/);
assert.doesNotMatch(migration, /\b(?:DROP TABLE|DROP COLUMN|TRUNCATE TABLE)\b/i, "migration apply must not remove schema or rows");
assert.doesNotMatch(migration, /DELETE FROM public\.profiles/i, "migration and demo reset must never delete profiles");

for (const [table, column, fallback] of [
  ["content_items", "data_origin", "CUSTOMER_REAL"],
  ["content_variants", "data_origin", "CUSTOMER_REAL"],
  ["schedules", "data_origin", "CUSTOMER_REAL"],
  ["website_scans", "data_origin", "CUSTOMER_REAL"],
  ["website_pages", "data_origin", "CUSTOMER_REAL"],
  ["publication_jobs", "execution_mode", "REAL_EXTERNAL"],
  ["metric_snapshots", "data_origin", "PROVIDER_REAL"],
  ["learning_insights", "source_type", "PROVIDER_API"],
]) {
  assert.match(migration, new RegExp(`ALTER TABLE public\\.${table}[\\s\\S]*?ADD COLUMN IF NOT EXISTS ${column} text NOT NULL DEFAULT '${fallback}'`), `${table}.${column} needs a backward-compatible real-data default`);
}

const beforeSeedDefinition = migration.slice(0, migration.indexOf("CREATE OR REPLACE FUNCTION public.seed_demo_tenant"));
assert.doesNotMatch(beforeSeedDefinition, /INSERT INTO public\.(?:profiles|brand_profiles|content_items|content_variants|website_scans|website_pages|publication_jobs|metric_snapshots|learning_insights)\b/i, "applying the migration must not auto-create a demo tenant or sample data");
assert.match(beforeSeedDefinition, /INSERT INTO public\.entitlement_packages/, "only demo package configuration may be installed at migration time");
assert.match(migration, /IF v_profile_id IS NULL THEN[\s\S]*INSERT INTO public\.profiles/, "demo profile creation must remain behind explicit provisioning");
assert.match(migration, /IF NOT EXISTS \([\s\S]*assignment\.package_key='demo_persistent'[\s\S]*assignment\.revoked_at IS NULL/, "package application must remain idempotent");
assert.match(migration, /DELETE FROM public\.profile_members membership[\s\S]*membership\.profile_id=v_profile_id[\s\S]*membership\.user_id<>v_owner_user_id/, "owner reconciliation must be limited to the demo profile");

console.log("PR #176 database migration safety: PASS — ordered, transactional, additive/compatible, explicit provisioning only and no apply-time customer data mutation.");
