import { neon } from "@neondatabase/serverless";

const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";

function identityFromRpcPayload(payload: unknown): string | null {
  if (typeof payload === "string") return payload.trim() || null;
  const candidate = Array.isArray(payload) ? payload[0] : payload;
  if (!candidate || typeof candidate !== "object") return null;
  const record = candidate as Record<string, unknown>;
  for (const key of ["current_auth_user_id", "auth_user_id", "current_platform_identity"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  return null;
}

export function bearerValue(header: string | null | undefined) {
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}

export async function verifiedCustomerAuthUserId(token: string, databaseUrl: string) {
  try {
    const response = await fetch(`${DATA_API}/rpc/current_auth_user_id`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, accept: "application/json", "content-type": "application/json" },
      body: "{}",
    });
    if (!response.ok) return null;
    const authUserId = identityFromRpcPayload(await response.json());
    if (!authUserId) return null;
    const sql = neon(databaseUrl);
    const rows = await sql`
      select id::text as id, coalesce(banned, false) as banned
      from neon_auth.user
      where id::text = ${authUserId}
      limit 1
    ` as unknown as Array<{ id: string; banned: boolean }>;
    return rows[0]?.id && rows[0].banned !== true ? rows[0].id : null;
  } catch {
    return null;
  }
}
