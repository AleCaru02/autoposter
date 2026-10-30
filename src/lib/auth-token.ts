import { authClient } from "./neon-client";

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

export async function authenticatedApiToken(preferredToken?: string | null) {
  // The Neon Data API evaluates RLS from a signed JWT.  A Better Auth session
  // token can authenticate a same-origin request, but is not a Data API bearer.
  // neonClient.auth exposes the public Better Auth adapter, not Neon's internal
  // getJWTToken helper. Unknown adapter methods become HTTP paths, so calling
  // getJWTToken here requests /get-jwt-token instead of obtaining a JWT.
  void preferredToken;
  const result = await authClient.token({ fetchOptions: { cache: "no-store" } });
  const token = result.data?.token;
  if (result.error || typeof token !== "string" || token.split(".").length !== 3) throw new Error("Sessione non valida. Accedi di nuovo.");
  return token;
}
