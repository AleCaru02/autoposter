import worker from "./worker.js";
import { runContentAutopilotSerialized } from "../api/_lib/autopilot-serialized.js";
import type { AutopilotEnv } from "../api/_lib/autopilot.js";
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
    const scopes = (authorizationUrl.searchParams.get("scope") || "").split(",").map((scope) => scope.trim()).filter(Boolean);
    if (!scopes.includes("business_management")) scopes.push("business_management");
    authorizationUrl.searchParams.set("scope", scopes.join(","));
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

function oauthProfileId(request: Request) {
  try {
    const state = new URL(request.url).searchParams.get("state") || "";
    const encoded = state.split(".")[0];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((encoded.length + 3) % 4);
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as { profileId?: unknown };
    return typeof payload.profileId === "string" && /^[0-9a-f-]{36}$/i.test(payload.profileId) ? payload.profileId : null;
  } catch {
    return null;
  }
}

function withOAuthProfileRedirect(request: Request, response: Response) {
  if (response.status < 300 || response.status >= 400) return response;
  const location = response.headers.get("location");
  const profileId = oauthProfileId(request);
  if (!location || !profileId) return response;
  try {
    const target = new URL(location, request.url);
    target.searchParams.set("profileId", profileId);
    const headers = new Headers(response.headers);
    headers.set("location", target.toString());
    return new Response(null, { status: response.status, headers });
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
  ctx.waitUntil(runContentAutopilotSerialized(env, { profileId, maxGenerations: 6 }).then((result) => {
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
      if (response) {
        if (path === "/api/social/connect") return withFreshMetaConsent(response);
        if (path.startsWith("/api/social/callback/")) return withOAuthProfileRedirect(request, response);
        return response;
      }
    }
    return worker.fetch(request, env);
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: WorkerContext) {
    if (controller.cron === "*/5 * * * *") {
      ctx.waitUntil(processDuePublications(env).then((result) => {
        console.log("social-publication-run", result);
      }).catch((reason) => {
        console.error("social-publication-failed", reason instanceof Error ? reason.message : "unknown");
      }));
      return;
    }

    ctx.waitUntil(runContentAutopilotSerialized(env).then((result) => {
      console.log("content-autopilot", result);
    }).catch((reason) => {
      console.error("content-autopilot-failed", reason instanceof Error ? reason.message : "unknown");
    }));
  },
};
