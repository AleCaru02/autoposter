import { neon } from "@neondatabase/serverless";
import { TextGenerationMetering } from "../api/_lib/text-generation-metering.js";
import { BrandAnalysisMetering } from "../api/_lib/brand-analysis-metering.js";
import { StrategyPlannerMetering } from "../api/_lib/strategy-planner-metering.js";
import { ImageGenerationMetering } from "../api/_lib/image-generation-metering.js";

type Env = { DATABASE_URL: string; PROVIDER_COST_QA_TOKEN: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function sameSecret(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function validMarker(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{10,32}$/.test(value);
}

const recognizedEmail = /^cost-smoke-([0-9]{10,32})-(primary|other)@example\.invalid$/;

async function recognizedUsers(sql: ReturnType<typeof neon>, marker?: string) {
  const rows = await sql`
    select id::text as id, lower(coalesce(to_jsonb(u)->>'email','')) as email
    from neon_auth.user u
    where lower(coalesce(to_jsonb(u)->>'email','')) like 'cost-smoke-%@example.invalid'
  ` as unknown as Array<{ id: string; email: string }>;
  return rows.map((row) => ({ ...row, match: recognizedEmail.exec(row.email) }))
    .filter((row) => row.match && (!marker || row.match[1] === marker));
}

async function state(sql: ReturnType<typeof neon>, marker: string) {
  const users = await recognizedUsers(sql, marker);
  const all = await recognizedUsers(sql);
  const ids = users.map((row) => row.id);
  const ownerPattern = `cost-smoke-${marker}-%@example.invalid`;
  const rows = await sql`
    select
      (select count(*)::int from public.profiles) as profiles_total,
      (select count(*)::int from public.profiles where owner_auth_user_id = any(${ids}::text[])) as qa_profiles,
      (select count(*)::int from public.profile_entitlement_package_assignments a join public.profiles p on p.id=a.profile_id where p.owner_auth_user_id = any(${ids}::text[])) as qa_assignments,
      (select count(*)::int from public.profile_entitlements e join public.profiles p on p.id=e.profile_id where p.owner_auth_user_id = any(${ids}::text[])) as qa_entitlements,
      (select count(*)::int from public.capability_usage_events e join public.profiles p on p.id=e.profile_id where p.owner_auth_user_id = any(${ids}::text[])) as qa_usage_events,
      (select count(*)::int from public.capability_usage_buckets b join public.profiles p on p.id=b.profile_id where p.owner_auth_user_id = any(${ids}::text[])) as qa_usage_buckets,
      (select count(*)::int from public.provider_cost_attempts a join public.profiles p on p.id=a.profile_id where p.owner_auth_user_id = any(${ids}::text[])) as qa_attempts,
      (select count(*)::int from public.ai_usage_events a join public.profiles p on p.id=a.profile_id where p.owner_auth_user_id = any(${ids}::text[])) as qa_ai_events,
      (select count(*)::int from public.platform_admin_audit where actor_auth_user_id=${`fase4f-verifier:${marker}`}) as qa_audit,
      (select count(*)::int from public.platform_admin_audit where actor_auth_user_id ~ '^fase4f-verifier:[0-9]{10,32}$') as recognized_qa_audit,
      (select count(*)::int from public.profiles p left join public.profile_members pm on pm.profile_id=p.id and upper(pm.role)='OWNER' group by p.id having count(pm.user_id) <> 1 limit 1) as broken_owner_probe,
      (select lifecycle from public.entitlement_packages where package_key='commercial_guarded' and version=1) as package_lifecycle,
      (select hard_monthly_provider_cost_cap_usd::float8 from public.entitlement_packages where package_key='commercial_guarded' and version=1) as package_cap,
      has_table_privilege('authenticated','public.provider_cost_attempts','select') as authenticated_attempt_select,
      has_function_privilege('authenticated','public.begin_provider_cost_attempt(uuid)','execute') as authenticated_budget_execute,
      (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.provider_cost_attempts'::regclass) as attempt_rls_forced,
      (select count(*)::int from neon_auth.user where lower(coalesce(to_jsonb(neon_auth.user)->>'email','')) like ${ownerPattern}) as marker_users
  `;
  const row = rows[0] as Record<string, unknown>;
  return {
    qaUsers: users.length,
    recognizedQaUsers: all.length,
    qaProfiles: Number(row.qa_profiles || 0),
    qaAssignments: Number(row.qa_assignments || 0),
    qaEntitlements: Number(row.qa_entitlements || 0),
    qaUsageEvents: Number(row.qa_usage_events || 0),
    qaUsageBuckets: Number(row.qa_usage_buckets || 0),
    qaAttempts: Number(row.qa_attempts || 0),
    qaAiEvents: Number(row.qa_ai_events || 0),
    qaAudit: Number(row.qa_audit || 0),
    recognizedQaAudit: Number(row.recognized_qa_audit || 0),
    profilesTotal: Number(row.profiles_total || 0),
    packageLifecycle: row.package_lifecycle,
    packageCap: Number(row.package_cap),
    authenticatedAttemptSelect: row.authenticated_attempt_select,
    authenticatedBudgetExecute: row.authenticated_budget_execute,
    attemptRlsForced: row.attempt_rls_forced,
    markerUsers: Number(row.marker_users || 0),
  };
}

async function profileFor(sql: ReturnType<typeof neon>, marker: string, kind: "primary" | "other") {
  const email = `cost-smoke-${marker}-${kind}@example.invalid`;
  const rows = await sql`
    select p.id::text as id
    from public.profiles p join neon_auth.user u on u.id::text=p.owner_auth_user_id
    where lower(coalesce(to_jsonb(u)->>'email',''))=${email}
  ` as unknown as Array<{ id: string }>;
  if (rows.length !== 1) throw new Error(`QA_${kind.toUpperCase()}_PROFILE_SCOPE`);
  return rows[0].id;
}

async function provision(sql: ReturnType<typeof neon>, marker: string) {
  const profileId = await profileFor(sql, marker, "primary");
  const actor = `fase4f-verifier:${marker}`;
  await sql`select public.apply_entitlement_package(${profileId}::uuid,'commercial_guarded',1,${actor},'RUNTIME_VERIFIER',${JSON.stringify({ marker })}::jsonb)`;
  const rows = await sql`
    select count(*)::int as mapped, count(*) filter(where enabled)::int as enabled
    from public.profile_entitlements where profile_id=${profileId}::uuid and source='PACKAGE:commercial_guarded:v1'
  `;
  return { profileId, mapped: Number(rows[0].mapped), enabled: Number(rows[0].enabled) };
}

async function exercise(sql: ReturnType<typeof neon>, databaseUrl: string, marker: string) {
  const profileId = await profileFor(sql, marker, "primary");
  const text = new TextGenerationMetering(databaseUrl);
  const brand = new BrandAnalysisMetering(databaseUrl);
  const strategy = new StrategyPlannerMetering(databaseUrl);
  const image = new ImageGenerationMetering(databaseUrl);
  let providerStarts = 0;

  const textOne = await text.reserve({ profileId, source: "MANUAL", operationIdentity: `${marker}-text-1`, requestFingerprint: { marker, n: 1 } });
  if (textOne.status !== "RESERVED") throw new Error("TEXT_ONE_NOT_RESERVED");
  const first = await text.markProviderStarted(textOne.eventId); providerStarts += 1;
  const duplicate = await text.markProviderStarted(textOne.eventId);
  if (!duplicate.duplicate || duplicate.attemptId !== first.attemptId) throw new Error("ATTEMPT_IDEMPOTENCY_FAILED");
  await text.persistTechnicalEvents(profileId, textOne.eventId, [{ operation: "GENERATE_SOCIAL_TEXT", model: "qa-no-provider", inputTokens: 1, outputTokens: 1, costUsd: 1.25, metadata: { qa_marker: marker } }]);
  await text.release(textOne.eventId, "QA_PROVIDER_FAILURE");

  async function allowed(meter: { markProviderStarted(id: string): Promise<unknown> }, reservation: { status: string; eventId?: string }) {
    if (reservation.status !== "RESERVED" || !reservation.eventId) throw new Error("ALLOWED_RESERVATION_FAILED");
    await meter.markProviderStarted(reservation.eventId); providerStarts += 1;
    return reservation.eventId;
  }
  await allowed(text, await text.reserve({ profileId, source: "MANUAL", operationIdentity: `${marker}-text-2`, requestFingerprint: { marker, n: 2 } }));
  await allowed(strategy, await strategy.reserve({ profileId, cycle: "STRATEGY_PLAN" }));
  await allowed(brand, await brand.reserve({ profileId, scanId: `${marker}-brand-1` }));
  await allowed(image, await image.reserve({ profileId, source: "MANUAL", operationIdentity: `${marker}-image-1`, requestFingerprint: { marker, n: 1 } }));
  await allowed(text, await text.reserve({ profileId, source: "MANUAL", operationIdentity: `${marker}-text-3`, requestFingerprint: { marker, n: 3 } }));

  async function denied(meter: { markProviderStarted(id: string): Promise<unknown>; release(id: string, reason: string): Promise<void> }, reservation: { status: string; eventId?: string }) {
    if (reservation.status !== "RESERVED" || !reservation.eventId) throw new Error("DENIAL_RESERVATION_FAILED");
    let code = "";
    try { await meter.markProviderStarted(reservation.eventId); providerStarts += 1; } catch (reason) { code = reason instanceof Error ? reason.message : "UNKNOWN"; }
    if (code !== "PROVIDER_COST_BUDGET_REACHED") throw new Error(`BUDGET_DENIAL_FAILED:${code}`);
    await meter.release(reservation.eventId, code);
    return code;
  }
  const denialCodes = [
    await denied(text, await text.reserve({ profileId, source: "MANUAL", operationIdentity: `${marker}-text-denied`, requestFingerprint: { marker, denied: "text" } })),
    await denied(brand, await brand.reserve({ profileId, scanId: `${marker}-brand-denied` })),
    await denied(strategy, await strategy.reserve({ profileId, cycle: "PLAN" })),
    await denied(image, await image.reserve({ profileId, source: "MANUAL", operationIdentity: `${marker}-image-denied`, requestFingerprint: { marker, denied: "image" } })),
  ];

  const rows = await sql`
    select count(*)::int as attempts,
      sum(greatest(reserved_usd,coalesce(actual_usd,0)))::float8 as accounted,
      count(*) filter(where actual_usd=1.25)::int as reconciled,
      count(*) filter(where actual_usd=1.25 and reserved_usd=1 and metadata->>'reserve_exceeded'='true')::int as reserve_exceeded,
      count(*) filter(where logical_usage_event_id=${textOne.eventId}::uuid)::int as released_attempt_retained
    from public.provider_cost_attempts where profile_id=${profileId}::uuid
  `;
  const logical = await sql`select state from public.capability_usage_events where id=${textOne.eventId}::uuid`;
  return {
    profileId,
    providerStarts,
    providerStartsAfterDenial: 0,
    denialCodes,
    attempts: Number(rows[0].attempts),
    accountedUsd: Number(rows[0].accounted),
    reconciled: Number(rows[0].reconciled),
    reserveExceeded: Number(rows[0].reserve_exceeded),
    releasedAttemptRetained: Number(rows[0].released_attempt_retained),
    releasedLogicalState: logical[0]?.state,
    duplicateAttempt: duplicate.duplicate,
  };
}

async function cleanup(sql: ReturnType<typeof neon>, marker: string) {
  const users = await recognizedUsers(sql, marker);
  if (users.length > 2) throw new Error("QA_CLEANUP_SCOPE");
  for (const user of users) {
    await sql`delete from public.profiles where owner_auth_user_id=${user.id}`;
    await sql`delete from public.profile_members pm using public.app_users au where pm.user_id=au.id and au.auth_user_id=${user.id}`;
    await sql`delete from neon_auth.session s where coalesce(to_jsonb(s)->>'userId',to_jsonb(s)->>'user_id','')=${user.id}`;
    await sql`delete from neon_auth.account a where coalesce(to_jsonb(a)->>'userId',to_jsonb(a)->>'user_id','')=${user.id}`;
    await sql`delete from public.app_users where auth_user_id=${user.id}`;
    await sql`delete from neon_auth.user where id::text=${user.id}`;
  }
  await sql`delete from public.platform_admin_audit where actor_auth_user_id=${`fase4f-verifier:${marker}`}`;
  return { cleaned: true, ...(await state(sql, marker)) };
}

async function cleanupResidue(sql: ReturnType<typeof neon>, marker: string) {
  const users = await recognizedUsers(sql);
  for (const user of users) {
    await sql`delete from public.profiles where owner_auth_user_id=${user.id}`;
    await sql`delete from public.profile_members pm using public.app_users au where pm.user_id=au.id and au.auth_user_id=${user.id}`;
    await sql`delete from neon_auth.session s where coalesce(to_jsonb(s)->>'userId',to_jsonb(s)->>'user_id','')=${user.id}`;
    await sql`delete from neon_auth.account a where coalesce(to_jsonb(a)->>'userId',to_jsonb(a)->>'user_id','')=${user.id}`;
    await sql`delete from public.app_users where auth_user_id=${user.id}`;
    await sql`delete from neon_auth.user where id::text=${user.id}`;
  }
  await sql`delete from public.platform_admin_audit where actor_auth_user_id ~ '^fase4f-verifier:[0-9]{10,32}$'`;
  return { cleaned: true, ...(await state(sql, marker)) };
}

export default {
  async fetch(request: Request, env: Env) {
    if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    if (!sameSecret(request.headers.get("x-provider-cost-qa-token") || "", env.PROVIDER_COST_QA_TOKEN || "")) return json({ error: "FORBIDDEN" }, 403);
    let body: { action?: string; marker?: string };
    try { body = await request.json(); } catch { return json({ error: "INVALID_JSON" }, 400); }
    if (!validMarker(body.marker)) return json({ error: "INVALID_MARKER" }, 400);
    const sql = neon(env.DATABASE_URL);
    try {
      if (body.action === "preflight" || body.action === "state") return json(await state(sql, body.marker));
      if (body.action === "provision") return json(await provision(sql, body.marker));
      if (body.action === "exercise") return json(await exercise(sql, env.DATABASE_URL, body.marker));
      if (body.action === "cleanup") return json(await cleanup(sql, body.marker));
      if (body.action === "cleanup-residue") return json(await cleanupResidue(sql, body.marker));
      return json({ error: "INVALID_ACTION" }, 400);
    } catch (reason) {
      console.error("provider-cost-budget-verifier", reason instanceof Error ? reason.message : "unknown");
      return json({ error: "VERIFIER_FAILED", detail: reason instanceof Error ? reason.message.slice(0, 160) : "unknown" }, 500);
    }
  },
};
