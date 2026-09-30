import { runContentQa } from "../api/_lib/content-qa.js";
import { bearerValue, verifiedCustomerAuthUserId } from "../api/_lib/verified-customer-auth.js";

type Env = { DATABASE_URL?: string; OPENAI_API_KEY?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function statusFor(detail: string) {
  if (detail.includes("CONTENT_QA_INPUT_INVALID")) return 400;
  if (detail.includes("CONTENT_QA_NOT_FOUND") || detail.includes("PROFILE_NOT_FOUND")) return 404;
  if (detail.includes("CONTENT_QA_DISABLED") || detail.includes("CONTENT_QA_LIMIT_REACHED")) return 429;
  if (detail.includes("CONTENT_QA_IN_PROGRESS") || detail.includes("CONTENT_QA_RETRY_REQUIRED")) return 409;
  if (detail.includes("OPENAI_NOT_CONFIGURED")) return 503;
  return 500;
}

export async function handleContentQa(request: Request, env: Env) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  if (!env.OPENAI_API_KEY) return json({ error: "OPENAI_NOT_CONFIGURED" }, 503);

  const token = bearerValue(request.headers.get("authorization"));
  if (!token) return json({ error: "UNAUTHENTICATED" }, 401);
  const authUserId = await verifiedCustomerAuthUserId(token, env.DATABASE_URL);
  if (!authUserId) return json({ error: "UNAUTHENTICATED" }, 401);

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ error: "INVALID_JSON" }, 400);
  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  const contentId = typeof body.contentId === "string" ? body.contentId : "";
  const variantId = typeof body.variantId === "string" ? body.variantId : "";

  try {
    const result = await runContentQa({
      databaseUrl: env.DATABASE_URL,
      apiKey: env.OPENAI_API_KEY,
      profileId,
      contentId,
      variantId,
      actorType: "MANUAL",
      authUserId,
      force: body.force === true,
    });
    return json(result);
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "CONTENT_QA_FAILED";
    const status = statusFor(detail);
    console.error("content-qa", { profileId, contentId, variantId, status, code: detail.split(":")[0] });
    return json({ error: status === 500 ? "CONTENT_QA_FAILED" : detail.split(":")[0] }, status);
  }
}
