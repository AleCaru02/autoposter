import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleSameOriginAuthProxy } from "../../cloudflare/auth-proxy.js";
import { APP_ORIGIN, normalizeNeonAuthCookie } from "../auth.js";

const CHALLENGE_COOKIE = /(?:^|;\s*)__Secure-neon-auth\.session_chall(?:enge|ange)=/;
const SESSION_COOKIE = /^__Secure-neon-auth\.session_token=/;
const MAX_VERIFIER_LENGTH = 4096;

type Failure =
  | "provider_failed"
  | "missing_verifier"
  | "missing_challenge"
  | "exchange_failed"
  | "session_cookie_missing"
  | "callback_failed";

function fail(res: VercelResponse, code: Failure) {
  // Never place the verifier, OAuth code, Google details or cookies in URLs or logs.
  res.setHeader("cache-control", "no-store");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("location", `${APP_ORIGIN}/login?oauth=${code}`);
  return res.status(302).send("");
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function activeSessionCookie(cookie: string): boolean {
  if (!SESSION_COOKIE.test(cookie)) return false;
  if (/;\s*max-age=0(?:;|$)/i.test(cookie)) return false;
  if (/;\s*expires=(?:thu,\s*)?0?1\s+jan\s+1970/i.test(cookie)) return false;
  return cookie.slice(cookie.indexOf("=") + 1).split(";", 1)[0].length > 0;
}

/**
 * The hosted Neon Auth callback sends a one-time
 * neon_auth_session_verifier to the app. It must be exchanged alongside the
 * first-party session_challenge cookie before React's RequireAuth mounts.
 * In particular, GET /get-session with this verifier yields session cookies:
 * doing this in the browser after rendering the dashboard causes login loops.
 *
 * The fixed upstream is owned by handleSameOriginAuthProxy, which preserves
 * the signed verifier and challenge and cannot be redirected to arbitrary URLs.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  res.setHeader("referrer-policy", "no-referrer");

  if (req.method !== "GET") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  if (first(req.headers.host) !== new URL(APP_ORIGIN).host) return res.status(403).json({ error: "CALLBACK_HOST_NOT_ALLOWED" });
  // Better Auth sends a reason through the provider's error callback.
  // Earlier versions collapsed every reason to provider_failed, making
  // account linking, Google denial and malformed OAuth state indistinguishable.
  const rawProviderError = first(req.query.error);
  if (typeof rawProviderError === "string") {
    const knownProviderErrors = new Set([
      "account_not_linked", "email_not_verified", "access_denied",
      "state_mismatch", "invalid_state", "invalid_state_format",
      "state_integrity_check_failed", "invalid_code", "invalid_grant",
      "invalid_callback_url", "redirect_uri_mismatch", "unauthorized_client",
      "invalid_client", "invalid_request", "user_not_found",
      "please_restart_the_process", "provider_not_found", "signup_disabled",
      "unable_to_create_user", "unable_to_link_account", "unknown",
    ]);
    const parsed = rawProviderError.trim().toLowerCase();
    const code = knownProviderErrors.has(parsed) ? parsed : "other";
    // Never log provider descriptions, identities, state, auth codes or tokens.
    console.warn("google-oauth-return-error", { reason: code });
    res.setHeader("cache-control", "no-store");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("location", `${APP_ORIGIN}/login?oauth=provider_${code}`);
    return res.status(302).send("");
  }

  const verifier = first(req.query.neon_auth_session_verifier);
  if (!verifier || verifier.length > MAX_VERIFIER_LENGTH || /\s/.test(verifier)) return fail(res, "missing_verifier");

  const incomingCookies = first(req.headers.cookie) || "";
  if (!CHALLENGE_COOKIE.test(incomingCookies)) return fail(res, "missing_challenge");

  const target = new URL(`${APP_ORIGIN}/api/auth/get-session`);
  target.searchParams.set("neon_auth_session_verifier", verifier);
  const request = new Request(target.toString(), {
    method: "GET",
    headers: { cookie: incomingCookies, accept: "application/json" },
    redirect: "manual",
  });

  try {
    const response = await handleSameOriginAuthProxy(request, { APP_BASE_URL: APP_ORIGIN });
    if (!response?.ok) return fail(res, "exchange_failed");
    const cookies = response.headers.getSetCookie().map(normalizeNeonAuthCookie).filter(Boolean);
    if (!cookies.some(activeSessionCookie)) return fail(res, "session_cookie_missing");

    res.setHeader("set-cookie", cookies);
    res.setHeader("location", `${APP_ORIGIN}/app/dashboard`);
    return res.status(302).send("");
  } catch {
    return fail(res, "callback_failed");
  }
}
