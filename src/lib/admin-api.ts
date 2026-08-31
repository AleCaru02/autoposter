import { authClient } from "./neon-client";

export async function adminRequest<T>(path: string): Promise<T> {
  const tokenResult = await authClient.token({
    fetchOptions: { headers: { "X-Force-Fetch": "1" } },
  });
  const token = tokenResult.data?.token;
  if (tokenResult.error || !token) throw Object.assign(new Error("UNAUTHENTICATED"), { status: 401 });
  const response = await fetch(path, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  let body: unknown = null;
  try { body = await response.json(); } catch { /* use generic error below */ }
  if (!response.ok) {
    const error = new Error(typeof body === "object" && body && "error" in body ? String((body as { error?: unknown }).error) : "ADMIN_API_FAILED");
    throw Object.assign(error, { status: response.status });
  }
  return body as T;
}
