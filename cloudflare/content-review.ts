import { reviewContentVariant, type ContentReviewInput } from "../api/_lib/content-review.js";
import { bearerValue, verifiedCustomerAuthUserId } from "../api/_lib/verified-customer-auth.js";

type Env = { DATABASE_URL?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function statusForError(detail: string) {
  if (detail.includes("CONTENT_REVIEW_INPUT_INVALID")) return 400;
  if (detail.includes("CONTENT_REVIEW_NOT_FOUND")) return 404;
  if (detail.includes("CONTENT_REVIEW_STALE")) return 409;
  if (detail.includes("CONTENT_REVIEW_FORBIDDEN")) return 403;
  return 500;
}

export async function handleWorkerContentReview(request: Request, env: Env) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  const token = bearerValue(request.headers.get("authorization"));
  if (!token) return json({ error: "UNAUTHENTICATED" }, 401);
  const authUserId = await verifiedCustomerAuthUserId(token, env.DATABASE_URL);
  if (!authUserId) return json({ error: "UNAUTHENTICATED" }, 401);
  let body: ContentReviewInput;
  try { body = await request.json() as ContentReviewInput; }
  catch { return json({ error: "INVALID_JSON" }, 400); }
  try {
    return json(await reviewContentVariant(env.DATABASE_URL, authUserId, body));
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "CONTENT_REVIEW_FAILED";
    const status = statusForError(detail);
    console.error("content-review", { status, code: detail.split(":")[0] });
    return json({ error: status === 500 ? "CONTENT_REVIEW_FAILED" : detail.split(":")[0] }, status);
  }
}
