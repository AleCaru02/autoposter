import assert from "node:assert/strict";
import { crawlWebsite } from "../api/_lib/crawler.js";
import { boundedScanPageLimit, CLOUDFLARE_FREE_SUBREQUEST_LIMIT, estimatedScanSubrequests, SAFE_SCAN_MAX_PAGES } from "../api/_lib/website-scan-policy.js";

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
const resumed = await crawlWebsite("https://example.test/", {
  fetcher,
  validateTarget: () => undefined,
  maxPages: 8,
  maxDepth: 10,
  maxDurationMs: 10_000,
  excludeUrls: firstBatchTerminal,
  seedUrls: firstBatchPending,
});
assert.equal(resumed.pages.some((page) => firstBatchPending.some((pending) => pending.url === page.normalizedUrl) && page.status === "ANALYZED"), true, "il batch successivo deve riprendere le URL DISCOVERED");

assert.equal(boundedScanPageLimit(500), SAFE_SCAN_MAX_PAGES, "a legacy client cannot request hundreds of pages in one Worker invocation");
assert.ok(estimatedScanSubrequests(500) < CLOUDFLARE_FREE_SUBREQUEST_LIMIT, "the bounded crawl must remain below Cloudflare's 50-subrequest production ceiling");
const workerSource = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../cloudflare/worker.ts", import.meta.url), "utf8"));
const contentPage = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../src/pages/content-generator-page.tsx", import.meta.url), "utf8"));
assert.match(workerSource, /boundedScanPageLimit\(body\.pageLimit\)/, "the server, not only the UI, must enforce the safe crawl bound");
assert.match(workerSource, /createPublicTargetValidator/, "DNS safety checks must be memoized per hostname inside one crawl");
assert.match(workerSource, /state=in\.\(COMPLETE,COMPLETE_WITH_WARNINGS,PARTIAL,RUNNING\)/, "an existing partial scan must be resumed instead of discarded");
assert.match(workerSource, /status !== "DISCOVERED"/, "terminal pages must be excluded from later crawl batches");
assert.match(workerSource, /status === "DISCOVERED"/, "pending pages must seed the next crawl batch");
assert.match(workerSource, /resolution=merge-duplicates/, "batch progress must update the same scan frontier idempotently");
assert.equal(workerSource.includes('return json({ error: "SCAN_FAILED", detail }'), false, "raw Worker failures must not reach the customer");
assert.match(contentPage, /runFullWebsiteScan/, "legacy content bootstrap must complete the site through the shared batched scanner");
assert.equal(contentPage.includes("scanBody.detail"), false, "the content page must not display raw Cloudflare details");

console.log(`PASS crawler intelligence: ${result.analyzedPages} pagine, CSS/font/logo/immagini/headings/OG/schema estratti, robots e dominio rispettati.`);
