import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildCustomerPlan } from "../src/features/settings/customer-settings.js";

const [migration, social, learning, autopilot, planner, plannerRefresh, profiles, analyticsUi, learningUi, socialUi, calendar, websiteUi, qaCleanup, demoApi, entry] = await Promise.all([
  readFile("db/migrations/20260920_persistent_demo_tenant.sql", "utf8"),
  readFile("api/_lib/social.ts", "utf8"),
  readFile("api/_lib/learning-runtime.ts", "utf8"),
  readFile("api/_lib/autopilot.ts", "utf8"),
  readFile("api/_lib/openai-strategy-planner.ts", "utf8"),
  readFile("api/_lib/openai-strategy-planner-refresh.ts", "utf8"),
  readFile("src/features/profiles/profile-context.tsx", "utf8"),
  readFile("src/pages/analytics-page.tsx", "utf8"),
  readFile("src/pages/learning-page.tsx", "utf8"),
  readFile("src/pages/social-page.tsx", "utf8"),
  readFile("src/pages/calendar-page.tsx", "utf8"),
  readFile("src/pages/website-scan-page.tsx", "utf8"),
  readFile("tests/audit-viewer-qa-controller.mjs", "utf8"),
  readFile("cloudflare/admin-demo-api.ts", "utf8"),
  readFile("cloudflare/entry.ts", "utf8"),
]);

assert.match(migration, /tenant_type IN \('CUSTOMER_REAL','QA_EPHEMERAL','DEMO_PERSISTENT'\)/);
assert.match(migration, /one_persistent_demo_tenant/);
assert.match(migration, /tenant_type <> 'DEMO_PERSISTENT' OR external_publishing_enabled IS FALSE/);
assert.doesNotMatch(migration, /email\s*=/i, "demo identity must not be inferred from an email");
assert.match(migration, /'demo_persistent',1,'ACTIVE'/);
assert.match(migration, /'social\.publish\.scheduled',false/);
assert.match(migration, /'social\.facebook\.publish',false/);
assert.match(migration, /'social\.instagram\.publish',false/);

for (const status of ["DRAFT", "IN_REVIEW", "APPROVED"]) assert.match(migration, new RegExp(`'${status}'`));
assert.match(migration, /'DEMO_SAMPLE'/);
assert.match(migration, /'DEMO_SIMULATION'/);
assert.match(migration, /website_scans[\s\S]*data_origin/);
assert.match(migration, /website_pages[\s\S]*data_origin/);
assert.match(migration, /SAMPLE DATA — consulenza social/);
assert.match(migration, /source_type IN \('PROVIDER_API','DEMO_SAMPLE'\)/);
assert.match(migration, /source='DEMO_SAMPLE'/);
assert.match(migration, /remote_post_id=NULL/);
assert.match(migration, /demo_social_connection_guard/);
assert.match(migration, /DEMO_EXTERNAL_CONNECTION_DISABLED/);
assert.match(migration, /demo_publication_mode_guard/);
assert.match(migration, /NEW\.execution_mode:='DEMO_SIMULATION'/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.seed_demo_tenant/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.reset_demo_tenant/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.provision_demo_tenant/);
assert.match(migration, /INSERT INTO public\.app_users\(auth_user_id\)/, "demo provisioning must resolve an internal user");
assert.match(migration, /owner_user_id=v_owner_user_id/, "repeat provisioning must keep profile ownership coherent");
assert.match(migration, /DELETE FROM public\.profile_members membership[\s\S]*upper\(membership\.role\)='OWNER'/, "stale demo OWNER memberships must be removed");
assert.match(migration, /INSERT INTO public\.profile_members\(profile_id,user_id,role\)[\s\S]*ON CONFLICT \(profile_id,user_id\) DO UPDATE SET role='OWNER'/, "demo OWNER membership must be idempotent");
assert.match(migration, /IF NOT EXISTS \([\s\S]*profile_entitlement_package_assignments assignment[\s\S]*assignment\.revoked_at IS NULL[\s\S]*PERFORM public\.apply_entitlement_package/, "repeat provisioning must not create duplicate active package assignments");
assert.match(migration, /DEMO_ADMIN_REQUIRED/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /WHERE profile_id=p_profile_id AND data_origin='DEMO_SAMPLE'/);
assert.match(migration, /WHERE profile_id=p_profile_id AND source_type='DEMO_SAMPLE'/);
assert.match(migration, /persistent_demo_profile_delete_guard/);
assert.match(migration, /DEMO_PERSISTENT_DELETE_DENIED/);
for (const signature of ["seed_demo_tenant(uuid)", "reset_demo_tenant(uuid,text)", "provision_demo_tenant(text,text)", "complete_demo_publication_job(uuid,uuid)"]) {
  assert.ok(migration.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, authenticated`));
}

const providerCall = social.indexOf("const result = await publishVariant");
const demoGuard = social.indexOf("const demoResult = await completeDemoPublication");
assert.ok(demoGuard >= 0 && demoGuard < providerCall, "demo guard must run before every provider adapter");
assert.match(social, /externalRequest: false/);
assert.match(social, /DEMO_EXTERNAL_CONNECTION_DISABLED/);
assert.match(learning, /snapshot\.source='PROVIDER_API'/);
assert.match(learning, /not public\.is_demo_persistent_profile/);
for (const source of [autopilot, planner, plannerRefresh]) assert.match(source, /source_type='PROVIDER_API'/);

assert.match(profiles, /profile_tenant_modes/);
assert.match(analyticsUi, /Dati dimostrativi/);
assert.match(learningUi, /Dati dimostrativi/);
assert.match(socialUi, /pubblicazione esterna è disabilitata lato server/);
assert.match(calendar, /Pubblicato in demo · nessun invio reale/);
assert.match(websiteUi, /Nessuna scansione esterna reale/);
assert.match(qaCleanup, /tenant_type='QA_EPHEMERAL'/);
assert.match(qaCleanup, /QA_CLEANUP_NON_EPHEMERAL_PROFILE_DENIED/);
assert.doesNotMatch(qaCleanup, /tenant_type='DEMO_PERSISTENT'[\s\S]*delete from public\.profiles/i);
assert.match(demoApi, /requireSuperAdmin/);
assert.match(demoApi, /reset_demo_tenant/);
assert.match(entry, /handleAdminDemoApi/);

const demoPlan = buildCustomerPlan([
  { capability_key: "ai.content.generate_text", enabled: true, limit_value: 50, period_type: "MONTH", source: "PACKAGE:demo_persistent:v1" },
], []);
assert.equal(demoPlan.name, "Piano demo");

console.log("Persistent demo infrastructure: PASS — isolated tenant type, normal entitlements, idempotent seed/reset, provider fail-closed, demo/real analytics and learning separation, cleanup guard and explicit UI labels.");
