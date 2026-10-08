import { neon } from "@neondatabase/serverless";

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

async function diagnose(sql) {
  const rows = await sql`
    with target_profile as (
      select owner_auth_user_id::text as auth_user_id
      from public.profiles
      where lower(name)=lower('Bianca Lopes')
        and archived_at is null
      order by created_at asc
      limit 1
    ),
    target_user as (
      select u.id::text as id, u.email, u."emailVerified" as email_verified
      from neon_auth."user" u
      join target_profile p on p.auth_user_id=u.id::text
      limit 1
    )
    select
      exists(select 1 from target_profile) as profile_found,
      exists(select 1 from target_user) as auth_user_found,
      coalesce((select email_verified from target_user), false) as email_verified,
      exists(
        select 1 from neon_auth.account a
        join target_user u on a."userId"::text=u.id
        where a."providerId"='credential'
      ) as has_credential,
      exists(
        select 1 from neon_auth.account a
        join target_user u on a."userId"::text=u.id
        where a."providerId"='google'
      ) as has_google,
      exists(
        select 1
        from neon_auth.account a
        join neon_auth."user" gu on gu.id=a."userId"
        join target_user tu on lower(gu.email)=lower(tu.email)
        where a."providerId"='google'
          and gu.id::text<>tu.id
      ) as same_email_google_other_user,
      coalesce((
        select count(*)::int
        from neon_auth.account a
        join target_user u on a."userId"::text=u.id
      ),0) as account_count,
      coalesce((
        select count(*)::int
        from jsonb_array_elements(coalesce(pc.social_providers,'[]'::jsonb)) sp
        where lower(coalesce(sp->>'id',sp->>'provider',sp->>'providerId',sp->>'name',''))='google'
      ),0) as google_provider_entries
    from neon_auth.project_config pc
    limit 1
  `;
  const row = rows[0] || {};
  return {
    profileFound: Boolean(row.profile_found),
    authUserFound: Boolean(row.auth_user_found),
    emailVerified: Boolean(row.email_verified),
    hasCredential: Boolean(row.has_credential),
    hasGoogle: Boolean(row.has_google),
    sameEmailGoogleOtherUser: Boolean(row.same_email_google_other_user),
    accountCount: Number(row.account_count || 0),
    googleProviderEntries: Number(row.google_provider_entries || 0),
    secretExposure: 0
  };
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
    if (!sameSecret(request.headers.get("x-authdiag-token") || "", env.AUTHDIAG_TOKEN || "")) return json({ error: "FORBIDDEN" }, 403);
    if (!env.DATABASE_URL) return json({ error: "NOT_CONFIGURED" }, 503);
    try {
      const sql = neon(env.DATABASE_URL);
      return json(await diagnose(sql));
    } catch (reason) {
      console.error("auth-linking-diagnostic", reason instanceof Error ? reason.message : "unknown");
      return json({ error: "DIAGNOSTIC_FAILED" }, 500);
    }
  },
};
