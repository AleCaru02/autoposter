import { neon } from "@neondatabase/serverless";

export async function archiveOwnedProfile(databaseUrl: string, authUserId: string, profileId: string) {
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  if (!authUserId) throw new Error("AUTH_USER_REQUIRED");
  if (!/^[0-9a-f-]{36}$/i.test(profileId)) throw new Error("PROFILE_ID_INVALID");

  const sql = neon(databaseUrl);
  const rows = await sql`
    update public.profiles
    set archived_at = now(), updated_at = now()
    where id::text = ${profileId}
      and owner_auth_user_id = ${authUserId}
      and archived_at is null
    returning id::text as id, name
  ` as unknown as Array<{ id: string; name: string }>;

  return rows[0] ?? null;
}
