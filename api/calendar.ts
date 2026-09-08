import type { VercelRequest, VercelResponse } from "@vercel/node";
import { mutateCalendar, type CalendarMutationInput } from "./_lib/calendar-mutations.js";
import { bearerValue, verifiedCustomerAuthUserId } from "./_lib/verified-customer-auth.js";

function statusForError(detail: string) {
  if (detail.includes("OPERATION_ID_REQUIRED") || detail.includes("CALENDAR_INPUT_INVALID") || detail.includes("CALENDAR_VARIANT_NOT_READY") || detail.includes("CALENDAR_SOCIAL_NOT_CONNECTED") || detail.includes("CALENDAR_DUPLICATE_VARIANT") || detail.includes("CALENDAR_JOB_IMMUTABLE") || detail.includes("CALENDAR_JOB_NOT_RESCHEDULABLE")) return 400;
  if (detail.includes("CALENDAR_JOB_NOT_FOUND")) return 404;
  if (detail.includes("CALENDAR_JOB_STALE") || detail.includes("GENERATION_IN_PROGRESS")) return 409;
  if (detail.includes("CALENDAR_FORBIDDEN") || detail.includes("CALENDAR_METERING_INVALID")) return 403;
  if (detail.includes("CAPABILITY_DISABLED") || detail.includes("CAPABILITY_LIMIT_REACHED")) return 429;
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
    return res.status(200).json(await mutateCalendar(process.env.DATABASE_URL, authUserId, req.body as CalendarMutationInput));
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "CALENDAR_MUTATION_FAILED";
    const status = statusForError(detail);
    return res.status(status).json({ error: status === 500 ? "CALENDAR_MUTATION_FAILED" : detail.split(":")[0] });
  }
}
