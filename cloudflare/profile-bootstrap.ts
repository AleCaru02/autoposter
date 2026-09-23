import { loadOwnedProfiles } from "../api/_lib/profile-bootstrap.js";
import { bearerValue, verifiedCustomerAuthUserId } from "../api/_lib/verified-customer-auth.js";

type Env = { DATABASE_URL?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function handleWorkerProfileBootstrap(request: Request, env: Env) {
  if (request.method !== "GET") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  const token = bearerValue(request.headers.get("authorization"));
  if (!token) return json({ error: "UNAUTHENTICATED" }, 401);
  const authUserId = await verifiedCustomerAuthUserId(token, env.DATABASE_URL);
  if (!authUserId) return json({ error: "UNAUTHENTICATED" }, 401);
  try {
    return json({ profiles: await loadOwnedProfiles(env.DATABASE_URL, authUserId) });
  } catch (reason) {
    console.error("profile-bootstrap", { authUserId, error: reason instanceof Error ? reason.message.slice(0, 120) : "PROFILE_BOOTSTRAP_FAILED" });
    return json({ error: "PROFILE_BOOTSTRAP_FAILED" }, 500);
  }
}
