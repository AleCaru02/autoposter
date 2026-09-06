import { completeOnboardingProfile } from "../api/_lib/onboarding-completion.js";
import { bearerValue, verifiedCustomerAuthUserId } from "../api/_lib/verified-customer-auth.js";

type Env = { DATABASE_URL?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

export async function handleWorkerOnboardingComplete(request: Request, env: Env) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  const token = bearerValue(request.headers.get("authorization"));
  if (!token) return json({ error: "UNAUTHENTICATED" }, 401);
  const authUserId = await verifiedCustomerAuthUserId(token, env.DATABASE_URL);
  if (!authUserId) return json({ error: "UNAUTHENTICATED" }, 401);
  try {
    const body = await request.json() as Record<string, unknown>;
    const profileId = typeof body.profileId === "string" ? body.profileId : "";
    await completeOnboardingProfile(env.DATABASE_URL, authUserId, profileId, "NO_WEBSITE");
    return json({ completed: true });
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "ONBOARDING_COMPLETION_FAILED";
    if (detail === "ONBOARDING_COMPLETION_INPUT_INVALID") return json({ error: detail }, 400);
    if (detail.includes("ONBOARDING_PROFILE_NOT_FOUND")) return json({ error: "PROFILE_NOT_FOUND" }, 404);
    if (detail.includes("ONBOARDING_WEBSITE_REQUIRES_ANALYSIS")) return json({ error: "WEBSITE_REQUIRES_ANALYSIS" }, 409);
    return json({ error: "ONBOARDING_COMPLETION_FAILED" }, 500);
  }
}
