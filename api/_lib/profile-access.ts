import { dataApiFetch } from "./cold-start-fetch.js";
import { neonDataApiUrl } from "./neon-endpoints.js";

/**
 * Profile access through the Data API with the caller's own token (RLS decides ownership).
 * The shared fetch absorbs a Neon cold start. Used by the render and avatar routes.
 */
export async function authorizedUser(token: string, profileId: string, fetcher: typeof fetch = dataApiFetch) {
  const response = await fetcher(`${neonDataApiUrl()}/profiles?id=eq.${encodeURIComponent(profileId)}&select=id,owner_auth_user_id&limit=1`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 401 || response.status === 403) throw new Error("SESSION_INVALID");
  if (!response.ok) throw new Error("PROFILE_DATA_API_UNAVAILABLE");
  const rows = await response.json() as Array<{ id?: string; owner_auth_user_id?: string }>;
  const row = Array.isArray(rows) ? rows.find((item) => item?.id === profileId) : null;
  return row ? { ownerId: row.owner_auth_user_id ?? null } : null;
}

export function bearerToken(header: string | string[] | undefined) {
  const value = Array.isArray(header) ? header[0] : header;
  return value?.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
}
