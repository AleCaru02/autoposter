import type { VercelRequest, VercelResponse } from "@vercel/node";
import { neon } from "@neondatabase/serverless";
import { verifiedCustomerAuthUserId } from "./_lib/verified-customer-auth.js";
import { loadEditorialProfile } from "./_lib/personal-brand-sources.js";
import { TextGenerationMetering } from "./_lib/text-generation-metering.js";

// Read-only status of a previously reserved manual AI generation operation.
// Uses the SAME metering record as /api/generate-text; never initiates AI work.
export const config = { maxDuration: 60 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function publicGenerationError(detail: string) {
  if (detail === "OPENAI_FACTCHECK_NEEDS_SOURCE") return "FACTCHECK_NEEDS_SOURCE";
  if (detail === "OPENAI_FACTCHECK_BLOCK") return "FACTCHECK_BLOCKED";
  if (detail === "OPENAI_RESEARCH_BLOCKED" || detail === "AI_BRAIN_INSUFFICIENT_SOURCES") return "RESEARCH_INSUFFICIENT";
  if (detail.startsWith("METERING_FAILED")) return "METERING_FAILED";
  if (detail.startsWith("OPENAI_")) return "AI_PROVIDER_ERROR";
  return "GENERATION_FAILED";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "AUTH_REQUIRED" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "DATABASE_NOT_CONFIGURED" });

  const profileId = typeof req.body?.profileId === "string" ? req.body.profileId : "";
  const idHeader = req.headers["x-post-automatici-operation-id"];
  const operationIdentity = (Array.isArray(idHeader) ? idHeader[0] : idHeader || "").trim();
  if (!UUID.test(profileId) || !/^[A-Za-z0-9._:-]{16,128}$/.test(operationIdentity)) {
    return res.status(400).json({ error: "OPERATION_ID_REQUIRED" });
  }

  try {
    const authUserId = await verifiedCustomerAuthUserId(token, process.env.DATABASE_URL);
    if (!authUserId) return res.status(401).json({ error: "AUTH_REQUIRED" });
    const sql = neon(process.env.DATABASE_URL);
    await loadEditorialProfile(sql, profileId, authUserId);
    const status = await new TextGenerationMetering(process.env.DATABASE_URL).getOperationStatus(
      profileId, "MANUAL", operationIdentity,
    );
    if (!status) return res.status(200).json({ state: "NOT_FOUND", percent: 0, stage: "PREPARING" });
    const cached = status.cached?.response && typeof status.cached.response === "object" ? status.cached.response : null;
    return res.status(200).json({
      jobId: status.eventId,
      operationId: operationIdentity,
      state: status.state === "COMMITTED" ? "COMPLETED" : status.state === "RELEASED" ? "FAILED" : "IN_PROGRESS",
      percent: status.percent,
      stage: status.stage,
      error: status.releaseReason ? publicGenerationError(status.releaseReason) : null,
      result: cached,
      startedAt: status.createdAt,
      updatedAt: status.updatedAt,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "PROFILE_NOT_FOUND") {
      return res.status(404).json({ error: "PROFILE_NOT_FOUND" });
    }
    console.error("vercel.generate-text-status", { code: "STATUS_UNAVAILABLE" });
    return res.status(503).json({ error: "STATUS_UNAVAILABLE" });
  }
}
