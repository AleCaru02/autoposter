import type { VercelRequest, VercelResponse } from "@vercel/node";
import { reviewContentVariant, type ContentReviewInput } from "./_lib/content-review.js";
import { bearerValue, verifiedCustomerAuthUserId } from "./_lib/verified-customer-auth.js";

function statusForError(detail: string) {
  if (detail.includes("CONTENT_REVIEW_INPUT_INVALID")) return 400;
  if (detail.includes("CONTENT_REVIEW_NOT_FOUND")) return 404;
  if (detail.includes("CONTENT_REVIEW_STALE")) return 409;
  if (detail.includes("CONTENT_REVIEW_FORBIDDEN")) return 403;
  return 500;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "DATABASE_NOT_CONFIGURED" });
  const token = bearerValue(req.headers.authorization);
  if (!token) return res.status(401).json({ error: "UNAUTHENTICATED" });
  const authUserId = await verifiedCustomerAuthUserId(token, process.env.DATABASE_URL);
  if (!authUserId) return res.status(401).json({ error: "UNAUTHENTICATED" });
  try {
    return res.status(200).json(await reviewContentVariant(process.env.DATABASE_URL, authUserId, req.body as ContentReviewInput));
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "CONTENT_REVIEW_FAILED";
    const status = statusForError(detail);
    return res.status(status).json({ error: status === 500 ? "CONTENT_REVIEW_FAILED" : detail.split(":")[0] });
  }
}
