import { archiveOwnedProfile } from "../api/_lib/profile-archive.js";
import { bearerValue, verifiedCustomerAuthUserId } from "../api/_lib/verified-customer-auth.js";

type Env = { DATABASE_URL?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function handleWorkerProfileArchive(request: Request, env: Env) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);

  const token = bearerValue(request.headers.get("authorization"));
  if (!token) return json({ error: "UNAUTHENTICATED" }, 401);
  const authUserId = await verifiedCustomerAuthUserId(token, env.DATABASE_URL);
  if (!authUserId) return json({ error: "UNAUTHENTICATED" }, 401);

  let profileId = "";
  try {
    const body = await request.json() as { profileId?: unknown };
    profileId = typeof body.profileId === "string" ? body.profileId : "";
  } catch {
    return json({ error: "INVALID_BODY" }, 400);
  }
  if (!/^[0-9a-f-]{36}$/i.test(profileId)) return json({ error: "PROFILE_REQUIRED" }, 400);

  try {
    const archived = await archiveOwnedProfile(env.DATABASE_URL, authUserId, profileId);
    if (!archived) return json({ error: "PROFILE_NOT_FOUND" }, 404);
    return json({ archived: true, profileId: archived.id });
  } catch (reason) {
    console.error("profile-archive", { authUserId, profileId, error: reason instanceof Error ? reason.message.slice(0, 120) : "PROFILE_ARCHIVE_FAILED" });
    return json({ error: "PROFILE_ARCHIVE_FAILED" }, 500);
  }
}
