import { neon } from "@neondatabase/serverless";

export type BootstrappedProfile = {
  id: string;
  name: string;
  slug: string;
  website_url: string | null;
  industry: string | null;
  timezone: string;
  locale: string;
  onboarding_completed: boolean;
  created_at: string;
  tenant_type: "CUSTOMER_REAL" | "QA_EPHEMERAL" | "DEMO_PERSISTENT";
  external_publishing_enabled: boolean;
};

export async function loadOwnedProfiles(databaseUrl: string, authUserId: string): Promise<BootstrappedProfile[]> {
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  if (!authUserId) throw new Error("AUTH_USER_REQUIRED");
  const sql = neon(databaseUrl);
  const rows = await sql`
    select
      p.id::text as id,
      p.name,
      p.slug,
      p.website_url,
      p.industry,
      p.timezone,
      p.locale,
      p.onboarding_completed,
      p.created_at::text as created_at,
      coalesce(mode.tenant_type, 'CUSTOMER_REAL') as tenant_type,
      coalesce(mode.external_publishing_enabled, true) as external_publishing_enabled
    from public.profiles p
    left join public.profile_tenant_modes mode on mode.profile_id = p.id
    where p.owner_auth_user_id = ${authUserId}
      and p.archived_at is null
    order by p.created_at asc
  ` as unknown as BootstrappedProfile[];
  return rows;
}
