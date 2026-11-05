type SessionTokenShape = {
  session?: { token?: string | null } | null;
  token?: string | null;
  access_token?: string | null;
};

export function tokenFromAuthSession(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const data = value as SessionTokenShape;
  return data.session?.token || data.token || data.access_token || null;
}

/**
 * Obtain the RLS JWT from the documented Neon Auth /token endpoint.
 *
 * Better Auth's useSession().session.token is an opaque session identifier,
 * not a Data API JWT. On the pinned Neon beta adapter authClient.token() can
 * also return a cached session-shaped response rather than { token: JWT }.
 * Call the endpoint directly with the current first-party HttpOnly cookie.
 * Never store, log, or forward the opaque session identifier as a Data API JWT.
 */
export async function authenticatedApiToken(preferredToken?: string | null) {
  void preferredToken; // Never trust an old token when the session changes.
  let response: Response;
  try {
    response = await fetch("/api/auth/token", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  } catch {
    throw new Error("AUTH_JWT_NETWORK_FAILED");
  }

  if (response.status === 401 || response.status === 403) throw new Error("SESSION_INVALID");
  if (response.status === 404) throw new Error("AUTH_JWT_ENDPOINT_MISSING");
  if (!response.ok) throw new Error("AUTH_JWT_ENDPOINT_FAILED");

  const data: unknown = await response.json().catch(() => null);
  const token = data && typeof data === "object" && "token" in data
    ? (data as { token?: unknown }).token
    : null;
  if (typeof token !== "string" || token.length > 8192 ||
      token.split(".").length !== 3 || token.split(".").some((part) => !part) ||
      /\s/.test(token)) {
    throw new Error("AUTH_JWT_INVALID_RESPONSE");
  }
  return token;
}
