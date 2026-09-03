import { neon } from "@neondatabase/serverless";
import baseController from "./fase4b-entitlement-qa-controller.mjs";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function sameSecret(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

async function privileges(sql) {
  const tables = ["profile_entitlements", "capability_usage_events", "capability_usage_buckets"];
  const rows = [];
  for (const table of tables) {
    const result = await sql`
      select
        ${table}::text as table_name,
        has_table_privilege('authenticated', ${`public.${table}`}, 'SELECT') as authenticated_select,
        has_table_privilege('authenticated', ${`public.${table}`}, 'INSERT') as authenticated_insert,
        has_table_privilege('authenticated', ${`public.${table}`}, 'UPDATE') as authenticated_update,
        has_table_privilege('authenticated', ${`public.${table}`}, 'DELETE') as authenticated_delete,
        has_table_privilege('anonymous', ${`public.${table}`}, 'SELECT') as anonymous_select
    `;
    rows.push(result[0]);
  }

  const fn = await sql`
    select
      has_function_privilege('authenticated','public.reserve_capability_usage(uuid,text,numeric,numeric,timestamptz,timestamptz,text,text,text,jsonb)','EXECUTE') as reserve_auth,
      has_function_privilege('authenticated','public.commit_capability_usage(uuid)','EXECUTE') as commit_auth,
      has_function_privilege('authenticated','public.release_capability_usage(uuid)','EXECUTE') as release_auth,
      has_function_privilege('authenticated','public.bootstrap_profile_entitlements(uuid)','EXECUTE') as bootstrap_auth,
      exists (
        select 1 from information_schema.routine_privileges
        where routine_schema='public' and routine_name='reserve_capability_usage'
          and grantee='PUBLIC' and privilege_type='EXECUTE'
      ) as reserve_public
  `;
  return { tables: rows, functions: fn[0] };
}

export default {
  async fetch(request, env) {
    const probe = request.clone();
    let body = null;
    try { body = await probe.json(); } catch { /* delegate malformed requests */ }
    if (body?.action !== "privileges") return baseController.fetch(request, env);

    if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    const provided = request.headers.get("x-fase4b-qa-token") || "";
    if (!sameSecret(provided, env.FASE4B_QA_TOKEN || "")) return json({ error: "FORBIDDEN" }, 403);
    if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);

    try {
      return json(await privileges(neon(env.DATABASE_URL)));
    } catch (reason) {
      console.error("fase4b-entitlement-runtime-privileges-v2", reason instanceof Error ? reason.message : "unknown");
      return json({ error: "CONTROLLER_FAILED" }, 500);
    }
  },
};
