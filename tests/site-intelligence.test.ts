import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzeBrandFromWebsite } from "../api/_lib/brand-analysis.js";

let capturedBody: Record<string, any> | null = null;
const generated = {
  industry: "Property management",
  description: "Gestione di affitti brevi per proprietari.",
  businessModel: "Servizi ai proprietari",
  location: "Milano",
  serviceArea: "Milano",
  targetAudience: { summary: "Proprietari immobiliari", segments: ["Proprietari di seconde case"] },
  toneOfVoice: { summary: "Professionale e diretto", traits: ["chiaro", "competente"] },
  services: ["Gestione affitti brevi"],
  differentiators: ["Gestione completa"],
  valuePropositions: ["Riduzione del carico operativo"],
  goals: ["lead"],
  contentPillars: [{ name: "Gestione operativa", description: "Contenuti sulla gestione quotidiana", sourceUrls: ["https://example.test/servizi"] }],
  visualStyleSummary: "Brand pulito con palette blu e font Inter.",
  pageInsights: [
    { url: "https://example.test/", summary: "Homepage", topics: ["property management"], pageType: "homepage", intent: "presentazione", servicesMentioned: ["Gestione affitti brevi"] },
    { url: "https://example.test/servizi", summary: "Pagina servizi", topics: ["gestione operativa"], pageType: "service", intent: "conversione", servicesMentioned: ["Gestione affitti brevi"] },
  ],
};

const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
  capturedBody = JSON.parse(String(init?.body));
  return new Response(JSON.stringify({ id: "resp_brand", model: "gpt-5.6-terra", output: [{ content: [{ type: "output_text", text: JSON.stringify(generated) }] }], usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_brand" } });
}) as typeof fetch;

const result = await analyzeBrandFromWebsite({
  apiKey: "sk-test",
  profileName: "Example",
  websiteUrl: "https://example.test",
  industry: null,
  pages: [
    { url: "https://example.test/", title: "Home", text: "Gestione affitti brevi per proprietari a Milano." },
    { url: "https://example.test/servizi", title: "Servizi", text: "Gestione operativa completa degli affitti brevi." },
  ],
  visualHints: {
    colors: ["#123456"],
    fontFamilies: ["Inter"],
    socialLinks: { instagram: "https://instagram.com/example" },
    logoUrl: "https://example.test/logo.svg",
    logoCandidates: ["https://example.test/logo.svg"],
    imageUrls: ["https://example.test/hero.jpg"],
    stylesheetUrls: ["https://example.test/site.css"],
    pageSignals: [{ url: "https://example.test/", canonicalUrl: "https://example.test/", headings: ["Property management Milano"], imageUrls: ["https://example.test/hero.jpg"], ogImageUrl: "https://example.test/hero.jpg", schemaTypes: ["LocalBusiness"] }],
  },
  fetcher,
});

assert.equal(result.analysis.contentPillars[0].name, "Gestione operativa");
assert.equal(result.analysis.pageInsights.length, 2);
assert.ok(capturedBody);
assert.ok(capturedBody?.text?.format?.schema?.required?.includes("contentPillars"));
assert.ok(capturedBody?.text?.format?.schema?.required?.includes("pageInsights"));
assert.ok(String(capturedBody?.instructions).includes("tassonomia editoriale"));
assert.ok(String(capturedBody?.input).includes("Inter"));
assert.ok(String(capturedBody?.input).includes("LocalBusiness"));
assert.ok(String(capturedBody?.input).includes("https://example.test/servizi"));
assert.equal(String(capturedBody?.body ?? "").includes("sk-test"), false);

let fallbackCalls = 0;
const fallbackPages = [
  { url: "https://large.test/", title: "Home", text: "Homepage del sito." },
  { url: "https://large.test/servizi", title: "Servizi", text: "Servizi principali per i clienti." },
  { url: "https://large.test/faq", title: "FAQ", text: "Domande frequenti e risposte." },
];
const fallbackFetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
  fallbackCalls += 1;
  const request = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
  const pageInsights = fallbackCalls === 1
    ? [{ url: fallbackPages[0].url, summary: "Homepage", topics: ["presentazione"], pageType: "homepage", intent: "presentazione", servicesMentioned: [] }]
    : fallbackPages.slice(1).map((page) => ({ url: page.url, summary: page.title ?? "", topics: ["contenuto"], pageType: "pagina", intent: "informazione", servicesMentioned: [] }));
  const payload = fallbackCalls === 1
    ? { ...generated, pageInsights }
    : { pageInsights };
  if (fallbackCalls === 2) {
    assert.equal(request.text?.format?.schema?.properties?.pageInsights?.minItems, 2, "il fallback deve richiedere esattamente le sole pagine mancanti");
    assert.equal(request.text?.format?.schema?.properties?.pageInsights?.maxItems, 2, "il fallback deve essere bounded sul batch mancante");
  }
  return new Response(JSON.stringify({
    id: `resp_fallback_${fallbackCalls}`,
    model: "gpt-5.6-terra",
    output: [{ content: [{ type: "output_text", text: JSON.stringify(payload) }] }],
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
  }), { status: 200, headers: { "content-type": "application/json", "x-request-id": `req_fallback_${fallbackCalls}` } });
}) as typeof fetch;

const completed = await analyzeBrandFromWebsite({
  apiKey: "sk-test",
  profileName: "Large",
  websiteUrl: "https://large.test",
  industry: null,
  pages: fallbackPages,
  visualHints: { colors: [], socialLinks: {}, logoUrl: null },
  fetcher: fallbackFetcher,
});
assert.equal(fallbackCalls, 2, "se il primo output omette pagine deve partire un solo fallback sulle mancanti");
assert.deepEqual(completed.analysis.pageInsights.map((item) => item.url), fallbackPages.map((page) => page.url), "ogni pagina deve avere un insight AI e mantenere l'ordine del crawler");
assert.equal(completed.usage.inputTokens, 200, "il metering deve sommare anche i token dei fallback");
assert.equal(completed.usage.outputTokens, 100, "il metering deve sommare l'output di tutte le chiamate provider");

const vercelSource = await readFile(new URL("../api/onboarding-analyze.ts", import.meta.url), "utf8");
assert.ok(vercelSource.includes("observedFonts"));
assert.ok(vercelSource.includes("pageInsights: result.analysis.pageInsights"));
assert.ok(vercelSource.includes("contentPillars: result.analysis.contentPillars"));

const workerEntry = await readFile(new URL("../cloudflare/entry.ts", import.meta.url), "utf8");
assert.ok(workerEntry.includes('path === "/api/onboarding-analyze"'));
assert.ok(workerEntry.includes("handleWorkerOnboardingAnalyze(request, env)"));
const workerSource = await readFile(new URL("../cloudflare/onboarding-analyze.ts", import.meta.url), "utf8");
assert.ok(workerSource.includes("observedFonts"));
assert.ok(workerSource.includes("pageInsights: result.analysis.pageInsights"));
assert.ok(workerSource.includes("contentPillars: result.analysis.contentPillars"));

console.log("PASS site intelligence: tassonomia, insight pagina-per-pagina, segnali visivi e parità Vercel/Worker verificati.");