import assert from "node:assert/strict";
import { crawlWebsite, parseWebsitePage } from "../api/_lib/crawler.js";
import { boundedScanPageLimit, CLOUDFLARE_FREE_SUBREQUEST_LIMIT, estimatedScanSubrequests, SAFE_SCAN_MAX_PAGES } from "../api/_lib/website-scan-policy.js";
import { runFullWebsiteScan, websiteScanProgress } from "../src/lib/full-website-scan.js";

const html = (title: string, body: string, head = "") => `<!doctype html><html><head><title>${title}</title><meta name="description" content="Descrizione ${title}">${head}</head><body>${body}</body></html>`;

const fixtures = new Map<string, { type: string; body: string; status?: number }>([
  ["https://example.test/robots.txt", { type: "text/plain", body: "User-agent: *\nDisallow: /private" }],
  ["https://example.test/sitemap.xml", { type: "application/xml", body: "<?xml version=\"1.0\"?><urlset><url><loc>https://example.test/faq</loc></url></urlset>" }],
  ["https://example.test/assets/site.css", { type: "text/css", body: ":root{--brand:#123456} body{font-family:'Inter',sans-serif;color:#123456;background:hsl(var(--background));border-color:#0000}.cta{background:rgb(12, 34, 56);color:hsl(var(--foreground))}" }],
  ["https://example.test/", { type: "text/html", body: html("Home", '<header><img class="site-logo" src="/assets/logo.svg" alt="Logo Example"></header><h1>Property management Milano</h1><h2>Gestione completa</h2><img src="/images/hero.webp"><a href="/servizi">Servizi</a><a href="/chi-siamo?utm_source=test">Chi siamo</a><a href="/private">Privata</a><a href="https://external.test/page">Fuori</a><a href="/brochure.pdf">PDF</a><a href="https://instagram.com/example">Instagram</a>', '<link rel="stylesheet" href="/assets/site.css"><link rel="canonical" href="https://example.test/"><meta property="og:image" content="/images/og-home.jpg"><script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness"}</script>') }],
  ["https://example.test/servizi", { type: "text/html", body: html("Servizi", '<h1>Servizi per proprietari</h1><img src="/images/service.jpg"><a href="/contatti">Contatti</a><a href="/#top">Home</a>', '<link rel="canonical" href="https://example.test/servizi"><script type="application/ld+json">{"@type":"Service"}</script>') }],
  ["https://example.test/chi-siamo", { type: "text/html", body: html("Chi siamo", "<h1>La nostra azienda</h1>") }],
  ["https://example.test/contatti", { type: "text/html", body: html("Contatti", "<h1>Scrivici</h1>") }],
  ["https://example.test/faq", { type: "text/html", body: html("FAQ", "<h1>Domande frequenti</h1>") }],
  ["https://example.test/private", { type: "text/html", body: html("Privata", "Non deve essere richiesta") }],
]);

const homeFixture = fixtures.get("https://example.test/")!;
const parsedHome = parseWebsitePage(homeFixture.body, new URL("https://example.test/"), true);
assert.equal(parsedHome.title, "Home", "single-parse metadata title must remain unchanged");
assert.equal(parsedHome.description, "Descrizione Home", "single-parse metadata description must remain unchanged");
assert.equal(parsedHome.signals.canonicalUrl, "https://example.test/", "single-parse canonical must remain unchanged");
assert.deepEqual(parsedHome.signals.headings, ["Property management Milano", "Gestione completa"], "single-parse headings must remain unchanged");
assert.deepEqual(parsedHome.signals.schemaTypes, ["LocalBusiness"], "single-parse structured-data signals must remain unchanged");
assert.ok(parsedHome.hrefs.includes("/servizi"), "single-parse link extraction must remain unchanged");
assert.ok(parsedHome.contentText.includes("Property management Milano"), "single-parse visible text must remain unchanged");
assert.equal(parsedHome.contentText.includes("LocalBusiness"), false, "JSON-LD must not leak into visible page text");
assert.equal(parsedHome.rootHints?.socialLinks.instagram, "https://instagram.com/example", "single-parse business/social signals must remain unchanged");
assert.ok(parsedHome.rootHints?.logoCandidates.has("https://example.test/assets/logo.svg"), "single-parse logo signals must remain unchanged");

const calls: string[] = [];
const fetcher = (async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  calls.push(url);
  const fixture = fixtures.get(url);
  if (!fixture) return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
  return new Response(fixture.body, { status: fixture.status ?? 200, headers: { "content-type": fixture.type } });
}) as typeof fetch;

const result = await crawlWebsite("https://example.test/", { fetcher, validateTarget: () => undefined, maxPages: 50, maxDepth: 10, maxDurationMs: 10_000 });

assert.equal(result.stopReason, "COMPLETE");
assert.equal(result.completeCoverage, true);
assert.equal(result.analyzedPages, 5);
assert.equal(result.skippedPages, 1);
assert.equal(result.failedPages, 0);
assert.equal(result.discoveredPages, 6);
assert.equal(calls.includes("https://example.test/private"), false);
assert.equal(result.pages.some((page) => page.url.includes("external.test")), false);
assert.equal(result.pages.some((page) => page.url.endsWith("brochure.pdf")), false);
assert.ok(result.pages.find((page) => page.title === "FAQ"));
assert.ok(result.pages.every((page) => page.status !== "ANALYZED" || page.contentHash?.length === 64));

assert.ok(calls.includes("https://example.test/assets/site.css"), "deve leggere il CSS esterno per la brand identity");
assert.ok(result.visualHints.colors.includes("#123456"), "deve estrarre colori anche dal CSS esterno");
assert.ok(!result.visualHints.colors.some((color) => color.includes("var(")), "non deve esporre variabili CSS irrisolte come colori");
assert.ok(!result.visualHints.colors.includes("#0000"), "non deve esporre colori completamente trasparenti");
assert.ok(result.visualHints.fontFamilies.includes("Inter"), "deve estrarre i font dal CSS esterno");
assert.equal(result.visualHints.logoUrl, "https://example.test/assets/logo.svg");
assert.ok(result.visualHints.logoCandidates.includes("https://example.test/assets/logo.svg"));
assert.ok(result.visualHints.imageUrls.includes("https://example.test/images/hero.webp"));
assert.ok(result.visualHints.stylesheetUrls.includes("https://example.test/assets/site.css"));
assert.equal(result.visualHints.socialLinks.instagram, "https://instagram.com/example");

const homeSignals = result.visualHints.pageSignals.find((page) => page.url === "https://example.test/");
assert.ok(homeSignals);
assert.equal(homeSignals?.canonicalUrl, "https://example.test/");
assert.ok(homeSignals?.headings.includes("Property management Milano"));
assert.ok(homeSignals?.imageUrls.includes("https://example.test/images/og-home.jpg"));
assert.ok(homeSignals?.schemaTypes.includes("LocalBusiness"));
const serviceSignals = result.visualHints.pageSignals.find((page) => page.url === "https://example.test/servizi");
assert.ok(serviceSignals?.schemaTypes.includes("Service"));

const limited = await crawlWebsite("https://example.test/", { fetcher, validateTarget: () => undefined, maxPages: 2, maxDepth: 10, maxDurationMs: 10_000 });
assert.equal(limited.stopReason, "PAGE_LIMIT");
assert.equal(limited.completeCoverage, false);
assert.equal(limited.pages.filter((page) => page.status !== "DISCOVERED").length, 2);
assert.ok(limited.pages.some((page) => page.status === "DISCOVERED"), "le URL scoperte ma non ancora visitate devono essere persistibili per il batch successivo");

const firstBatchTerminal = limited.pages.filter((page) => page.status !== "DISCOVERED").map((page) => page.normalizedUrl);
const firstBatchPending = limited.pages.filter((page) => page.status === "DISCOVERED").map((page) => ({ url: page.normalizedUrl, depth: page.depth, discoveredFrom: page.discoveredFrom }));
calls.length = 0;
const resumed = await crawlWebsite("https://example.test/", {
  fetcher,
  validateTarget: () => undefined,
  maxPages: 8,
  maxDepth: 10,
  maxDurationMs: 10_000,
  excludeUrls: firstBatchTerminal,
  seedUrls: firstBatchPending,
  includeSitemap: false,
});
assert.equal(resumed.pages.some((page) => firstBatchPending.some((pending) => pending.url === page.normalizedUrl) && page.status === "ANALYZED"), true, "il batch successivo deve riprendere le URL DISCOVERED");
assert.equal(resumed.pages.some((page) => firstBatchTerminal.includes(page.normalizedUrl) && page.status === "ANALYZED"), false, "le pagine terminali del batch precedente non devono essere elaborate di nuovo");
assert.equal(new Set(resumed.pages.map((page) => page.normalizedUrl)).size, resumed.pages.length, "la continuation non deve produrre duplicati nello stesso batch");
assert.equal(calls.includes("https://example.test/sitemap.xml"), false, "la continuation deve riusare la frontiera persistita senza riparsare la sitemap");

calls.length = 0;
const singleResume = await crawlWebsite("https://example.test/", {
  fetcher,
  validateTarget: () => undefined,
  maxPages: 1,
  maxDepth: 10,
  maxDurationMs: 10_000,
  excludeUrls: firstBatchTerminal,
  seedUrls: firstBatchPending,
  includeSitemap: false,
});
assert.equal(
  singleResume.pages.filter((page) => page.status !== "DISCOVERED").length,
  1,
  "una continuation da una pagina deve processare una sola seed persistita",
);
assert.equal(
  singleResume.pages.some((page) => page.status === "DISCOVERED" && firstBatchPending.some((pending) => pending.url === page.normalizedUrl)),
  false,
  "le seed DISCOVERED già persistite non devono essere riemesse e riserializzate a ogni continuation",
);

const redirectCalls: string[] = [];
const redirectFetcher = (async (input: string | URL | Request) => {
  const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  redirectCalls.push(requestUrl);
  if (requestUrl === "https://redirect.test/robots.txt") return new Response("User-agent: *", { headers: { "content-type": "text/plain" } });
  if (requestUrl === "https://redirect.test/") {
    return new Response(html("Redirect home", '<a href="/legacy-servizi">Legacy</a><a href="/servizi">Servizi</a>'), { headers: { "content-type": "text/html" } });
  }
  if (requestUrl === "https://redirect.test/legacy-servizi") {
    const response = new Response(html("Servizi", "<h1>Servizi canonici</h1>"), { headers: { "content-type": "text/html" } });
    Object.defineProperty(response, "url", { value: "https://redirect.test/servizi" });
    return response;
  }
  if (requestUrl === "https://redirect.test/servizi") {
    return new Response(html("Servizi", "<h1>Servizi canonici</h1>"), { headers: { "content-type": "text/html" } });
  }
  return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
}) as typeof fetch;

const redirectResult = await crawlWebsite("https://redirect.test/", {
  fetcher: redirectFetcher,
  validateTarget: () => undefined,
  maxPages: 10,
  maxDepth: 10,
  maxDurationMs: 10_000,
  includeSitemap: false,
});
assert.equal(
  redirectResult.pages.filter((page) => page.status === "ANALYZED" && page.normalizedUrl === "https://redirect.test/servizi").length,
  1,
  "più URL che convergono sullo stesso redirect finale devono produrre una sola pagina canonica analizzata",
);
assert.equal(
  redirectResult.pages.some((page) => page.normalizedUrl === "https://redirect.test/legacy-servizi" && page.status === "SKIPPED" && page.skipReason === "REDIRECT_CANONICAL"),
  true,
  "l'alias di redirect deve essere chiuso come alias e non duplicare il contenuto canonico",
);
assert.equal(
  redirectCalls.filter((url) => url === "https://redirect.test/servizi").length,
  0,
  "la destinazione canonica già risolta dal redirect non deve essere richiesta una seconda volta nello stesso batch",
);
assert.equal(
  new Set(redirectResult.pages.filter((page) => page.status === "ANALYZED").map((page) => page.url)).size,
  redirectResult.pages.filter((page) => page.status === "ANALYZED").length,
  "le pagine ANALYZED non devono contenere URL finali duplicate",
);

assert.equal(SAFE_SCAN_MAX_PAGES, 4, "Cloudflare free runtime must keep crawler batches at the verified CPU-safe size");
assert.equal(boundedScanPageLimit(500), SAFE_SCAN_MAX_PAGES, "a legacy client cannot request hundreds of pages in one Worker invocation");
assert.ok(estimatedScanSubrequests(500) < CLOUDFLARE_FREE_SUBREQUEST_LIMIT, "the bounded crawl must remain below Cloudflare's 50-subrequest production ceiling");
const crawlerSource = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../api/_lib/crawler.ts", import.meta.url), "utf8"));
assert.equal((crawlerSource.match(/cheerio\.load\(html\)/g) ?? []).length, 1, "each HTML page must have exactly one full Cheerio parse");
assert.match(crawlerSource, /const queuedUrls = new Set<string>\(\)/, "continuation queue dedupe must use an O(1) set");
assert.equal(crawlerSource.includes("queue.some((queued) => queued.url === normalized)"), false, "continuation must not dedupe the persisted frontier with repeated linear queue scans");
assert.match(crawlerSource, /persistedSeedUrls\.has\(item\.url\)/, "persisted pending seeds must not be re-emitted as DISCOVERED");
const workerSource = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../cloudflare/worker.ts", import.meta.url), "utf8"));
const contentPage = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../src/pages/content-generator-page.tsx", import.meta.url), "utf8"));
assert.match(workerSource, /boundedScanPageLimit\(body\.pageLimit\)/, "the server, not only the UI, must enforce the safe crawl bound");
assert.match(workerSource, /createPublicTargetValidator/, "DNS safety checks must be memoized per hostname inside one crawl");
assert.match(workerSource, /state=in\.\(COMPLETE,COMPLETE_WITH_WARNINGS,PARTIAL,RUNNING,FAILED\)/, "an existing partial or legacy-failed scan must be resumed instead of discarded");
assert.match(workerSource, /status !== "DISCOVERED"/, "terminal pages must be excluded from later crawl batches");
assert.match(workerSource, /status === "DISCOVERED"/, "pending pages must seed the next crawl batch");
assert.match(workerSource, /includeSitemap: pending\.length === 0/, "continuation must not re-fetch and reparse sitemap seeds already persisted in the frontier");
assert.match(workerSource, /resolution=merge-duplicates/, "batch progress must update the same scan frontier idempotently");
assert.match(workerSource, /const state = hasMore \? "PARTIAL"/, "BATCH_PENDING must remain a non-terminal PARTIAL scan state");
assert.match(workerSource, /error: hasMore \? "BATCH_PENDING"/, "pending continuation must persist the BATCH_PENDING checkpoint");
assert.equal(workerSource.includes('return json({ error: "SCAN_FAILED", detail }'), false, "raw Worker failures must not reach the customer");
assert.match(contentPage, /runFullWebsiteScan/, "legacy content bootstrap must complete the site through the shared batched scanner");
assert.equal(contentPage.includes("scanBody.detail"), false, "the content page must not display raw Cloudflare details");



const originalGlobalFetch = globalThis.fetch;
const scanRequests: Array<{ token: string; forceNew: boolean }> = [];
let scanAttempt = 0;
globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
  scanAttempt += 1;
  const headers = new Headers(init?.headers);
  const payload = JSON.parse(String(init?.body || "{}")) as { forceNew?: boolean };
  scanRequests.push({ token: headers.get("authorization") || "", forceNew: payload.forceNew === true });

  if (scanAttempt === 1) {
    return new Response(JSON.stringify({ error: "AUTH_REQUIRED" }), { status: 401, headers: { "content-type": "application/json" } });
  }
  if (scanAttempt === 2) {
    return new Response(JSON.stringify({
      scanId: "11111111-1111-4111-8111-111111111111",
      state: "PARTIAL",
      discoveredPages: 8,
      analyzedPages: 4,
      skippedPages: 0,
      failedPages: 0,
      pendingPages: 4,
      hasMore: true,
      visualHints: { colors: ["#123456"] },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (scanAttempt === 3) {
    return new Response(JSON.stringify({ error: "SCAN_FAILED", message: "temporary" }), { status: 500, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({
    scanId: "11111111-1111-4111-8111-111111111111",
    state: "COMPLETE",
    discoveredPages: 8,
    analyzedPages: 8,
    skippedPages: 0,
    failedPages: 0,
    pendingPages: 0,
    hasMore: false,
    visualHints: { colors: ["#123456"], fontFamilies: ["Inter"] },
  }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

try {
  let tokenSequence = 0;
  const progressSnapshots: number[] = [];
  const full = await runFullWebsiteScan({
    profileId: "22222222-2222-4222-8222-222222222222",
    forceNew: true,
    getToken: async () => `token-${++tokenSequence}`,
    onProgress: (batch) => progressSnapshots.push(websiteScanProgress(batch).percent),
  });
  assert.equal(full.state, "COMPLETE", "transient batch failures must recover and finish the same scan");
  assert.equal(full.batches, 2, "retries must not count as extra logical crawl batches");
  assert.deepEqual(progressSnapshots, [50, 100], "progress must reflect persisted processed/discovered pages");
  assert.equal(new Set(scanRequests.map((request) => request.token)).size, 4, "every batch attempt must request fresh auth");
  assert.deepEqual(scanRequests.map((request) => request.forceNew), [true, true, false, false], "401 may safely retry initial forceNew, later transient retries must resume instead of creating a duplicate scan");
  assert.equal(websiteScanProgress({ discoveredPages: 160, analyzedPages: 80, skippedPages: 10, failedPages: 0, pendingPages: 70, hasMore: true }).percent, 56);
  assert.equal(websiteScanProgress({ discoveredPages: 160, analyzedPages: 153, skippedPages: 6, failedPages: 1, pendingPages: 0, hasMore: false }).percent, 100);
} finally {
  globalThis.fetch = originalGlobalFetch;
}

assert.match(workerSource, /state=in\.\(COMPLETE,COMPLETE_WITH_WARNINGS,PARTIAL,RUNNING,FAILED\)/, "retry must be able to resume a scan that an older runtime marked FAILED");
assert.match(workerSource, /state: "PARTIAL"[\s\S]*error: "BATCH_RETRY_REQUIRED"/, "transient Worker failure must preserve a resumable checkpoint instead of terminally failing the scan");

console.log(`PASS crawler intelligence: ${result.analyzedPages} pagine, CSS/font/logo/immagini/headings/OG/schema estratti, robots e dominio rispettati.`);
