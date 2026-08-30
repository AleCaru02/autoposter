import { neon } from "@neondatabase/serverless";

type Env = { DATABASE_URL?: string; TENANT_CROSS_TEST_TOKEN?: string };

type ColumnRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
};

type TriggerRow = { table_name: string; trigger_name: string; definition: string };
type PolicyRow = { table_name: string; policy_name: string; command: string; permissive: string; using_expression: string | null; check_expression: string | null };
type ConstraintRow = { constraint_name: string; constraint_type: string; definition: string };

function secureEquals(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

function authorized(request: Request, secret?: string) {
  if (!secret) return false;
  return secureEquals(request.headers.get("authorization") ?? "", `Bearer ${secret}`);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function handleTenantMembershipDiagnostic(request: Request, env: Env) {
  if (request.method !== "POST") return json({ error: "API_NOT_FOUND" }, 404);
  if (!authorized(request, env.TENANT_CROSS_TEST_TOKEN)) return json({ error: "API_NOT_FOUND" }, 404);
  if (!env.DATABASE_URL) return json({ ready: false, error: "DATABASE_NOT_CONFIGURED" }, 503);

  try {
    const sql = neon(env.DATABASE_URL);
    const columns = await sql`
      select table_name, column_name, data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name in ('profiles', 'profile_members')
      order by table_name, ordinal_position
    ` as ColumnRow[];

    const triggers = await sql`
      select c.relname as table_name,
             t.tgname as trigger_name,
             pg_get_triggerdef(t.oid, true) as definition
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('profiles', 'profile_members')
        and not t.tgisinternal
      order by c.relname, t.tgname
    ` as TriggerRow[];

    const policies = await sql`
      select tablename as table_name,
             policyname as policy_name,
             cmd as command,
             permissive,
             qual as using_expression,
             with_check as check_expression
      from pg_policies
      where schemaname = 'public' and tablename in ('profiles', 'profile_members')
      order by tablename, policyname
    ` as PolicyRow[];

    const constraints = await sql`
      select con.conname as constraint_name,
             con.contype::text as constraint_type,
             pg_get_constraintdef(con.oid, true) as definition
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'profile_members'
      order by con.conname
    ` as ConstraintRow[];

    return json({
      service: "post-automatici",
      ready: true,
      membershipContract: { columns, triggers, policies, constraints },
    });
  } catch (reason) {
    return json({ ready: false, error: reason instanceof Error ? reason.message : "MEMBERSHIP_DIAGNOSTIC_FAILED" }, 503);
  }
}
