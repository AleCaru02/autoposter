import { authClient } from "./neon-client";

export async function authenticatedApiToken() {
  const result = await authClient.token({
    fetchOptions: { headers: { "X-Force-Fetch": "1" } },
  });
  const token = result.data?.token;
  if (result.error || !token) throw new Error("Sessione non valida. Accedi di nuovo.");
  return token;
}
