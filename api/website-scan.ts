import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { crawlWebsite } from "./_lib/crawler.js";

export const config = { maxDuration: 60 };

const DATA_API = "https://ep-nameless-truth-a698bwer.apirest.us-west-2.aws.neon.tech/neondb/rest/v1";

type ProfileRow = { id: string; website_url: string | null };
type ScanRow = { id: string };

function privateIp(address: string) {
  if (address === "::1" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) return true;
  const ipv4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ipv4)) return false;
  const [a, b] = ipv4.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

async function assertPublicTarget(url: URL) {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) throw new Error("PRIVATE_TARGET");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("UNSAFE_PORT");
  if (isIP(hostname)) {
    if (privateIp(hostname)) throw new Error("PRIVATE_TARGET");
    return;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => privateIp(address))) throw new Error("PRIVATE_TARGET");
}

function bearer(req: VercelRequest) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

async function dataApi(path: string, token: string, init: RequestInit = {}) {
  return fetch(`${DATA_API}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
}

async function readOwnedProfile(profileId: string, token: string) {
  const response = await dataApi(`profiles?id=eq.${encodeURIComponent(profileId)}&select=id,website_url&limit=1`, token);
  if (!response.ok) throw new Error(`DATA_API_PROFILE_${response.status}`);
  const rows = await response.json() as ProfileRow[];
  return rows[0] ?? null;
}

async function createScan(profileId: string, rootUrl: string, pageLimit: number, token: string) {
  const response = await dataApi("website_scans", token, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ profile_id: profileId, root_url: rootUrl, state: "RUNNING", page_limit: pageLimit, max_depth: 12, started_at: new Date().toISOString(), last_progress_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`DATA_API_CREATE_SCAN_${response.status}`);
  const rows = await response.json() as ScanRow[];
  if (!rows[0]?.id) throw new Error("SCAN_ID_MISSING");
  return rows[0].id;
}

async function writePages(scanId: string, profileId: string, pages: Awaited<ReturnType<typeof crawlWebsite>>["pages"], token: string) {
  for (let index = 0; index < pages.length; index += 25) {
    const chunk = pages.slice(index, index + 25).map((page) => ({
      scan_id: scanId,
      profile_id: profileId,
      url: page.url,
      normalized_url: page.normalizedUrl,
      status: page.status,
      depth: page.depth,
      title: page.title,
      meta_description: page.metaDescription,
      content_text: page.contentText,
      content_hash: page.contentHash,
      discovered_from: page.discoveredFrom,
      skip_reason: page.skipReason,
      error: page.error,
      scanned_at: new Date().toISOString(),
    }));
    const response = await dataApi("website_pages", token, { method: "POST", headers: { prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(chunk) });
    if (!response.ok) throw new Error(`DATA_API_WRITE_PAGES_${response.status}`);
  }
}

async function finishScan(scanId: string, result: Awaited<ReturnType<typeof crawlWebsite>>, token: string) {
  const state = result.completeCoverage && result.failedPages === 0 ? "COMPLETE" : "PARTIAL";
  const response = await dataApi(`website_scans?id=eq.${encodeURIComponent(scanId)}`, token, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ state, discovered_pages: result.discoveredPages, analyzed_pages: result.analyzedPages, skipped_pages: result.skippedPages, failed_pages: result.failedPages, finished_at: new Date().toISOString(), last_progress_at: new Date().toISOString(), error: result.stopReason === "COMPLETE" ? null : result.stopReason }),
  });
  if (!response.ok) throw new Error(`DATA_API_FINISH_SCAN_${response.status}`);
  return state;
}

async function failScan(scanId: string, token: string, error: string) {
  await dataApi(`website_scans?id=eq.${encodeURIComponent(scanId)}`, token, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ state: "FAILED", finished_at: new Date().toISOString(), error: error.slice(0, 500) }) }).catch(() => undefined);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: "AUTH_REQUIRED" });
  const profileId = typeof req.body?.profileId === "string" ? req.body.profileId : "";
  const requestedLimit = Number(req.body?.pageLimit ?? 500);
  const pageLimit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 2_000) : 500;
  if (!profileId) return res.status(400).json({ error: "PROFILE_REQUIRED" });

  let scanId: string | null = null;
  try {
    const profile = await readOwnedProfile(profileId, token);
    if (!profile) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });
    if (!profile.website_url) return res.status(409).json({ error: "WEBSITE_NOT_CONFIGURED" });
    const root = new URL(profile.website_url);
    if (root.protocol !== "http:" && root.protocol !== "https:") return res.status(400).json({ error: "INVALID_WEBSITE" });
    await assertPublicTarget(root);
    scanId = await createScan(profileId, root.toString(), pageLimit, token);
    const result = await crawlWebsite(root.toString(), { maxPages: pageLimit, maxDepth: 12, maxDurationMs: 48_000, validateTarget: assertPublicTarget, includeSitemap: true });
    await writePages(scanId, profileId, result.pages, token);
    const state = await finishScan(scanId, result, token);
    return res.status(200).json({ scanId, state, discoveredPages: result.discoveredPages, analyzedPages: result.analyzedPages, skippedPages: result.skippedPages, failedPages: result.failedPages, completeCoverage: result.completeCoverage, stopReason: result.stopReason, visualHints: result.visualHints });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "UNKNOWN_SCAN_ERROR";
    if (scanId) await failScan(scanId, token, message);
    console.error("website-scan", { profileId, scanId, message });
    return res.status(500).json({ error: "SCAN_FAILED", detail: message });
  }
}
