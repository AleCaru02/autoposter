import { neon } from "@neondatabase/serverless";
import { bearerValue, verifiedCustomerAuthUserId } from "../api/_lib/verified-customer-auth.js";

type Env = { DATABASE_URL?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function uuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function auth(request: Request, env: Env) {
  if (!env.DATABASE_URL) return { error: json({ error: "DATABASE_NOT_CONFIGURED" }, 503) } as const;
  const token = bearerValue(request.headers.get("authorization"));
  if (!token) return { error: json({ error: "UNAUTHENTICATED" }, 401) } as const;
  const authUserId = await verifiedCustomerAuthUserId(token, env.DATABASE_URL);
  if (!authUserId) return { error: json({ error: "UNAUTHENTICATED" }, 401) } as const;
  return { sql: neon(env.DATABASE_URL), authUserId } as const;
}

async function personalBrandOwned(sql: ReturnType<typeof neon>, profileId: string, authUserId: string) {
  const rows = await sql`
    select id::text
    from public.profiles
    where id=${profileId}::uuid
      and owner_auth_user_id=${authUserId}
      and archived_at is null
      and profile_type='PERSONAL_BRAND'
    limit 1
  ` as unknown as Array<{ id: string }>;
  return Boolean(rows[0]);
}

async function sourceOwned(sql: ReturnType<typeof neon>, sourceProfileId: string, authUserId: string) {
  const rows = await sql`
    select id::text,name,industry
    from public.profiles
    where id=${sourceProfileId}::uuid
      and owner_auth_user_id=${authUserId}
      and archived_at is null
      and profile_type='BUSINESS'
    limit 1
  ` as unknown as Array<{ id: string; name: string; industry: string | null }>;
  return rows[0] ?? null;
}

export async function handlePersonalBrandSources(request: Request, env: Env): Promise<Response> {
  const ctx = await auth(request, env);
  if ("error" in ctx) return ctx.error;
  const { sql, authUserId } = ctx;

  if (request.method === "GET") {
    const profileId = new URL(request.url).searchParams.get("profileId") || "";
    if (!uuid(profileId)) return json({ error: "PROFILE_REQUIRED" }, 400);
    if (!await personalBrandOwned(sql, profileId, authUserId)) return json({ error: "PROFILE_NOT_FOUND" }, 404);

    const rows = await sql`
      select
        s.id::text,
        s.personal_brand_profile_id::text,
        s.source_profile_id::text,
        source.name as source_name,
        source.industry as source_industry,
        s.enabled,
        s.pillar,
        s.allowed_topics,
        s.allowed_claims,
        s.allowed_ctas,
        s.asset_policy,
        s.weight::float8 as weight,
        s.priority,
        s.created_at::text,
        s.updated_at::text
      from public.personal_brand_sources s
      join public.profiles source on source.id=s.source_profile_id
      where s.personal_brand_profile_id=${profileId}::uuid
        and source.owner_auth_user_id=${authUserId}
        and source.archived_at is null
      order by s.priority asc,s.created_at asc
    `;
    return json({ sources: rows });
  }

  if (request.method === "POST") {
    const body = await request.json().catch(() => ({})) as {
      personalBrandProfileId?: unknown;
      sourceProfileId?: unknown;
    };
    const personalBrandProfileId = typeof body.personalBrandProfileId === "string" ? body.personalBrandProfileId : "";
    const sourceProfileId = typeof body.sourceProfileId === "string" ? body.sourceProfileId : "";
    if (!uuid(personalBrandProfileId) || !uuid(sourceProfileId)) return json({ error: "SOURCE_REQUIRED" }, 400);
    if (!await personalBrandOwned(sql, personalBrandProfileId, authUserId)) return json({ error: "PROFILE_NOT_FOUND" }, 404);
    const source = await sourceOwned(sql, sourceProfileId, authUserId);
    if (!source) return json({ error: "SOURCE_PROFILE_NOT_FOUND" }, 404);

    const pillar = (source.industry?.trim() || source.name.trim()).slice(0, 160);
    const rows = await sql`
      insert into public.personal_brand_sources(
        personal_brand_profile_id,source_profile_id,enabled,pillar,
        allowed_topics,allowed_claims,allowed_ctas,asset_policy,weight,priority
      )
      values (
        ${personalBrandProfileId}::uuid,${sourceProfileId}::uuid,true,${pillar},
        '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'REFERENCE_ONLY',1,100
      )
      on conflict(personal_brand_profile_id,source_profile_id,pillar)
      do update set enabled=true,updated_at=now()
      returning id::text
    `;
    return json({ saved: true, id: rows[0]?.id ?? null, pillar }, 201);
  }

  if (request.method === "DELETE") {
    const body = await request.json().catch(() => ({})) as {
      personalBrandProfileId?: unknown;
      id?: unknown;
    };
    const personalBrandProfileId = typeof body.personalBrandProfileId === "string" ? body.personalBrandProfileId : "";
    const id = typeof body.id === "string" ? body.id : "";
    if (!uuid(personalBrandProfileId) || !uuid(id)) return json({ error: "SOURCE_REQUIRED" }, 400);
    if (!await personalBrandOwned(sql, personalBrandProfileId, authUserId)) return json({ error: "PROFILE_NOT_FOUND" }, 404);

    await sql`
      delete from public.personal_brand_sources
      where id=${id}::uuid
        and personal_brand_profile_id=${personalBrandProfileId}::uuid
    `;
    return json({ deleted: true });
  }

  return json({ error: "METHOD_NOT_ALLOWED" }, 405);
}
