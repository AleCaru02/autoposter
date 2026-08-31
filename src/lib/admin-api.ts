import { authClient } from "./neon-client";

function safeError(reason: unknown) {
  if (!reason || typeof reason !== "object") return { name: typeof reason, message: "unknown", status: null };
  const value = reason as { name?: unknown; message?: unknown; status?: unknown };
  return {
    name: typeof value.name === "string" ? value.name : "unknown",
    message: typeof value.message === "string" ? value.message.slice(0, 160) : "unknown",
    status: typeof value.status === "number" ? value.status : null,
  };
}

export async function adminRequest<T>(path: string): Promise<T> {
  console.warn("ADMIN_TOKEN_FLOW", { stage: "token-call", path });
  let tokenResult: Awaited<ReturnType<typeof authClient.token>>;
  try {
    tokenResult = await authClient.token();
  } catch (reason) {
    console.warn("ADMIN_TOKEN_FLOW", { stage: "token-error", path, ...safeError(reason) });
    throw reason;
  }
  const token = tokenResult.data?.token;
  console.warn("ADMIN_TOKEN_FLOW", {
    stage: "token-result",
    path,
    tokenPresent: typeof token === "string" && token.length > 0,
    tokenLengthPositive: typeof token === "string" && token.length > 0,
    errorPresent: Boolean(tokenResult.error),
  });
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
