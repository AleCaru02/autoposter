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
  if (preferredToken?.trim()) return preferredToken.trim();
  const result = await authClient.token({
    fetchOptions: { headers: { "X-Force-Fetch": "1" } },
  });
  const token = result.data?.token;
  if (result.error || !token) throw new Error("Sessione non valida. Accedi di nuovo.");
  return token;
}
