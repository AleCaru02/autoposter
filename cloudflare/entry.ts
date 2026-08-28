import worker from "./worker.js";
import { runContentAutopilot, type AutopilotEnv } from "../api/_lib/autopilot.js";
import { handleSocialApi, processDuePublications, type SocialEnv } from "../api/_lib/social.js";

const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";

type Env = AutopilotEnv & SocialEnv & {
  ASSETS: { fetch(request: Request): Promise<Response> };
};
type WorkerContext = { waitUntil(promise: Promise<unknown>): void };
type ScheduledController = { cron?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function bearer(request: Request) {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
}

function canonicalNavigation(request: Request, env: Env) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (!request.headers.get("accept")?.includes("text/html")) return null;
  const current = new URL(request.url);
  let canonical: URL;
  try {
    canonical = new URL(env.APP_BASE_URL || "https://autoposter.02alessandrocaruso.workers.dev");
  } catch {
    return null;
  }
  if (current.hostname === canonical.hostname || !current.hostname.endsWith(`-${canonical.hostname}`)) return null;
  canonical.pathname = current.pathname;
  canonical.search = current.search;
  return Response.redirect(canonical.toString(), 307);
}

async function withFreshMetaConsent(response: Response) {
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return response;
  try {
    const body = await response.clone().json() as Record<string, unknown>;
    if (typeof body.url !== "string") return response;
    const authorizationUrl = new URL(body.url);
    if (authorizationUrl.hostname !== "www.facebook.com") return response;
    authorizationUrl.searchParams.set("auth_type", "rerequest");
    authorizationUrl.searchParams.set("return_scopes", "true");
    return new Response(JSON.stringify({ ...body, url: authorizationUrl.toString() }), {
      status: response.status,
      headers: response.headers,
    });
  } catch {
    return response;
  }
}

async function canAccessProfile(request: Request, profileId: string) {
  const token = bearer(request);
  if (!token) return false;
  const response = await fetch(`${DATA_API}/profiles?id=eq.${encodeURIComponent(profileId)}&select=id&limit=1`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!response.ok) return false;
  const rows = await response.json() as Array<{ id?: string }>;
  return rows.some((row) => row.id === profileId);
}

async function handleAutopilotRun(request: Request, env: Env, ctx: WorkerContext) {
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  let profileId = "";
  try {
    const body = await request.json() as Record<string, unknown>;
    profileId = typeof body.profileId === "string" ? body.profileId : "";
  } catch { /* handled below */ }
  if (!profileId) return json({ error: "PROFILE_REQUIRED" }, 400);
  if (!await canAccessProfile(request, profileId)) return json({ error: "PROFILE_NOT_FOUND" }, 404);
  ctx.waitUntil(runContentAutopilot(env, { profileId, maxGenerations: 6 }).then((result) => {
    console.log("content-autopilot-profile", { profileId, ...result });
  }).catch((reason) => {
    console.error("autopilot-profile-failed", { profileId, detail: reason instanceof Error ? reason.message : "unknown" });
  }));
  return json({ accepted: true }, 202);
}

export default {
  async fetch(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
    const canonicalRedirect = canonicalNavigation(request, env);
    if (canonicalRedirect) return canonicalRedirect;
    const path = new URL(request.url).pathname;
    if (path === "/api/autopilot/run") return handleAutopilotRun(request, env, ctx);
    if (path.startsWith("/api/social/")) {
      const response = await handleSocialApi(request, env);
      if (response) return path === "/api/social/connect" ? withFreshMetaConsent(response) : response;
    }
    return worker.fetch(request, env);
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: WorkerContext) {
    if (controller.cron === "*/5 * * * *") {
      ctx.waitUntil(processDuePublications(env).then((result) => {
        console.log("social-publication-run", result);
      }).catch((reason) => {
        console.error("social-publication-failed", reason instanceof Error ? reason.message : "unknown" });
      }));
      return;
    }

    ctx.waitUntil(runContentAutopilot(env).then((result) => {
      console.log("content-autopilot", result);
    }).catch((reason) => {
      console.error("content-autopilot-failed", reason instanceof Error ? reason.message : "unknown" });
    }));
  },
};
