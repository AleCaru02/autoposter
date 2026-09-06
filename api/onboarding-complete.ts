import type { VercelRequest, VercelResponse } from "@vercel/node";
import { completeOnboardingProfile } from "./_lib/onboarding-completion.js";
import { bearerValue, verifiedCustomerAuthUserId } from "./_lib/verified-customer-auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "DATABASE_NOT_CONFIGURED" });
  const token = bearerValue(req.headers.authorization);
  if (!token) return res.status(401).json({ error: "UNAUTHENTICATED" });
  const authUserId = await verifiedCustomerAuthUserId(token, process.env.DATABASE_URL);
  if (!authUserId) return res.status(401).json({ error: "UNAUTHENTICATED" });
  const profileId = typeof req.body?.profileId === "string" ? req.body.profileId : "";
  try {
    await completeOnboardingProfile(process.env.DATABASE_URL, authUserId, profileId, "NO_WEBSITE");
    return res.status(200).json({ completed: true });
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "ONBOARDING_COMPLETION_FAILED";
    if (detail === "ONBOARDING_COMPLETION_INPUT_INVALID") return res.status(400).json({ error: detail });
    if (detail.includes("ONBOARDING_PROFILE_NOT_FOUND")) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });
    if (detail.includes("ONBOARDING_WEBSITE_REQUIRES_ANALYSIS")) return res.status(409).json({ error: "WEBSITE_REQUIRES_ANALYSIS" });
    return res.status(500).json({ error: "ONBOARDING_COMPLETION_FAILED" });
  }
}
