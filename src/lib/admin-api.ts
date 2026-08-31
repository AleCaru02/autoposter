import { authClient } from "./neon-client";

export async function adminRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const tokenResult = await authClient.token({
    fetchOptions: { headers: { "X-Force-Fetch": "1" } },
  });
  const token = tokenResult.data?.token;
  if (tokenResult.error || !token) throw Object.assign(new Error("UNAUTHENTICATED"), { status: 401 });

  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("accept", "application/json");
  const response = await fetch(path, { ...init, headers });
  let body: unknown = null;
  try { body = await response.json(); } catch { /* success may not have a JSON body */ }
  if (!response.ok) {
    const error = new Error(typeof body === "object" && body && "error" in body ? String((body as { error?: unknown }).error) : "ADMIN_API_FAILED");
    throw Object.assign(error, { status: response.status });
  }
  return body as T;
}
