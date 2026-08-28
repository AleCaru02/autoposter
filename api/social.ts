import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleSocialApi, type SocialEnv } from "./_lib/social.js";

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function socialPath(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value.join("/") : value || "";
  const normalized = raw.split("/").filter(Boolean).join("/");
  return normalized ? `/api/social/${normalized}` : "/api/social";
}

function requestHeaders(req: VercelRequest) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (typeof value === "string") headers.set(name, value);
  }
  return headers;
}

function requestBody(req: VercelRequest) {
  if (req.method === "GET" || req.method === "HEAD" || req.body === undefined || req.body === null) return undefined;
  if (typeof req.body === "string" || req.body instanceof Uint8Array) return req.body;
  return JSON.stringify(req.body);
}

function webRequest(req: VercelRequest) {
  const forwardedHost = firstHeader(req.headers["x-forwarded-host"]);
  const host = forwardedHost || firstHeader(req.headers.host) || "localhost";
  const forwardedProto = firstHeader(req.headers["x-forwarded-proto"]);
  const protocol = forwardedProto || (host.includes("localhost") ? "http" : "https");
  const url = new URL(req.url || "/api/social", `${protocol}://${host}`);
  url.pathname = socialPath(req.query.path);
  url.searchParams.delete("path");
  return new Request(url, {
    method: req.method || "GET",
    headers: requestHeaders(req),
    body: requestBody(req),
  });
}

function socialEnv(): SocialEnv {
  return {
    DATABASE_URL: process.env.DATABASE_URL,
    APP_BASE_URL: process.env.APP_BASE_URL,
    SOCIAL_TOKEN_KEY: process.env.SOCIAL_TOKEN_KEY,
    META_APP_ID: process.env.META_APP_ID,
    META_APP_SECRET: process.env.META_APP_SECRET,
    META_GRAPH_VERSION: process.env.META_GRAPH_VERSION,
    LINKEDIN_CLIENT_ID: process.env.LINKEDIN_CLIENT_ID,
    LINKEDIN_CLIENT_SECRET: process.env.LINKEDIN_CLIENT_SECRET,
    LINKEDIN_API_VERSION: process.env.LINKEDIN_API_VERSION,
    LINKEDIN_ORGANIZATION_ACCESS: process.env.LINKEDIN_ORGANIZATION_ACCESS,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const response = await handleSocialApi(webRequest(req), socialEnv());
    if (!response) return res.status(404).json({ error: "SOCIAL_ROUTE_NOT_FOUND" });

    response.headers.forEach((value, name) => res.setHeader(name, value));
    const payload = Buffer.from(await response.arrayBuffer());
    return res.status(response.status).send(payload);
  } catch (reason) {
    console.error("vercel.social", reason);
    return res.status(500).json({ error: "SOCIAL_API_FAILED" });
  }
}
