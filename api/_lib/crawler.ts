import { createHash } from "node:crypto";
import * as cheerio from "cheerio";

export type CrawlPageStatus = "ANALYZED" | "SKIPPED" | "FAILED";

export type PageSignals = {
  canonicalUrl: string | null;
  headings: string[];
  imageUrls: string[];
  ogImageUrl: string | null;
  schemaTypes: string[];
};

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
  signals: PageSignals | null;
};

export type WebsiteVisualHints = {
  colors: string[];
  fontFamilies: string[];
  socialLinks: Record<string, string>;
  logoUrl: string | null;
  logoCandidates: string[];
  imageUrls: string[];
  stylesheetUrls: string[];
  pageSignals: Array<PageSignals & { url: string }>;
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
const MAX_STYLESHEETS = 16;
const MAX_STYLE_CHARS = 200_000;
const MAX_PAGE_SIGNALS = 80;
const MAX_IMAGES = 40;

function emptyVisualHints(): WebsiteVisualHints {
  return { colors: [], fontFamilies: [], socialLinks: {}, logoUrl: null, logoCandidates: [], imageUrls: [], stylesheetUrls: [], pageSignals: [] };
}

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

function absoluteHttpUrl(value: string | undefined, base: URL) {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
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

function extractColors(source: string, counts: Map<string, number>) {
  const matches = source.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^\)]{3,80}\)|hsla?\([^\)]{3,80}\)/g) ?? [];
  for (const raw of matches) {
    const color = normalizeObservedColor(raw);
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
}

function extractFontFamilies(source: string, counts: Map<string, number>) {
  const matches = source.matchAll(/font-family\s*:\s*([^;}{]+)/gi);
  for (const match of matches) {
    for (const raw of match[1].split(",")) {
      const font = raw.trim().replace(/^['"]|['"]$/g, "").replace(/\s+/g, " ");
      if (!font || /^(serif|sans-serif|monospace|system-ui|inherit|initial)$/i.test(font)) continue;
      counts.set(font, (counts.get(font) ?? 0) + 1);
    }
  }
}

function schemaTypes($: cheerio.CheerioAPI) {
  const types = new Set<string>();
  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).html();
    if (!raw) return;
    try {
      const value = JSON.parse(raw) as unknown;
      const walk = (node: unknown) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) { for (const item of node) walk(item); return; }
        const record = node as Record<string, unknown>;
        const type = record["@type"];
        if (typeof type === "string") types.add(type);
        else if (Array.isArray(type)) for (const item of type) if (typeof item === "string") types.add(item);
        for (const child of Object.values(record)) if (child && typeof child === "object") walk(child);
      };
      walk(value);
    } catch { /* malformed JSON-LD is ignored */ }
  });
  return [...types].slice(0, 16);
}

function pageSignals(html: string, pageUrl: URL): PageSignals {
  const $ = cheerio.load(html);
  const headings = $("h1,h2,h3").map((_, element) => $(element).text().replace(/\s+/g, " ").trim()).get().filter(Boolean).slice(0, 20);
  const imageUrls = new Set<string>();
  $("img[src],img[data-src],source[srcset]").each((_, element) => {
    const raw = $(element).attr("src") || $(element).attr("data-src") || ($(element).attr("srcset") ?? "").split(",")[0]?.trim().split(/\s+/)[0];
    const absolute = absoluteHttpUrl(raw, pageUrl);
    if (absolute) imageUrls.add(absolute);
  });
  const canonicalUrl = absoluteHttpUrl($('link[rel="canonical"]').first().attr("href"), pageUrl);
  const ogImageUrl = absoluteHttpUrl($('meta[property="og:image"]').first().attr("content") || $('meta[name="twitter:image"]').first().attr("content"), pageUrl);
  if (ogImageUrl) imageUrls.add(ogImageUrl);
  return { canonicalUrl, headings, imageUrls: [...imageUrls].slice(0, 8), ogImageUrl, schemaTypes: schemaTypes($) };
}

function collectRootHints(html: string, root: URL) {
  const $ = cheerio.load(html);
  const colorCounts = new Map<string, number>();
  const fontCounts = new Map<string, number>();
  const inlineStyles = [
    $('meta[name="theme-color"]').attr("content") ?? "",
    $("style").map((_, element) => $(element).html() ?? "").get().join("\n"),
    $("[style]").map((_, element) => $(element).attr("style") ?? "").get().join("\n"),
  ].join("\n");
  extractColors(inlineStyles, colorCounts);
  extractFontFamilies(inlineStyles, fontCounts);

  const socialLinks: Record<string, string> = {};
  for (const href of $("a[href]").map((_, element) => $(element).attr("href") ?? "").get()) {
    const absoluteText = absoluteHttpUrl(href, root);
    if (!absoluteText) continue;
    const absolute = new URL(absoluteText);
    const host = absolute.hostname.toLowerCase().replace(/^www\./, "");
    if (!socialLinks.instagram && host === "instagram.com") socialLinks.instagram = absolute.toString();
    if (!socialLinks.facebook && (host === "facebook.com" || host === "fb.com")) socialLinks.facebook = absolute.toString();
    if (!socialLinks.linkedin && host === "linkedin.com") socialLinks.linkedin = absolute.toString();
    if (!socialLinks.googleBusinessProfile && (host === "g.page" || host === "business.google.com" || host === "maps.google.com" || host === "google.com" && absolute.pathname.startsWith("/maps"))) socialLinks.googleBusinessProfile = absolute.toString();
  }

  const logoCandidates = new Set<string>();
  const addLogo = (raw: string | undefined) => { const absolute = absoluteHttpUrl(raw, root); if (absolute) logoCandidates.add(absolute); };
  $("img").each((_, element) => {
    const alt = ($(element).attr("alt") ?? "").toLowerCase();
    const classes = ($(element).attr("class") ?? "").toLowerCase();
    const id = ($(element).attr("id") ?? "").toLowerCase();
    if (alt.includes("logo") || classes.includes("logo") || id.includes("logo")) addLogo($(element).attr("src") || $(element).attr("data-src"));
  });
  addLogo($('meta[property="og:logo"]').attr("content"));
  addLogo($('link[rel="apple-touch-icon"]').attr("href"));
  addLogo($('link[rel~="icon"]').attr("href"));

  const stylesheetUrls = new Set<string>();
  $('link[rel="stylesheet"][href]').each((_, element) => { const absolute = absoluteHttpUrl($(element).attr("href"), root); if (absolute) stylesheetUrls.add(absolute); });

  return { colorCounts, fontCounts, socialLinks, logoCandidates, stylesheetUrls };
}

async function enrichStylesheets(
  stylesheetUrls: string[],
  fetcher: typeof fetch,
  validateTarget: CrawlOptions["validateTarget"],
  colorCounts: Map<string, number>,
  fontCounts: Map<string, number>,
) {
  for (const href of stylesheetUrls.slice(0, MAX_STYLESHEETS)) {
    try {
      const url = new URL(href);
      await validateTarget?.(url);
      const response = await fetcher(url.toString(), { headers: { "user-agent": "PostAutomaticiBot/1.0", accept: "text/css,*/*;q=0.5" }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) continue;
      const type = (response.headers.get("content-type") ?? "").toLowerCase();
      if (type && !type.includes("text/css")) continue;
      const css = (await response.text()).slice(0, MAX_STYLE_CHARS);
      extractColors(css, colorCounts);
      extractFontFamilies(css, fontCounts);
    } catch { /* visual enrichment must never break the crawl */ }
  }
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
    for (const url of await sitemapSeeds(root, fetcher, options.validateTarget, maxPages)) if (url !== normalizedRoot) queue.push({ url, depth: 1, discoveredFrom: new URL("/sitemap.xml", root).toString() });
  }

  const known = new Set(queue.map((item) => item.url));
  const visited = new Set<string>();
  const pages: CrawlPage[] = [];
  const startedAt = Date.now();
  let stopReason: CrawlResult["stopReason"] = "COMPLETE";
  let visualHints = emptyVisualHints();
  let rootEnriched = false;

  while (queue.length) {
    if (visited.size >= maxPages) { stopReason = "PAGE_LIMIT"; break; }
    if (Date.now() - startedAt >= maxDurationMs) { stopReason = "TIME_LIMIT"; break; }
    const item = queue.shift()!;
    if (visited.has(item.url)) continue;
    visited.add(item.url);
    const url = new URL(item.url);

    const baseSkipped = { url: item.url, normalizedUrl: item.url, depth: item.depth, title: null, metaDescription: null, contentText: null, contentHash: null, discoveredFrom: item.discoveredFrom, error: null, signals: null };
    if (item.depth > maxDepth) { pages.push({ ...baseSkipped, status: "SKIPPED", skipReason: "MAX_DEPTH" }); continue; }
    if (!isRobotsAllowed(url, disallow)) { pages.push({ ...baseSkipped, status: "SKIPPED", skipReason: "ROBOTS_DISALLOW" }); continue; }

    try {
      await options.validateTarget?.(url);
      const response = await fetcher(url.toString(), { redirect: "follow", headers: { "user-agent": "PostAutomaticiBot/1.0", accept: "text/html,application/xhtml+xml;q=0.9" }, signal: AbortSignal.timeout(12_000) });
      const finalUrl = new URL(response.url || url.toString());
      if (finalUrl.origin !== root.origin) throw new Error("CROSS_ORIGIN_REDIRECT");
      await options.validateTarget?.(finalUrl);
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        pages.push({ ...baseSkipped, status: "SKIPPED", skipReason: "NON_HTML" });
        continue;
      }
      const html = await safeText(response, maxContentChars);
      const { title, description, hrefs } = pageMetadata(html);
      const signals = pageSignals(html, finalUrl);
      const contentText = plainText(html).slice(0, maxContentChars);
      pages.push({ url: finalUrl.toString(), normalizedUrl: item.url, status: "ANALYZED", depth: item.depth, title, metaDescription: description, contentText, contentHash: createHash("sha256").update(contentText).digest("hex"), discoveredFrom: item.discoveredFrom, skipReason: null, error: null, signals });

      if (visualHints.pageSignals.length < MAX_PAGE_SIGNALS) visualHints.pageSignals.push({ url: finalUrl.toString(), ...signals });
      for (const imageUrl of signals.imageUrls) if (visualHints.imageUrls.length < MAX_IMAGES && !visualHints.imageUrls.includes(imageUrl)) visualHints.imageUrls.push(imageUrl);

      if (item.depth === 0 && !rootEnriched) {
        const rootHints = collectRootHints(html, finalUrl);
        await enrichStylesheets([...rootHints.stylesheetUrls], fetcher, options.validateTarget, rootHints.colorCounts, rootHints.fontCounts);
        visualHints = {
          ...visualHints,
          colors: [...rootHints.colorCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([color]) => color),
          fontFamilies: [...rootHints.fontCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([font]) => font),
          socialLinks: rootHints.socialLinks,
          logoCandidates: [...rootHints.logoCandidates].slice(0, 8),
          logoUrl: [...rootHints.logoCandidates][0] ?? null,
          stylesheetUrls: [...rootHints.stylesheetUrls].slice(0, MAX_STYLESHEETS),
        };
        rootEnriched = true;
      }

      if (item.depth < maxDepth) {
        for (const href of hrefs) {
          const normalized = normalizeCrawlUrl(href, root);
          if (!normalized || known.has(normalized)) continue;
          known.add(normalized);
          queue.push({ url: normalized, depth: item.depth + 1, discoveredFrom: item.url });
        }
      }
    } catch (reason) {
      pages.push({ ...baseSkipped, status: "FAILED", skipReason: null, error: reason instanceof Error ? reason.message : "UNKNOWN_ERROR" });
    }
  }

  const analyzedPages = pages.filter((page) => page.status === "ANALYZED").length;
  const skippedPages = pages.filter((page) => page.status === "SKIPPED").length;
  const failedPages = pages.filter((page) => page.status === "FAILED").length;
  return { rootUrl: normalizedRoot, discoveredPages: known.size, analyzedPages, skippedPages, failedPages, completeCoverage: stopReason === "COMPLETE" && queue.length === 0, stopReason, pages, visualHints };
}
