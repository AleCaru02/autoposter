import { neon } from "@neondatabase/serverless";

const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";

export const TENANT_TABLES = [
  "profiles",
  "profile_members",
  "brand_profiles",
  "website_scans",
  "website_pages",
  "content_strategies",
  "assets",
  "content_items",
  "content_variants",
  "social_connections",
  "schedules",
  "publication_jobs",
  "publication_attempts",
  "metric_snapshots",
  "learning_insights",
  "ai_usage_events",
  "audit_log",
] as const;

type TenantTableSecurityRow = {
  table_name: string;
  table_exists: boolean;
  rls_enabled: boolean;
  force_rls: boolean;
  policy_count: number | string;
  open_policy_count: number | string;
  anonymous_can_select: boolean;
  anonymous_can_insert: boolean;
  anonymous_can_update: boolean;
  anonymous_can_delete: boolean;
};

export type TenantSecuritySummary = {
  ready: boolean;
  expectedTables: number;
  existingTables: number;
  rlsEnabledTables: number;
  tablesWithPolicies: number;
  openPolicies: number;
  anonymousPrivilegedTables: number;
  anonymousProfileReadBlocked: boolean;
};

export function evaluateTenantSecurity(rows: TenantTableSecurityRow[], anonymousProfileReadBlocked: boolean): TenantSecuritySummary {
  const normalized = rows.map((row) => ({
    ...row,
    policyCount: Number(row.policy_count) || 0,
    openPolicyCount: Number(row.open_policy_count) || 0,
    anonymousPrivileged: row.anonymous_can_select || row.anonymous_can_insert || row.anonymous_can_update || row.anonymous_can_delete,
  }));
  const existingTables = normalized.filter((row) => row.table_exists).length;
  const rlsEnabledTables = normalized.filter((row) => row.table_exists && row.rls_enabled).length;
  const tablesWithPolicies = normalized.filter((row) => row.table_exists && row.policyCount > 0).length;
  const openPolicies = normalized.reduce((total, row) => total + row.openPolicyCount, 0);
  const anonymousPrivilegedTables = normalized.filter((row) => row.table_exists && row.anonymousPrivileged).length;
  const ready = normalized.length === TENANT_TABLES.length
    && existingTables === TENANT_TABLES.length
    && rlsEnabledTables === TENANT_TABLES.length
    && tablesWithPolicies === TENANT_TABLES.length
    && openPolicies === 0
    && anonymousPrivilegedTables === 0
    && anonymousProfileReadBlocked;
  return { ready, expectedTables: TENANT_TABLES.length, existingTables, rlsEnabledTables, tablesWithPolicies, openPolicies, anonymousPrivilegedTables, anonymousProfileReadBlocked };
}

export async function handleTenantSecurityAudit(request: Request, env: { DATABASE_URL?: string }) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }
  if (!env.DATABASE_URL) {
    return new Response(JSON.stringify({ ready: false, database: "not_configured" }), { status: 503, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  }

  try {
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      with expected(table_name) as (
        values
          ('profiles'), ('profile_members'), ('brand_profiles'), ('website_scans'), ('website_pages'),
          ('content_strategies'), ('assets'), ('content_items'), ('content_variants'), ('social_connections'),
          ('schedules'), ('publication_jobs'), ('publication_attempts'), ('metric_snapshots'), ('learning_insights'),
          ('ai_usage_events'), ('audit_log')
      ), role_state as (
        select exists(select 1 from pg_roles where rolname = 'anonymous') as has_anonymous
      )
      select
        expected.table_name,
        (classes.oid is not null) as table_exists,
        coalesce(classes.relrowsecurity, false) as rls_enabled,
        coalesce(classes.relforcerowsecurity, false) as force_rls,
        count(policies.policyname)::int as policy_count,
        count(policies.policyname) filter (
          where lower(coalesce(policies.qual, '') || ' ' || coalesce(policies.with_check, '')) in ('true', '(true)', '((true))')
        )::int as open_policy_count,
        case when role_state.has_anonymous and classes.oid is not null then has_table_privilege('anonymous', classes.oid, 'SELECT') else false end as anonymous_can_select,
        case when role_state.has_anonymous and classes.oid is not null then has_table_privilege('anonymous', classes.oid, 'INSERT') else false end as anonymous_can_insert,
        case when role_state.has_anonymous and classes.oid is not null then has_table_privilege('anonymous', classes.oid, 'UPDATE') else false end as anonymous_can_update,
        case when role_state.has_anonymous and classes.oid is not null then has_table_privilege('anonymous', classes.oid, 'DELETE') else false end as anonymous_can_delete
      from expected
      cross join role_state
      left join pg_namespace namespaces on namespaces.nspname = 'public'
      left join pg_class classes on classes.relnamespace = namespaces.oid and classes.relname = expected.table_name and classes.relkind in ('r', 'p')
      left join pg_policies policies on policies.schemaname = 'public' and policies.tablename = expected.table_name
      group by expected.table_name, classes.oid, classes.relrowsecurity, classes.relforcerowsecurity, role_state.has_anonymous
      order by expected.table_name
    ` as TenantTableSecurityRow[];

    let anonymousProfileReadBlocked = false;
    try {
      const anonymous = await fetch(`${DATA_API}/profiles?select=id&limit=1`, { headers: { accept: "application/json" } });
      if (!anonymous.ok) anonymousProfileReadBlocked = anonymous.status === 401 || anonymous.status === 403;
      else {
        const payload = await anonymous.json() as unknown;
        anonymousProfileReadBlocked = Array.isArray(payload) && payload.length === 0;
      }
    } catch {
      anonymousProfileReadBlocked = false;
    }

    const summary = evaluateTenantSecurity(rows, anonymousProfileReadBlocked);
    return new Response(JSON.stringify({ service: "post-automatici", database: "reachable", tenantIsolation: summary }), {
      status: summary.ready ? 200 : 503,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (reason) {
    console.error("tenant-security-audit", reason instanceof Error ? reason.message : "unknown");
    return new Response(JSON.stringify({ service: "post-automatici", database: "unreachable", tenantIsolation: { ready: false } }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
