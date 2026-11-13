/**
 * Neon Data API / Neon Auth endpoints.
 * Production always uses the canonical branch (auth-recovery-v2). Only a Vercel *preview*
 * deployment may point to an isolated QA branch, and only with URLs shaped like a Neon
 * endpoint of this project's region. Anything else silently falls back to production values,
 * so a misconfigured env var can never redirect production traffic.
 */
export const PRODUCTION_NEON_DATA_API_URL = "https://ep-divine-band-arrkz7vq.apirest.c-4.us-west-2.aws.neon.tech/neondb/rest/v1";
export const PRODUCTION_NEON_AUTH_URL = "https://ep-divine-band-arrkz7vq.neonauth.c-4.us-west-2.aws.neon.tech/neondb/auth";

const DATA_API_SHAPE = /^https:\/\/ep-[a-z0-9-]{3,60}\.apirest\.c-4\.us-west-2\.aws\.neon\.tech\/neondb\/rest\/v1$/;
const AUTH_SHAPE = /^https:\/\/ep-[a-z0-9-]{3,60}\.neonauth\.c-4\.us-west-2\.aws\.neon\.tech\/neondb\/auth$/;

type EndpointEnv = { VERCEL_ENV?: string; NEON_DATA_API_URL?: string; NEON_AUTH_URL?: string };

function runtimeEnv(): EndpointEnv {
  return typeof process !== "undefined" && process.env ? process.env as EndpointEnv : {};
}

export function neonDataApiUrl(env: EndpointEnv = runtimeEnv()) {
  const candidate = env.NEON_DATA_API_URL?.trim() ?? "";
  return env.VERCEL_ENV === "preview" && DATA_API_SHAPE.test(candidate) ? candidate : PRODUCTION_NEON_DATA_API_URL;
}

export function neonAuthUrl(env: EndpointEnv = runtimeEnv()) {
  const candidate = env.NEON_AUTH_URL?.trim() ?? "";
  return env.VERCEL_ENV === "preview" && AUTH_SHAPE.test(candidate) ? candidate : PRODUCTION_NEON_AUTH_URL;
}

export function isIsolatedPreview(env: EndpointEnv = runtimeEnv()) {
  return neonDataApiUrl(env) !== PRODUCTION_NEON_DATA_API_URL && neonAuthUrl(env) !== PRODUCTION_NEON_AUTH_URL;
}
