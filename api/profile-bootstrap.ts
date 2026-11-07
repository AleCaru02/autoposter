import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { BootstrappedProfile } from "./_lib/profile-bootstrap.js";

/**
 * Vercel's production /api/profile-bootstrap endpoint.
 *
 * Read from Neon Data API with the caller's short-lived JWT. PostgreSQL RLS
 * enforces that only the authenticated user can see their own active profiles.
 * No privileged DATABASE_URL, admin role or service key is needed.
 */
export const NEON_PROFILES_DATA_API =
  "https://ep-divine-band-arrkz7vq.apirest.c-4.us-west-2.aws.neon.tech/neondb/rest/v1";

const PROFILE_COLUMNS =
  "id,name,slug,website_url,industry,timezone,locale,onboarding_completed,created_at,profile_type";
const MODE_COLUMNS = "profile_id,tenant_type,external_publishing_enabled";

type RawProfile = Omit<BootstrappedProfile, "tenant_type" | "external_publishing_enabled">;
type TenantMode = Pick<BootstrappedProfile, "tenant_type" | "external_publishing_enabled"> & { profile_id: string };

function bearer(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw?.startsWith("Bearer ")) return null;
  const token = raw.slice("Bearer ".length).trim();
  // The Data API verifies the signature, expiry, identity, policies and RLS.
  // Never accept a provider key, opaque ID or unsafely decoded JWT here.
  if (token.length > 8192 || /\s/.test(token) || token.split(".").length !== 3) return null;
  return token;
}

function noCache(res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  res.setHeader("pragma", "no-cache");
  res.setHeader("vary", "authorization");
}

async function readAuthenticatedRows<T>(token: string, path: string): Promise<
  | { ok: true; data: T[] }
  | { ok: false; status: number }
> {
  const response = await fetch(`${NEON_PROFILES_DATA_API}/${path}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) return { ok: false, status: response.status };
  const data: unknown = await response.json();
  if (!Array.isArray(data)) return { ok: false, status: 502 };
  return { ok: true, data: data as T[] };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  noCache(res);
  if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

  const token = bearer(req.headers.authorization);
  if (!token) return res.status(401).json({ error: "AUTH_REQUIRED" });

  try {
    const profileQuery = `profiles?select=${PROFILE_COLUMNS}&archived_at=is.null&order=created_at.asc`;
    const profiles = await readAuthenticatedRows<RawProfile>(token, profileQuery);
    if (profiles.ok === false) {
      if (profiles.status === 401 || profiles.status === 403) return res.status(401).json({ error: "SESSION_INVALID" });
      return res.status(502).json({ error: "PROFILE_DATA_API_FAILED" });
    }

    // The tenant-mode read is RLS-scoped too. Without it we cannot safely
    // distinguish QA/demo profiles from externally publishable customers.
    const modes = await readAuthenticatedRows<TenantMode>(token, `profile_tenant_modes?select=${MODE_COLUMNS}`);
    if (modes.ok === false) {
      if (modes.status === 401 || modes.status === 403) return res.status(401).json({ error: "SESSION_INVALID" });
      return res.status(502).json({ error: "TENANT_MODE_DATA_API_FAILED" });
    }

    const modesByProfileId = new Map(modes.data.map((mode) => [mode.profile_id, mode]));
    const result: BootstrappedProfile[] = profiles.data.map((profile) => {
      const mode = modesByProfileId.get(profile.id);
      return {
        ...profile,
        tenant_type: mode?.tenant_type ?? "CUSTOMER_REAL",
        external_publishing_enabled: mode?.external_publishing_enabled ?? true,
      };
    });
    return res.status(200).json({ profiles: result });
  } catch {
    // Never log JWT, user identity or provider response body.
    return res.status(502).json({ error: "PROFILE_DATA_UNAVAILABLE" });
  }
}
