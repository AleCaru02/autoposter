import type { VercelRequest, VercelResponse } from "@vercel/node";
import { archiveOwnedProfile } from "./_lib/profile-archive.js";
import { bearerValue, verifiedCustomerAuthUserId } from "./_lib/verified-customer-auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "DATABASE_NOT_CONFIGURED" });

  const token = bearerValue(req.headers.authorization);
  if (!token) return res.status(401).json({ error: "UNAUTHENTICATED" });
  const authUserId = await verifiedCustomerAuthUserId(token, process.env.DATABASE_URL);
  if (!authUserId) return res.status(401).json({ error: "UNAUTHENTICATED" });

  const profileId = typeof req.body?.profileId === "string" ? req.body.profileId : "";
  if (!/^[0-9a-f-]{36}$/i.test(profileId)) return res.status(400).json({ error: "PROFILE_REQUIRED" });

  try {
    const archived = await archiveOwnedProfile(process.env.DATABASE_URL, authUserId, profileId);
    if (!archived) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });
    return res.status(200).json({ archived: true, profileId: archived.id });
  } catch {
    return res.status(500).json({ error: "PROFILE_ARCHIVE_FAILED" });
  }
}
