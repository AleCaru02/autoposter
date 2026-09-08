import { mutateCalendar, type CalendarMutationInput } from "../api/_lib/calendar-mutations.js";
import { bearerValue, verifiedCustomerAuthUserId } from "../api/_lib/verified-customer-auth.js";

type Env = { DATABASE_URL?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function statusForError(detail: string) {
  if (/OPERATION_ID_REQUIRED|CALENDAR_INPUT_INVALID|CALENDAR_VARIANT_NOT_READY|CALENDAR_SOCIAL_NOT_CONNECTED|CALENDAR_DUPLICATE_VARIANT|CALENDAR_JOB_IMMUTABLE|CALENDAR_JOB_NOT_RESCHEDULABLE/.test(detail)) return 400;
  if (detail.includes("CALENDAR_JOB_NOT_FOUND")) return 404;
  if (/CALENDAR_JOB_STALE|GENERATION_IN_PROGRESS/.test(detail)) return 409;
  if (/CALENDAR_FORBIDDEN|CALENDAR_METERING_INVALID/.test(detail)) return 403;
  if (/CAPABILITY_DISABLED|CAPABILITY_LIMIT_REACHED/.test(detail)) return 429;
  return 500;
}

export async function handleWorkerCalendar(request: Request, env: Env) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  if (!env.DATABASE_URL) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  const token = bearerValue(request.headers.get("authorization"));
  if (!token) return json({ error: "UNAUTHENTICATED" }, 401);
  const authUserId = await verifiedCustomerAuthUserId(token, env.DATABASE_URL);
  if (!authUserId) return json({ error: "UNAUTHENTICATED" }, 401);
  let body: CalendarMutationInput;
  try { body = await request.json() as CalendarMutationInput; }
  catch { return json({ error: "INVALID_JSON" }, 400); }
  try {
    return json(await mutateCalendar(env.DATABASE_URL, authUserId, body));
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : "CALENDAR_MUTATION_FAILED";
    const status = statusForError(detail);
    console.error("calendar-mutation", { status, code: detail.split(":")[0] });
    return json({ error: status === 500 ? "CALENDAR_MUTATION_FAILED" : detail.split(":")[0] }, status);
  }
}
