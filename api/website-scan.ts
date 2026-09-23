import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { crawlWebsite } from "./_lib/crawler.js";
import { boundedScanPageLimit, SAFE_SCAN_MAX_SITEMAPS, SAFE_SCAN_MAX_STYLESHEETS, SAFE_SCAN_MAX_SITEMAP_SEEDS, SAFE_SCAN_MAX_TOTAL_PAGES } from "./_lib/website-scan-policy.js";

export const config = { maxDuration: 60 };

const DATA_API = "https://ep-divine-band-arrkz7vq.apirest.c-4.us-west-2.aws.neon.tech/neondb/rest/v1";

type ProfileRow = { id: string; website_url: string | null };
type ScanRow = { id: string; state?: string; discovered_pages?: number; analyzed_pages?: number; skipped_pages?: number; failed_pages?: number; root_url?: string; error?: string | null };
type ScanPageStateRow = { url: string; normalized_url: string; status: "DISCOVERED" | "ANALYZED" | "SKIPPED" | "FAILED"; depth: number; discovered_from: string | null };

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

async function readScanPages(scanId: string, profileId: string, token: string) {
  const response = await dataApi(
    `website_pages?scan_id=eq.${encodeURIComponent(scanId)}&profile_id=eq.${encodeURIComponent(profileId)}&select=url,normalized_url,status,depth,discovered_from&order=created_at.asc&limit=${SAFE_SCAN_MAX_TOTAL_PAGES}`,
    token,
  );
  if (!response.ok) throw new Error(`DATA_API_SCAN_PAGES_${response.status}`);
  return response.json() as Promise<ScanPageStateRow[]>;
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
      scanned_at: page.status === "DISCOVERED" ? null : new Date().toISOString(),
    }));
    const response = await dataApi(
      "website_pages?on_conflict=scan_id,normalized_url",
      token,
      { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(chunk) },
    );
    if (!response.ok) throw new Error(`DATA_API_WRITE_PAGES_${response.status}`);
  }
}

async function updateScan(scanId: string, payload: Record<string, unknown>, token: string) {
  const response = await dataApi(`website_scans?id=eq.${encodeURIComponent(scanId)}`, token, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`DATA_API_FINISH_SCAN_${response.status}`);
}

async function failScan(scanId: string, token: string, error: string) {
  await dataApi(`website_scans?id=eq.${encodeURIComponent(scanId)}`, token, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ state: "FAILED", finished_at: new Date().toISOString(), last_progress_at: new Date().toISOString(), error: error.slice(0, 500) }),
  }).catch(() => undefined);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: "AUTH_REQUIRED" });
  const profileId = typeof req.body?.profileId === "string" ? req.body.profileId : "";
  const pageLimit = boundedScanPageLimit(req.body?.pageLimit);
  const forceNew = req.body?.forceNew === true;
  if (!profileId) return res.status(400).json({ error: "PROFILE_REQUIRED" });

  let scanId: string | null = null;
  try {
    const profile = await readOwnedProfile(profileId, token);
    if (!profile) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });
    if (!profile.website_url) return res.status(409).json({ error: "WEBSITE_NOT_CONFIGURED" });
    const root = new URL(profile.website_url);
    if (root.protocol !== "http:" && root.protocol !== "https:") return res.status(400).json({ error: "INVALID_WEBSITE" });
    await assertPublicTarget(root);
    const rootUrl = root.toString();

    let existingScan: ScanRow | null = null;
    if (!forceNew) {
      const reusableResponse = await dataApi(
        `website_scans?profile_id=eq.${encodeURIComponent(profileId)}&root_url=eq.${encodeURIComponent(rootUrl)}&state=in.(COMPLETE,COMPLETE_WITH_WARNINGS,PARTIAL,RUNNING)&select=id,state,root_url,discovered_pages,analyzed_pages,skipped_pages,failed_pages,error&order=created_at.desc&limit=1`,
        token,
      );
      if (!reusableResponse.ok) throw new Error(`DATA_API_REUSABLE_SCAN_${reusableResponse.status}`);
      existingScan = ((await reusableResponse.json()) as ScanRow[])[0] ?? null;
      if (existingScan?.state === "COMPLETE" || existingScan?.state === "COMPLETE_WITH_WARNINGS") {
        return res.status(200).json({
          scanId: existingScan.id,
          state: existingScan.state,
          discoveredPages: existingScan.discovered_pages ?? 0,
          analyzedPages: existingScan.analyzed_pages ?? 0,
          skippedPages: existingScan.skipped_pages ?? 0,
          failedPages: existingScan.failed_pages ?? 0,
          completeCoverage: existingScan.state === "COMPLETE",
          hasMore: false,
          reused: true,
        });
      }
    }

    scanId = existingScan?.id ?? await createScan(profileId, rootUrl, pageLimit, token);
    const storedPages = await readScanPages(scanId, profileId, token);
    const terminal = storedPages.filter((page) => page.status !== "DISCOVERED");
    const pending = storedPages.filter((page) => page.status === "DISCOVERED");
    const excludeUrls = terminal.map((page) => page.normalized_url);
    const rootNormalized = new URL(rootUrl).toString();
    if (!pending.length && terminal.length > 0) {
      const rootIndex = excludeUrls.indexOf(rootNormalized);
      if (rootIndex >= 0) excludeUrls.splice(rootIndex, 1);
    }

    const result = await crawlWebsite(rootUrl, {
      maxPages: pageLimit,
      maxDepth: 12,
      maxDurationMs: 48_000,
      validateTarget: assertPublicTarget,
      includeSitemap: true,
      maxSitemapFiles: SAFE_SCAN_MAX_SITEMAPS,
      maxStylesheets: SAFE_SCAN_MAX_STYLESHEETS,
      maxSitemapSeeds: SAFE_SCAN_MAX_SITEMAP_SEEDS,
      maxDiscoveredPages: SAFE_SCAN_MAX_TOTAL_PAGES,
      excludeUrls,
      seedUrls: pending.map((page) => ({ url: page.normalized_url, depth: page.depth, discoveredFrom: page.discovered_from })),
    });

    await writePages(scanId, profileId, result.pages, token);

    const totals = new Map<string, ScanPageStateRow>();
    for (const page of storedPages) totals.set(page.normalized_url, page);
    for (const page of result.pages) {
      totals.set(page.normalizedUrl, {
        url: page.url,
        normalized_url: page.normalizedUrl,
        status: page.status,
        depth: page.depth,
        discovered_from: page.discoveredFrom,
      });
    }
    const all = [...totals.values()];
    const discoveredPages = all.length;
    const analyzedPages = all.filter((page) => page.status === "ANALYZED").length;
    const skippedPages = all.filter((page) => page.status === "SKIPPED").length;
    const failedPages = all.filter((page) => page.status === "FAILED").length;
    const pendingPages = all.filter((page) => page.status === "DISCOVERED").length;
    const hasMore = pendingPages > 0;
    const state = hasMore ? "PARTIAL" : failedPages > 0 ? "COMPLETE_WITH_WARNINGS" : "COMPLETE";
    const now = new Date().toISOString();
    await updateScan(scanId, {
      state,
      discovered_pages: discoveredPages,
      analyzed_pages: analyzedPages,
      skipped_pages: skippedPages,
      failed_pages: failedPages,
      finished_at: hasMore ? null : now,
      last_progress_at: now,
      error: hasMore ? "BATCH_PENDING" : failedPages > 0 ? "PAGE_ERRORS" : null,
    }, token);

    return res.status(200).json({
      scanId,
      state,
      discoveredPages,
      analyzedPages,
      skippedPages,
      failedPages,
      pendingPages,
      completeCoverage: !hasMore,
      hasMore,
      stopReason: hasMore ? result.stopReason : "COMPLETE",
      visualHints: result.visualHints,
    });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : "UNKNOWN_SCAN_ERROR";
    if (scanId) await failScan(scanId, token, message);
    console.error("website-scan", { profileId, scanId, message });
    return res.status(500).json({ error: "SCAN_FAILED", message: "Non riesco a completare l'analisi del sito in questo momento. Riprova tra poco." });
  }
}
