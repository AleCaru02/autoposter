import assert from "node:assert/strict";
import { crawlWebsite } from "../api/_lib/crawler.js";

const html = (title: string, body: string) => `<!doctype html><html><head><title>${title}</title><meta name="description" content="Descrizione ${title}"></head><body>${body}</body></html>`;

const fixtures = new Map<string, { type: string; body: string; status?: number }>([
  ["https://example.test/robots.txt", { type: "text/plain", body: "User-agent: *\nDisallow: /private" }],
  ["https://example.test/sitemap.xml", { type: "application/xml", body: "<?xml version=\"1.0\"?><urlset><url><loc>https://example.test/faq</loc></url></urlset>" }],
  ["https://example.test/", { type: "text/html", body: html("Home", '<a href="/servizi">Servizi</a><a href="/chi-siamo?utm_source=test">Chi siamo</a><a href="/private">Privata</a><a href="https://external.test/page">Fuori</a><a href="/brochure.pdf">PDF</a>') }],
  ["https://example.test/servizi", { type: "text/html", body: html("Servizi", '<a href="/contatti">Contatti</a><a href="/#top">Home</a>') }],
  ["https://example.test/chi-siamo", { type: "text/html", body: html("Chi siamo", "La nostra azienda") }],
  ["https://example.test/contatti", { type: "text/html", body: html("Contatti", "Scrivici") }],
  ["https://example.test/faq", { type: "text/html", body: html("FAQ", "Domande frequenti") }],
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
assert.equal(result.analyzedPages, 5, "deve analizzare homepage + quattro pagine interne");
assert.equal(result.skippedPages, 1, "la pagina vietata da robots deve essere registrata come saltata");
assert.equal(result.failedPages, 0);
assert.equal(result.discoveredPages, 6);
assert.deepEqual(result.pages.filter((page) => page.status === "ANALYZED").map((page) => new URL(page.normalizedUrl).pathname).sort(), ["/", "/chi-siamo", "/contatti", "/faq", "/servizi"]);
assert.equal(result.pages.find((page) => new URL(page.normalizedUrl).pathname === "/private")?.skipReason, "ROBOTS_DISALLOW");
assert.equal(calls.includes("https://example.test/private"), false, "robots.txt deve impedire il fetch della pagina privata");
assert.equal(result.pages.some((page) => page.url.includes("external.test")), false, "non deve uscire dal dominio");
assert.equal(result.pages.some((page) => page.url.endsWith("brochure.pdf")), false, "non deve trattare PDF come pagina HTML");
assert.ok(result.pages.find((page) => page.title === "FAQ"), "deve includere anche una pagina trovata dalla sitemap e non linkata dalla homepage");
assert.ok(result.pages.every((page) => page.status !== "ANALYZED" || page.contentHash?.length === 64), "ogni pagina analizzata deve avere hash contenuto");

const limited = await crawlWebsite("https://example.test/", { fetcher, validateTarget: () => undefined, maxPages: 2, maxDepth: 10, maxDurationMs: 10_000 });
assert.equal(limited.stopReason, "PAGE_LIMIT");
assert.equal(limited.completeCoverage, false);
assert.equal(limited.pages.length, 2);

console.log(`PASS crawler: ${result.analyzedPages} pagine analizzate, ${result.skippedPages} saltata, sitemap inclusa, dominio isolato.`);
