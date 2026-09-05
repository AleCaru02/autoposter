import type { VercelRequest, VercelResponse } from "@vercel/node";
import { provisionOnboardingProfile, type OnboardingProvisionInput } from "./_lib/onboarding-provisioning.js";
import { bearerValue, verifiedCustomerAuthUserId } from "./_lib/verified-customer-auth.js";

export const config = { maxDuration: 20 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "DATABASE_NOT_CONFIGURED" });
  const token = bearerValue(req.headers.authorization);
  if (!token) return res.status(401).json({ error: "UNAUTHENTICATED" });
  const authUserId = await verifiedCustomerAuthUserId(token, process.env.DATABASE_URL);
  if (!authUserId) return res.status(401).json({ error: "UNAUTHENTICATED" });
  try {
    const profile = await provisionOnboardingProfile(process.env.DATABASE_URL, authUserId, req.body as OnboardingProvisionInput);
    return res.status(201).json({ profile });
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "ONBOARDING_PROVISIONING_FAILED";
    console.error("onboarding-provision", { authUserId, error: detail.slice(0, 120) });
    if (detail === "ONBOARDING_INPUT_INVALID" || detail === "ONBOARDING_WEBSITE_INVALID") return res.status(400).json({ error: detail });
    if (detail.includes("ONBOARDING_IDEMPOTENCY_CONFLICT")) return res.status(409).json({ error: "ONBOARDING_IDEMPOTENCY_CONFLICT" });
    if (detail.includes("PACKAGE_NOT_ACTIVE")) return res.status(503).json({ error: "ONBOARDING_PROVISIONING_FAILED" });
    return res.status(500).json({ error: "ONBOARDING_PROVISIONING_FAILED" });
  }
}
