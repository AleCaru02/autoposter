import { createHash } from "node:crypto";
import * as cheerio from "cheerio";

export type CrawlPageStatus = "ANALYZED" | "SKIPPED" | "FAILED";

export type CrawlPage = {
  url: string;
  normalizedUrl: string;
  status: CrawlPageStatus;
  depth: number;
  title: string | null;
  metaDescription: string | null;
  contentText: string | null;
  contentHash: string | null;
  discoveredFrom: string | null;
  skipReason: string | null;
  error: string | null;
};

export type WebsiteVisualHints = {
  colors: string[];
  socialLinks: Record<string, string>;
  logoUrl: string | null;
};

export type CrawlResult = {
  rootUrl: string;
  discoveredPages: number;
  analyzedPages: number;
  skippedPages: number;
  failedPages: number;
  completeCoverage: boolean;
  stopReason: "COMPLETE" | "PAGE_LIMIT" | "TIME_LIMIT";
  pages: CrawlPage[];
  visualHints: WebsiteVisualHints;
};

type QueueItem = { url: string; depth: number; discoveredFrom: string | null };

type CrawlOptions = {
  fetcher?: typeof fetch;
  validateTarget?: (url: URL) => Promise<void> | void;
  maxPages?: number;
  maxDepth?: number;
  maxDurationMs?: number;
  maxContentChars?: number;
  includeSitemap?: boolean;
};

const TRACKING_PARAMS = new Set(["fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid"]);
const NON_HTML_EXTENSIONS = /\.(?:avif|bmp|css|csv|docx?|eot|gif|ico|jpe?g|js|json|map|mp3|mp4|mov|ogg|otf|pdf|png|pptx?|rar|rss|svg|tar|tiff?|ttf|txt|wav|webm|webp|woff2?|xlsx?|xml|zip)$/i;

export function normalizeCrawlUrl(input: string, root: URL): string | null {
  let url: URL;
  try { url = new URL(input, root); } catch { return null; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin !== root.origin) return null;
  if (url.username || url.password) return null;
  if (NON_HTML_EXTENSIONS.test(url.pathname)) return null;
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname !== "/" && url.pathname.endsWith("/")) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function plainText(html: string) {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg,template").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

function pageMetadata(html: string) {
  const $ = cheerio.load(html);
  const title = $("title").first().text().replace(/\s+/g, " ").trim() || null;
  const description = $('meta[name="description"]').attr("content")?.replace(/\s+/g, " ").trim() || null;
  const hrefs = $("a[href]").map((_, element) => $(element).attr("href") ?? "").get().filter(Boolean);
  return { title, description, hrefs };
}

function normalizeObservedColor(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function rootVisualHints(html: string, root: URL): WebsiteVisualHints {
  const $ = cheerio.load(html);
  const counts = new Map<string, number>();
  const colorSources = [
    $('meta[name="theme-color"]').attr("content") ?? "",
    $("style").map((_, element) => $(element).html() ?? "").get().join("\n"),
    $("[style]").map((_, element) => $(element).attr("style") ?? "").get().join("\n"),
  ].join("\n");
  const matches = colorSources.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^\)]{3,80}\)|hsla?\([^\)]{3,80}\)/g) ?? [];
  for (const raw of matches) {
    const color = normalizeObservedColor(raw);
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  const colors = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([color]) => color);

  const socialLinks: Record<string, string> = {};
  for (const href of $("a[href]").map((_, element) => $(element).attr("href") ?? "").get()) {
    if (!href) continue;
    let absolute: URL;
    try { absolute = new URL(href, root); } catch { continue; }
    const host = absolute.hostname.toLowerCase().replace(/^www\./, "");
    if (!socialLinks.instagram && host === "instagram.com") socialLinks.instagram = absolute.toString();
    if (!socialLinks.facebook && (host === "facebook.com" || host === "fb.com")) socialLinks.facebook = absolute.toString();
    if (!socialLinks.linkedin && host === "linkedin.com") socialLinks.linkedin = absolute.toString();
    if (!socialLinks.googleBusinessProfile && (host === "g.page" || host === "business.google.com" || host === "maps.google.com" || host === "google.com" && absolute.pathname.startsWith("/maps"))) socialLinks.googleBusinessProfile = absolute.toString();
  }

  const logoCandidate = $('img[alt*="logo" i]').first().attr("src") || $('link[rel="apple-touch-icon"]').first().attr("href") || $('link[rel="icon"]').first().attr("href") || null;
  let logoUrl: string | null = null;
  if (logoCandidate) {
    try { logoUrl = new URL(logoCandidate, root).toString(); } catch { logoUrl = null; }
  }
  return { colors, socialLinks, logoUrl };
}

function parseRobots(text: string) {
  const disallow: string[] = [];
  let applies = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") applies = value === "*" || value.toLowerCase() === "postautomaticibot";
    else if (key === "disallow" && applies && value) disallow.push(value);
  }
  return disallow;
}

function isRobotsAllowed(url: URL, disallow: string[]) {
  return !disallow.some((rule) => rule === "/" || (rule.endsWith("$") ? url.pathname === rule.slice(0, -1) : url.pathname.startsWith(rule)));
}

async function safeText(response: Response, maxChars: number) {
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > maxChars * 4) throw new Error("PAGE_TOO_LARGE");
  const text = await response.text();
  return text.length > maxChars * 4 ? text.slice(0, maxChars * 4) : text;
}

async function fetchOptionalText(url: URL, fetcher: typeof fetch, validateTarget: CrawlOptions["validateTarget"], maxChars: number) {
  try {
    await validateTarget?.(url);
    const response = await fetcher(url.toString(), { headers: { "user-agent": "PostAutomaticiBot/1.0", accept: "text/plain,application/xml,text/xml;q=0.9,*/*;q=0.5" }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    return await safeText(response, maxChars);
  } catch { return null; }
}

async function sitemapSeeds(root: URL, fetcher: typeof fetch, validateTarget: CrawlOptions["validateTarget"], maxPages: number) {
  const result = new Set<string>();
  const seenSitemaps = new Set<string>();
  const queue = [new URL("/sitemap.xml", root).toString()];
  while (queue.length && seenSitemaps.size < 12 && result.size < maxPages) {
    const sitemapUrl = queue.shift()!;
    if (seenSitemaps.has(sitemapUrl)) continue;
    seenSitemaps.add(sitemapUrl);
    const text = await fetchOptionalText(new URL(sitemapUrl), fetcher, validateTarget, 500_000);
    if (!text) continue;
    const $ = cheerio.load(text, { xmlMode: true });
    const locs = $("loc").map((_, element) => $(element).text().trim()).get();
    const isIndex = $("sitemapindex").length > 0;
    for (const loc of locs) {
      if (isIndex && queue.length < 12) {
        try { if (new URL(loc, root).origin === root.origin) queue.push(new URL(loc, root).toString()); } catch { /* invalid sitemap URL */ }
        continue;
      }
      const normalized = normalizeCrawlUrl(loc, root);
      if (normalized) result.add(normalized);
      if (result.size >= maxPages) break;
    }
  }
  return [...result];
}

export async function crawlWebsite(input: string, options: CrawlOptions = {}): Promise<CrawlResult> {
  const fetcher = options.fetcher ?? fetch;
  const maxPages = Math.min(Math.max(options.maxPages ?? 500, 1), 2_000);
  const maxDepth = Math.min(Math.max(options.maxDepth ?? 12, 0), 30);
  const maxDurationMs = Math.min(Math.max(options.maxDurationMs ?? 45_000, 1_000), 120_000);
  const maxContentChars = Math.min(Math.max(options.maxContentChars ?? 180_000, 10_000), 500_000);
  const root = new URL(input);
  if (root.protocol !== "http:" && root.protocol !== "https:") throw new Error("INVALID_ROOT_PROTOCOL");
  root.hash = "";
  await options.validateTarget?.(root);
  const normalizedRoot = normalizeCrawlUrl(root.toString(), root);
  if (!normalizedRoot) throw new Error("INVALID_ROOT_URL");

  const robotsText = await fetchOptionalText(new URL("/robots.txt", root), fetcher, options.validateTarget, 100_000);
  const disallow = robotsText ? parseRobots(robotsText) : [];
  const queue: QueueItem[] = [{ url: normalizedRoot, depth: 0, discoveredFrom: null }];
  if (options.includeSitemap !== false) {
    for (const url of await sitemapSeeds(root, fetcher, options.validateTarget, maxPages)) {
      if (url !== normalizedRoot) queue.push({ url, depth: 1, discoveredFrom: new URL("/sitemap.xml", root).toString() });
    }
  }

  const known = new Set(queue.map((item) => item.url));
  const visited = new Set<string>();
  const pages: CrawlPage[] = [];
  const startedAt = Date.now();
  let stopReason: CrawlResult["stopReason"] = "COMPLETE";
  let visualHints: WebsiteVisualHints = { colors: [], socialLinks: {}, logoUrl: null };

  while (queue.length) {
    if (visited.size >= maxPages) { stopReason = "PAGE_LIMIT"; break; }
    if (Date.now() - startedAt >= maxDurationMs) { stopReason = "TIME_LIMIT"; break; }
    const item = queue.shift()!;
    if (visited.has(item.url)) continue;
    visited.add(item.url);
    const url = new URL(item.url);

    if (item.depth > maxDepth) {
      pages.push({ url: item.url, normalizedUrl: item.url, status: "SKIPPED", depth: item.depth, title: null, metaDescription: null, contentText: null, contentHash: null, discoveredFrom: item.discoveredFrom, skipReason: "MAX_DEPTH", error: null });
      continue;
    }
    if (!isRobotsAllowed(url, disallow)) {
      pages.push({ url: item.url, normalizedUrl: item.url, status: "SKIPPED", depth: item.depth, title: null, metaDescription: null, contentText: null, contentHash: null, discoveredFrom: item.discoveredFrom, skipReason: "ROBOTS_DISALLOW", error: null });
      continue;
    }

    try {
      await options.validateTarget?.(url);
      const response = await fetcher(url.toString(), { redirect: "follow", headers: { "user-agent": "PostAutomaticiBot/1.0", accept: "text/html,application/xhtml+xml;q=0.9" }, signal: AbortSignal.timeout(12_000) });
      const finalUrl = new URL(response.url || url.toString());
      if (finalUrl.origin !== root.origin) throw new Error("CROSS_ORIGIN_REDIRECT");
      await options.validateTarget?.(finalUrl);
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        pages.push({ url: item.url, normalizedUrl: item.url, status: "SKIPPED", depth: item.depth, title: null, metaDescription: null, contentText: null, contentHash: null, discoveredFrom: item.discoveredFrom, skipReason: "NON_HTML", error: null });
        continue;
      }
      const html = await safeText(response, maxContentChars);
      const { title, description, hrefs } = pageMetadata(html);
      if (item.depth === 0) visualHints = rootVisualHints(html, finalUrl);
      const contentText = plainText(html).slice(0, maxContentChars);
      pages.push({ url: finalUrl.toString(), normalizedUrl: item.url, status: "ANALYZED", depth: item.depth, title, metaDescription: description, contentText, contentHash: createHash("sha256").update(contentText).digest("hex"), discoveredFrom: item.discoveredFrom, skipReason: null, error: null });
      if (item.depth < maxDepth) {
        for (const href of hrefs) {
          const normalized = normalizeCrawlUrl(href, root);
          if (!normalized || known.has(normalized)) continue;
          known.add(normalized);
          queue.push({ url: normalized, depth: item.depth + 1, discoveredFrom: item.url });
        }
      }
    } catch (reason) {
      pages.push({ url: item.url, normalizedUrl: item.url, status: "FAILED", depth: item.depth, title: null, metaDescription: null, contentText: null, contentHash: null, discoveredFrom: item.discoveredFrom, skipReason: null, error: reason instanceof Error ? reason.message : "UNKNOWN_ERROR" });
    }
  }

  const analyzedPages = pages.filter((page) => page.status === "ANALYZED").length;
  const skippedPages = pages.filter((page) => page.status === "SKIPPED").length;
  const failedPages = pages.filter((page) => page.status === "FAILED").length;
  return { rootUrl: normalizedRoot, discoveredPages: known.size, analyzedPages, skippedPages, failedPages, completeCoverage: stopReason === "COMPLETE" && queue.length === 0, stopReason, pages, visualHints };
}
