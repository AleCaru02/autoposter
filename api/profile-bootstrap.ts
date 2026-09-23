import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loadOwnedProfiles } from "./_lib/profile-bootstrap.js";
import { bearerValue, verifiedCustomerAuthUserId } from "./_lib/verified-customer-auth.js";

export const config = { maxDuration: 20 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "DATABASE_NOT_CONFIGURED" });
  const token = bearerValue(req.headers.authorization);
  if (!token) return res.status(401).json({ error: "UNAUTHENTICATED" });
  const authUserId = await verifiedCustomerAuthUserId(token, process.env.DATABASE_URL);
  if (!authUserId) return res.status(401).json({ error: "UNAUTHENTICATED" });
  try {
    return res.status(200).json({ profiles: await loadOwnedProfiles(process.env.DATABASE_URL, authUserId) });
  } catch (reason) {
    console.error("profile-bootstrap", { authUserId, error: reason instanceof Error ? reason.message.slice(0, 120) : "PROFILE_BOOTSTRAP_FAILED" });
    return res.status(500).json({ error: "PROFILE_BOOTSTRAP_FAILED" });
  }
}
