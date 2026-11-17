import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleContentQa } from "../cloudflare/content-qa.js";

// The same authenticated profile-scoped QA handler as Cloudflare, deployed
// natively on Vercel. No cross-origin Worker proxy or duplicate AI pipeline.
export const config = { maxDuration: 300 };
const MAX_JSON_BYTES = 64 * 1024;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ") || !authorization.slice(7).trim()) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return res.status(400).json({ error: "INVALID_JSON" });
  }
  const json = JSON.stringify(req.body);
  if (Buffer.byteLength(json, "utf8") > MAX_JSON_BYTES) {
    return res.status(413).json({ error: "CONTENT_QA_INPUT_TOO_LARGE" });
  }
  try {
    const webRequest = new Request("https://post-automatici-canonical.vercel.app/api/content-qa", {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: json,
    });
    const result = await handleContentQa(webRequest, {
      DATABASE_URL: process.env.DATABASE_URL,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    });
    res.setHeader("content-type", "application/json; charset=utf-8");
    return res.status(result.status).send(await result.text());
  } catch (error) {
    console.error("vercel.content-qa", {
      code: error instanceof Error ? error.message.split(":")[0] : "CONTENT_QA_FAILED",
    });
    return res.status(500).json({ error: "CONTENT_QA_FAILED" });
  }
}
