import { provisionOnboardingProfile, type OnboardingProvisionInput } from "../api/_lib/onboarding-provisioning.js";
import { bearerValue, verifiedCustomerAuthUserId } from "../api/_lib/verified-customer-auth.js";

type Env = { DATABASE_URL?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function errorStatus(message: string) {
  if (message === "ONBOARDING_INPUT_INVALID" || message === "ONBOARDING_WEBSITE_INVALID") return 400;
  if (message.includes("ONBOARDING_IDEMPOTENCY_CONFLICT")) return 409;
  if (message.includes("PACKAGE_NOT_ACTIVE")) return 503;
  return 500;
}

export async function handleWorkerOnboardingProvision(request: Request, env: Env) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  const token = bearerValue(request.headers.get("authorization"));
  if (!token) return json({ error: "UNAUTHENTICATED" }, 401);
  const authUserId = await verifiedCustomerAuthUserId(token, env.DATABASE_URL);
  if (!authUserId) return json({ error: "UNAUTHENTICATED" }, 401);
  let body: OnboardingProvisionInput;
  try { body = await request.json() as OnboardingProvisionInput; }
  catch { return json({ error: "INVALID_JSON" }, 400); }
  try {
    return json({ profile: await provisionOnboardingProfile(env.DATABASE_URL, authUserId, body) }, 201);
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "ONBOARDING_PROVISIONING_FAILED";
    console.error("onboarding-provision", { authUserId, error: detail.slice(0, 120) });
    const status = errorStatus(detail);
    return json({ error: status === 409 ? "ONBOARDING_IDEMPOTENCY_CONFLICT" : status === 400 ? detail : "ONBOARDING_PROVISIONING_FAILED" }, status);
  }
}
