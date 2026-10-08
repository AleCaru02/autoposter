import { neon } from "@neondatabase/serverless";

const EMAIL_RE = /^authqa-([0-9]+)-email@example\.com$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function sameSecret(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function validMarker(value) {
  return typeof value === "string" && /^[0-9]{6,20}$/.test(value);
}

async function userRows(sql, marker) {
  const email = `authqa-${marker}-email@example.com`;
  return sql`
    select id::text,name,email
    from neon_auth.user
    where lower(email)=lower(${email})
      and lower(email) like 'authqa-%-email@example.com'
  `;
}

async function state(sql, marker) {
  const users = await userRows(sql, marker);
  const ids = users.map((row) => row.id);
  if (!ids.length) {
    return { qaUsers: 0, sessions: 0, accounts: 0, appUsers: 0, profiles: 0, memberships: 0 };
  }
  const userId = ids[0];
  const rows = await sql`
    select
      (select count(*)::int from neon_auth.session s where coalesce(to_jsonb(s)->>'userId',to_jsonb(s)->>'user_id','')=${userId}) sessions,
      (select count(*)::int from neon_auth.account a where coalesce(to_jsonb(a)->>'userId',to_jsonb(a)->>'user_id','')=${userId}) accounts,
      (select count(*)::int from public.app_users au where au.auth_user_id=${userId}) app_users,
      (select count(*)::int from public.profiles p where p.owner_auth_user_id=${userId}) profiles,
      (select count(*)::int from public.profile_members pm join public.app_users au on au.id=pm.user_id where au.auth_user_id=${userId}) memberships
  `;
  const row = rows[0] || {};
  return {
    qaUsers: users.length,
    sessions: Number(row.sessions || 0),
    accounts: Number(row.accounts || 0),
    appUsers: Number(row.app_users || 0),
    profiles: Number(row.profiles || 0),
    memberships: Number(row.memberships || 0),
  };
}

async function cleanup(sql, marker) {
  const users = await userRows(sql, marker);
  for (const user of users) {
    await sql`delete from public.profiles where owner_auth_user_id=${user.id}`;
    await sql`
      delete from public.profile_members pm
      using public.app_users au
      where pm.user_id=au.id and au.auth_user_id=${user.id}
    `;
    await sql`delete from neon_auth.session s where coalesce(to_jsonb(s)->>'userId',to_jsonb(s)->>'user_id','')=${user.id}`;
    await sql`delete from neon_auth.account a where coalesce(to_jsonb(a)->>'userId',to_jsonb(a)->>'user_id','')=${user.id}`;
    await sql`delete from public.app_users where auth_user_id=${user.id}`;
    await sql`delete from neon_auth.user where id::text=${user.id}`;
  }
  return state(sql, marker);
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    if (!sameSecret(request.headers.get("x-authqa-token") || "", env.AUTHQA_TOKEN || "")) return json({ error: "FORBIDDEN" }, 403);
    let body;
    try { body = await request.json(); } catch { return json({ error: "INVALID_JSON" }, 400); }
    if (!validMarker(body?.marker) || !env.DATABASE_URL) return json({ error: "INVALID_REQUEST" }, 400);
    const sql = neon(env.DATABASE_URL);
    try {
      if (body.action === "state" || body.action === "preflight") return json(await state(sql, body.marker));
      if (body.action === "cleanup") return json({ cleaned: true, ...(await cleanup(sql, body.marker)) });
      return json({ error: "INVALID_ACTION" }, 400);
    } catch (reason) {
      console.error("auth-e2e-controller", reason instanceof Error ? reason.message : "unknown");
      return json({ error: "CONTROLLER_FAILED" }, 500);
    }
  },
};
