import type { BrandContext } from "./openai-text.js";

export type EditorialProfileRow = {
  id: string;
  name: string;
  website_url: string | null;
  industry: string | null;
  profile_type: "BUSINESS" | "PERSONAL_BRAND";
  owner_auth_user_id: string;
};

export type PersonalBrandSourceRelation = {
  source_profile_id: string;
  source_name: string;
  source_website_url: string | null;
  source_industry: string | null;
  pillar: string;
  allowed_topics: unknown;
  allowed_claims: unknown;
  allowed_ctas: unknown;
  asset_policy: "NO_ASSETS" | "REFERENCE_ONLY" | "REUSE_APPROVED";
  weight: number | string;
  priority: number | string;
};

type BrandRow = {
  description: string | null;
  business_model: string | null;
  location: string | null;
  service_area: string | null;
  target_audience: unknown;
  tone_of_voice: unknown;
  goals: unknown;
  user_context: string | null;
  visual_identity: unknown;
};
type PageRow = { url: string; title: string | null; content_text: string | null };

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function summary(value: unknown) {
  const v = asObject(value).summary;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
}

export function policyList(value: unknown) {
  return strings(value);
}

export async function loadEditorialProfile(sql: any, profileId: string, ownerAuthUserId?: string | null): Promise<EditorialProfileRow> {
  const rows = await sql`
    select id::text as id, name, website_url, industry, profile_type, owner_auth_user_id
    from public.profiles
    where id=${profileId}::uuid
      and archived_at is null
      and (${ownerAuthUserId ?? null}::text is null or owner_auth_user_id=${ownerAuthUserId ?? null})
    limit 1
  ` as unknown as EditorialProfileRow[];
  if (!rows[0]) throw new Error("PROFILE_NOT_FOUND");
  return rows[0];
}

export async function resolvePersonalBrandSource(
  sql: any,
  personalBrandProfileId: string,
  requestedSourceProfileId?: string | null,
  requestedPillar?: string | null,
): Promise<PersonalBrandSourceRelation> {
  const sourceId = requestedSourceProfileId?.trim() || null;
  const pillar = requestedPillar?.trim() || null;
  const rows = await sql`
    select
      s.source_profile_id::text as source_profile_id,
      source.name as source_name,
      source.website_url as source_website_url,
      source.industry as source_industry,
      s.pillar,
      s.allowed_topics,
      s.allowed_claims,
      s.allowed_ctas,
      s.asset_policy,
      s.weight,
      s.priority
    from public.personal_brand_sources s
    join public.profiles pb on pb.id=s.personal_brand_profile_id
    join public.profiles source on source.id=s.source_profile_id
    where s.personal_brand_profile_id=${personalBrandProfileId}::uuid
      and s.enabled=true
      and pb.profile_type='PERSONAL_BRAND'
      and source.profile_type='BUSINESS'
      and source.archived_at is null
      and source.owner_auth_user_id=pb.owner_auth_user_id
      and (${sourceId}::text is null or s.source_profile_id=${sourceId}::uuid)
      and (${pillar}::text is null or s.pillar=${pillar})
    order by s.priority asc, s.weight desc, s.created_at asc
    limit 1
  ` as unknown as PersonalBrandSourceRelation[];
  if (!rows[0]) throw new Error("PERSONAL_BRAND_SOURCE_NOT_AUTHORIZED");
  return rows[0];
}

export async function loadProfileBrandContext(sql: any, profile: EditorialProfileRow): Promise<{ brand: BrandContext; audience: Record<string, unknown>; visualIdentity: unknown }> {
  const brands = await sql`
    select description,business_model,location,service_area,target_audience,tone_of_voice,goals,user_context,visual_identity
    from public.brand_profiles
    where profile_id=${profile.id}::uuid
    limit 1
  ` as unknown as BrandRow[];
  const row = brands[0];
  const scans = await sql`
    select id::text as id
    from public.website_scans
    where profile_id=${profile.id}::uuid
      and state in ('COMPLETE','COMPLETE_WITH_WARNINGS','PARTIAL')
    order by created_at desc
    limit 1
  ` as unknown as Array<{id:string}>;
  const pages = scans[0] ? await sql`
    select url,title,content_text
    from public.website_pages
    where profile_id=${profile.id}::uuid
      and scan_id=${scans[0].id}::uuid
      and status='ANALYZED'
    order by depth asc,url asc
    limit 160
  ` as unknown as PageRow[] : [];
  const audience = asObject(row?.target_audience);
  return {
    audience,
    visualIdentity: row?.visual_identity ?? null,
    brand: {
      profileName: profile.name,
      industry: profile.industry,
      websiteUrl: profile.website_url,
      description: row?.description ?? null,
      businessModel: row?.business_model ?? null,
      location: row?.location ?? null,
      serviceArea: row?.service_area ?? null,
      target: summary(row?.target_audience),
      tone: summary(row?.tone_of_voice),
      goals: strings(row?.goals),
      userContext: row?.user_context ?? null,
      confirmedWebsiteContent: pages.filter((page) => Boolean(page.content_text)).map((page) => ({url:page.url,title:page.title,text:page.content_text ?? ""})),
    },
  };
}

export async function buildPersonalBrandEditorialContext(
  sql: any,
  personalBrand: EditorialProfileRow,
  relation: PersonalBrandSourceRelation,
) {
  const [identity, sourceProfile] = await Promise.all([
    loadProfileBrandContext(sql, personalBrand),
    loadEditorialProfile(sql, relation.source_profile_id, personalBrand.owner_auth_user_id),
  ]);
  const source = await loadProfileBrandContext(sql, sourceProfile);
  const sourceRefs = [
    { type: "SOURCE_PROFILE", source_profile_id: relation.source_profile_id, name: relation.source_name, pillar: relation.pillar },
    ...source.brand.confirmedWebsiteContent.map((page) => ({ type: "WEBSITE_PAGE", source_profile_id: relation.source_profile_id, url: page.url, title: page.title })),
  ];
  const factProvenance = [{
    source_profile_id: relation.source_profile_id,
    pillar: relation.pillar,
    source_type: "AUTHORIZED_ACTIVITY",
    allowed_topics: policyList(relation.allowed_topics),
    allowed_claims: policyList(relation.allowed_claims),
    allowed_ctas: policyList(relation.allowed_ctas),
    verified_at: new Date().toISOString(),
  }];
  return {
    visualIdentity: identity.visualIdentity,
    brand: {
      ...identity.brand,
      confirmedWebsiteContent: source.brand.confirmedWebsiteContent,
      authorizedSource: {
        profileId: relation.source_profile_id,
        profileName: relation.source_name,
        industry: relation.source_industry,
        websiteUrl: relation.source_website_url,
        description: source.brand.description,
        businessModel: source.brand.businessModel,
        location: source.brand.location,
        serviceArea: source.brand.serviceArea,
        userContext: source.brand.userContext ?? null,
        pillar: relation.pillar,
        allowedTopics: policyList(relation.allowed_topics),
        allowedClaims: policyList(relation.allowed_claims),
        allowedCtas: policyList(relation.allowed_ctas),
      },
    } satisfies BrandContext,
    audience: identity.audience,
    sourceRefs,
    factProvenance,
  };
}
