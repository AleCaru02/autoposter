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
  // Always use the same JWT boundary already used by neonClient itself.
  void preferredToken;
  const jwtClient = authClient as typeof authClient & { getJWTToken?: () => Promise<string | null | undefined> };
  const token = await jwtClient.getJWTToken?.();
  if (!token || token.split(".").length !== 3) throw new Error("Sessione non valida. Accedi di nuovo.");
  return token;
}
