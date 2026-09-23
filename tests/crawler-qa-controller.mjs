import { neon } from "@neondatabase/serverless";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function sameSecret(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

const recognizedEmail = /^crawler-smoke-([a-z0-9]{10,32})@example\.invalid$/;

function validMarker(value) {
  return typeof value === "string" && /^[a-z0-9]{10,32}$/.test(value);
}

async function userForMarker(sql, marker) {
  const email = `crawler-smoke-${marker}@example.invalid`;
  const rows = await sql`
    select u.id::text as id, lower(coalesce(to_jsonb(u)->>'email', '')) as email
    from neon_auth.user u
    where lower(coalesce(to_jsonb(u)->>'email', '')) = ${email}
    limit 2
  `;
  return rows.length === 1 ? rows[0] : null;
}

async function recognizedUsers(sql) {
  const rows = await sql`
    select u.id::text as id, lower(coalesce(to_jsonb(u)->>'email', '')) as email
    from neon_auth.user u
    where lower(coalesce(to_jsonb(u)->>'email', '')) like 'crawler-smoke-%@example.invalid'
    order by lower(coalesce(to_jsonb(u)->>'email', ''))
  `;
  return rows.filter((row) => recognizedEmail.test(row.email || ""));
}

async function state(sql, marker) {
  const current = await userForMarker(sql, marker);
  const all = await recognizedUsers(sql);
  const metrics = await sql`
    select
      (select count(*)::int from public.profiles) as profiles_total,
      (select count(*)::int from public.profiles p where p.owner_auth_user_id = ${current?.id ?? "__none__"}) as qa_profiles,
      (select count(*)::int
        from public.profiles p
        join public.profile_tenant_modes m on m.profile_id = p.id
        where p.owner_auth_user_id = ${current?.id ?? "__none__"}
          and m.tenant_type = 'QA_EPHEMERAL') as qa_ephemeral_profiles
  `;
  const row = metrics[0] || {};
  return {
    qaUser: current ? 1 : 0,
    qaProfiles: Number(row.qa_profiles || 0),
    qaEphemeralProfiles: Number(row.qa_ephemeral_profiles || 0),
    recognizedQaUsers: all.length,
    profilesTotal: Number(row.profiles_total || 0),
  };
}

async function markUserProfilesQa(sql, user, marker) {
  if (!user) return;
  await sql`
    update public.profile_tenant_modes m
    set tenant_type = 'QA_EPHEMERAL',
        external_publishing_enabled = false,
        metadata = coalesce(m.metadata, '{}'::jsonb)
          || jsonb_build_object('qaMarker', ${marker}, 'purpose', 'crawler-runtime')
    from public.profiles p
    where m.profile_id = p.id
      and p.owner_auth_user_id = ${user.id}
  `;
  await sql`
    insert into public.profile_tenant_modes(profile_id, tenant_type, external_publishing_enabled, metadata)
    select p.id, 'QA_EPHEMERAL', false, jsonb_build_object('qaMarker', ${marker}, 'purpose', 'crawler-runtime')
    from public.profiles p
    left join public.profile_tenant_modes m on m.profile_id = p.id
    where p.owner_auth_user_id = ${user.id}
      and m.profile_id is null
  `;
}

async function mark(sql, marker) {
  const user = await userForMarker(sql, marker);
  if (!user) return { ok: false, status: 409, body: { error: "QA_USER_NOT_FOUND" } };
  await markUserProfilesQa(sql, user, marker);
  const after = await state(sql, marker);
  if (after.qaProfiles < 1 || after.qaProfiles !== after.qaEphemeralProfiles) {
    return { ok: false, status: 409, body: { error: "QA_MARK_POSTCONDITION", ...after } };
  }
  return { ok: true, status: 200, body: { marked: true, ...after } };
}

async function cleanupUser(sql, user, marker) {
  if (!user) return;
  await markUserProfilesQa(sql, user, marker);
  const profiles = await sql`
    select p.id::text as id, m.tenant_type
    from public.profiles p
    left join public.profile_tenant_modes m on m.profile_id = p.id
    where p.owner_auth_user_id = ${user.id}
  `;
  if (profiles.some((profile) => profile.tenant_type !== "QA_EPHEMERAL")) throw new Error("QA_CLEANUP_NON_EPHEMERAL_PROFILE_DENIED");

  await sql`
    delete from public.profile_members pm
    using public.app_users au
    where pm.user_id = au.id and au.auth_user_id = ${user.id}
  `;
  await sql`
    delete from public.profile_tenant_modes m
    using public.profiles p
    where m.profile_id = p.id
      and p.owner_auth_user_id = ${user.id}
      and m.tenant_type = 'QA_EPHEMERAL'
  `;
  await sql`
    delete from public.profiles p
    where p.owner_auth_user_id = ${user.id}
  `;
  await sql`delete from neon_auth.session s where coalesce(to_jsonb(s)->>'userId', to_jsonb(s)->>'user_id', '') = ${user.id}`;
  await sql`delete from neon_auth.account a where coalesce(to_jsonb(a)->>'userId', to_jsonb(a)->>'user_id', '') = ${user.id}`;
  await sql`delete from public.app_users where auth_user_id = ${user.id}`;
  await sql`delete from neon_auth.user where id::text = ${user.id}`;
}

async function cleanup(sql, marker) {
  const user = await userForMarker(sql, marker);
  await cleanupUser(sql, user, marker);
  const after = await state(sql, marker);
  if (after.qaUser !== 0 || after.qaProfiles !== 0) {
    return { ok: false, status: 409, body: { error: "QA_CLEANUP_POSTCONDITION", ...after } };
  }
  return { ok: true, status: 200, body: { cleaned: true, ...after } };
}

async function cleanupResidue(sql, marker) {
  const users = await recognizedUsers(sql);
  for (const user of users) {
    const match = recognizedEmail.exec(user.email || "");
    if (!match) throw new Error("QA_RESIDUE_SCOPE_MISMATCH");
    await cleanupUser(sql, user, match[1]);
  }
  const after = await state(sql, marker);
  if (after.recognizedQaUsers !== 0) {
    return { ok: false, status: 409, body: { error: "QA_RESIDUE_CLEANUP_POSTCONDITION", ...after } };
  }
  return { ok: true, status: 200, body: { cleaned: true, cleanedUsers: users.length, ...after } };
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    const provided = request.headers.get("x-crawler-qa-token") || "";
    if (!sameSecret(provided, env.CRAWLER_QA_TOKEN || "")) return json({ error: "FORBIDDEN" }, 403);
    if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);

    let body;
    try { body = await request.json(); } catch { return json({ error: "INVALID_JSON" }, 400); }
    if (!validMarker(body?.marker)) return json({ error: "INVALID_MARKER" }, 400);
    if (!["state", "mark", "cleanup", "cleanup-residue"].includes(body?.action)) return json({ error: "INVALID_ACTION" }, 400);

    const sql = neon(env.DATABASE_URL);
    try {
      if (body.action === "state") return json(await state(sql, body.marker));
      if (body.action === "mark") {
        const result = await mark(sql, body.marker);
        return json(result.body, result.status);
      }
      if (body.action === "cleanup-residue") {
        const result = await cleanupResidue(sql, body.marker);
        return json(result.body, result.status);
      }
      const result = await cleanup(sql, body.marker);
      return json(result.body, result.status);
    } catch (reason) {
      console.error("crawler-qa-controller", reason instanceof Error ? reason.message : "unknown");
      return json({ error: "CONTROLLER_FAILED" }, 500);
    }
  },
};
