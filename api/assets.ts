import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleAssetLibrary } from "../cloudflare/asset-library.js";

// Preserve the same authenticated, profile-scoped implementation as Cloudflare.
// Vercel has no /api/assets endpoint unless this adapter exists.
export const config = { maxDuration: 60 };
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function webHeaders(req: VercelRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const entry of value) headers.append(key, entry);
    else if (typeof value === "string") headers.set(key, value);
  }
  return headers;
}

async function requestBody(req: VercelRequest): Promise<Uint8Array | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  if (req.body instanceof Uint8Array) return req.body;
  const type = req.headers["content-type"] || "";
  if (!String(type).includes("multipart/form-data") && req.body !== undefined) {
    return new TextEncoder().encode(typeof req.body === "string" ? req.body : JSON.stringify(req.body));
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes: Uint8Array = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += bytes.byteLength;
    if (size > MAX_BODY_BYTES) throw new Error("ASSET_UPLOAD_TOO_LARGE");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!["GET", "POST", "DELETE"].includes(req.method || "")) {
    return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  }
  try {
    const headers = webHeaders(req);
    const path = (req.url || "/api/assets").split("#", 1)[0];
    const url = new URL(path, "https://post-automatici-canonical.vercel.app");
    const body = await requestBody(req);
    const request = new Request(url, {
      method: req.method,
      headers,
      ...(body ? { body: body as BodyInit } : {}),
    });
    const response = await handleAssetLibrary(request, { DATABASE_URL: process.env.DATABASE_URL });
    response.headers.forEach((value, name) => res.setHeader(name, value));
    return res.status(response.status).send(Buffer.from(await response.arrayBuffer()));
  } catch (reason) {
    const oversized = reason instanceof Error && reason.message === "ASSET_UPLOAD_TOO_LARGE";
    if (!oversized) console.error("vercel.assets", { code: "ASSET_LIBRARY_FAILED" });
    return res.status(oversized ? 413 : 500).json({ error: oversized ? "ASSET_FILE_SIZE_INVALID" : "ASSET_LIBRARY_FAILED" });
  }
}
