import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { siteIntelligenceView } from "../src/lib/site-intelligence-view.js";
import { runFullWebsiteScan } from "../src/lib/full-website-scan.js";
import { isWebsiteScanInProgress, isWebsiteScanTerminal, websiteScanProgress, websiteScanUiState } from "../src/lib/website-scan-state.js";

const parsed = siteIntelligenceView({
  visual_identity: {
    observedColors: ["#123456", "rgb(1, 2, 3)", "not-a-color"],
    observedFonts: ["Inter", "Montserrat", "Inter"],
    logoUrl: "https://example.test/logo.svg",
    contentPillars: [
      { name: "Gestione operativa", description: "Processi per affitti brevi" },
      { name: "gestione operativa", description: "duplicato" },
      { name: "Normativa", description: "Adempimenti" },
    ],
    pageInsights: [{ url: "a" }, { url: "b" }],
  },
  services: ["Check-in", "Gestione annunci"],
  tone_of_voice: { traits: ["professionale", "diretto"] },
  target_audience: { summary: "Proprietari di immobili" },
  differentiators: ["Gestione completa"],
});

assert.deepEqual(parsed.colors, ["#123456", "rgb(1, 2, 3)"]);
assert.deepEqual(parsed.fonts, ["Inter", "Montserrat"]);
assert.equal(parsed.logoUrl, "https://example.test/logo.svg");
assert.deepEqual(parsed.pillars.map((item) => item.name), ["Gestione operativa", "Normativa"]);
assert.equal(parsed.pageInsightCount, 2);
assert.deepEqual(parsed.services, ["Check-in", "Gestione annunci"]);
assert.deepEqual(parsed.toneTraits, ["professionale", "diretto"]);
assert.equal(parsed.targetSummary, "Proprietari di immobili");
assert.deepEqual(parsed.differentiators, ["Gestione completa"]);

const unsafe = siteIntelligenceView({ visual_identity: { logoUrl: "javascript:alert(1)", observedColors: ["url(evil)"] } });
assert.equal(unsafe.logoUrl, null);
assert.deepEqual(unsafe.colors, []);

const source = await readFile(new URL("../src/pages/website-scan-page.tsx", import.meta.url), "utf8");
const fullScan = await readFile(new URL("../src/lib/full-website-scan.ts", import.meta.url), "utf8");
const scanApi = await readFile(new URL("../api/website-scan.ts", import.meta.url), "utf8");
const worker = await readFile(new URL("../cloudflare/worker.ts", import.meta.url), "utf8");
assert.ok(source.includes('from("brand_profiles")'), "la pagina deve leggere la site intelligence persistita");
assert.ok(source.includes('.eq("profile_id", profileId)'), "ogni lettura deve restare vincolata all’attività selezionata");
assert.ok(source.includes("siteIntelligenceView"), "la UI deve usare il parser fail-closed");
assert.ok(source.includes("Cosa ho imparato dal sito"), "la site intelligence deve essere visibile all’utente");
assert.doesNotMatch(source, /\(intelligence\.logoUrl \|\| intelligence\.colors\.length\) &&/, "la UI non deve renderizzare il valore numerico 0 quando logo e colori non sono presenti");
assert.match(source, /Boolean\(intelligence\.logoUrl\) \|\| intelligence\.colors\.length > 0/, "la condizione della card identità visiva deve essere strettamente booleana");
assert.ok(source.includes("Non vengono mostrati valori demo"), "la UI deve dichiarare la provenienza reale dei dati");
assert.ok(source.includes("runFullWebsiteScan"), "la pagina Sito deve usare il runner condiviso di scansione completa");
assert.ok(source.includes('scanUiState === "IN_PROGRESS"'), "una scansione parziale deve riprendere automaticamente");
assert.match(fullScan, /pageLimit:\s*4/, "ogni singolo batch deve restare entro il limite Cloudflare CPU-safe verificato");
assert.match(fullScan, /if \(!body\.hasMore\) return/, "il runner deve continuare finché il backend segnala pagine pendenti");
assert.match(fullScan, /maxBatches = 260/, "deve esistere un limite fail-safe coerente con la copertura massima");
assert.match(fullScan, /signal:\s*input\.signal/, "il runner deve poter essere cancellato allo smontaggio");
assert.ok(source.includes("window.setInterval"), "una scansione non terminale deve aggiornare lo stato con polling controllato");
assert.ok(source.includes("2500"), "il polling deve avere una cadenza leggera di circa 2-3 secondi");
assert.ok(source.includes("window.clearInterval"), "il polling deve fermarsi allo smontaggio o al cambio stato");
assert.ok(source.includes("pollInFlightRef"), "il polling non deve creare richieste duplicate");
assert.ok(source.includes("runnerInFlightRef"), "la continuation non deve avviare due runner concorrenti");
assert.ok(source.includes("Riprova solo analisi brand"), "un errore brand deve poter essere ritentato senza rifare il crawler");
assert.ok(source.includes("async function retryBrandAnalysis()"), "la pagina Sito deve avere un retry brand dedicato");
const retryBrandBlock = source.slice(source.indexOf("async function retryBrandAnalysis()"), source.indexOf("async function startScan"));
assert.ok(retryBrandBlock.includes("requestBrandAnalysis"), "il retry brand deve usare la chiamata autenticata dedicata");
assert.equal(retryBrandBlock.includes("runFullWebsiteScan"), false, "il retry brand non deve rilanciare la scansione completa");
assert.ok(source.includes("setBrandVisualHints(storedVisualHints(brandRow))"), "il retry deve preservare i segnali visivi già persistiti");
assert.ok(source.includes("setBrandAnalyzedAt(brandAnalysisTimestamp(brandRow))"), "la pagina deve persistere logicamente lo stato brand confrontando analyzedAt con lo scan");
assert.match(source, /function brandNeedsAnalysis\([\s\S]*COMPLETE_WITH_WARNINGS[\s\S]*brandTime < scanTime/, "il retry deve restare visibile dopo refresh finché il brand non è aggiornato rispetto all'ultimo scan");
assert.match(source, /\(scan\.analyzed_pages \?\? 0\) > pageInsightCount/, "un brand con meno pageInsights delle pagine analizzate deve risultare incompleto anche se il timestamp è aggiornato");
assert.match(retryBrandBlock, /forceRefresh = Boolean\(scan && intelligence\.pageInsightCount < scan\.analyzed_pages\)/, "il retry deve forzare un nuovo provider pass solo quando il cache brand è incompleto");
assert.match(retryBrandBlock, /requestBrandAnalysis\(selectedProfile\.id, brandVisualHints, undefined, forceRefresh\)/, "il brand-only repair non deve rilanciare il crawler");
assert.match(source, /JSON\.stringify\(\{ profileId, visualHints, forceRefresh \}\)/, "la richiesta brand deve dichiarare esplicitamente il refresh del cache incompleto");
assert.ok(source.includes("Analisi brand da completare."), "la UI deve mostrare uno stato persistente quando il crawler è finito ma il brand è ancora vecchio o incompleto");
assert.match(source, /const \[brandProgress, setBrandProgress\] = useState\(0\)/, "l'analisi brand deve esporre una percentuale visibile");
assert.match(source, /current < 94 \? current \+ 1 : current/, "la percentuale brand deve avanzare un punto alla volta senza saltare direttamente al completamento");
assert.match(source, /setBrandProgressExact\(100\)/, "la percentuale brand deve arrivare a 100 solo dopo reload e persistenza del risultato");
assert.ok(source.includes("Avanzamento analisi brand"), "la UI deve mostrare una progress bar accessibile per l'analisi brand");
assert.ok(source.includes("La percentuale è una stima di avanzamento"), "la UI non deve fingere che il progresso provider sia telemetria live");
assert.ok(source.includes("Completa analisi brand"), "lo stato persistente deve offrire il retry senza rifare il crawler");
assert.match(source, /IGNORABLE_PAGE_ERROR/, "la UI deve riconoscere gli errori tecnici/inaccessibili già salvati dai vecchi scan");
assert.match(source, /visiblePages = pages\.filter\(\(page\) => !isAutomaticallyIgnoredPage\(page\)\)/, "le pagine irrilevanti devono essere escluse dalla lista utente");
assert.match(source, /effectiveScanUiState = scanUiState === "COMPLETED_WITH_WARNINGS" && meaningfulFailures === 0 \? "COMPLETED"/, "warning composti solo da pagine irrilevanti devono risultare completati");
assert.ok(source.includes("Pagine utili"), "il riepilogo deve contare le sole pagine utili");
assert.ok(source.includes("Copertura utile"), "la copertura non deve essere abbassata da URL tecniche ignorate");
assert.match(source, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/, "AUTH_REQUIRED deve avere un solo retry automatico con token fresco");
assert.match(source, /response\.status === 401 \|\| body\.error === "AUTH_REQUIRED"/, "il retry automatico deve scattare solo sul boundary auth");
assert.match(source, /runFullWebsiteScan\([\s\S]*getToken: authenticatedApiToken[\s\S]*requestBrandAnalysis/, "la scansione lunga deve aggiornare il token per batch e il brand deve usare un token fresco separato");

const batchPending = { state: "PARTIAL", error: "BATCH_PENDING", discovered_pages: 113, analyzed_pages: 63, skipped_pages: 0, failed_pages: 0 };
assert.equal(websiteScanUiState(batchPending), "IN_PROGRESS", "BATCH_PENDING non deve mai essere un failure");
assert.equal(isWebsiteScanInProgress(batchPending), true, "BATCH_PENDING deve mantenere attiva la scansione");
assert.deepEqual(websiteScanProgress(batchPending), { discovered: 113, analyzed: 63, skipped: 0, failed: 0, processed: 63, remaining: 50, percent: 56 });
assert.equal(websiteScanUiState({ state: "COMPLETE", failed_pages: 0 }), "COMPLETED");
assert.equal(isWebsiteScanTerminal({ state: "COMPLETE", failed_pages: 0 }), true, "completion deve fermare polling/continuation");
assert.equal(websiteScanUiState({ state: "FAILED", error: "HTTP_500" }), "FAILED", "un failure reale deve restare errore");
assert.equal(websiteScanUiState({ state: "COMPLETE_WITH_WARNINGS", failed_pages: 2 }), "COMPLETED_WITH_WARNINGS");
assert.match(scanApi, /state = hasMore \? "PARTIAL" : failedPages > 0 \? "COMPLETE_WITH_WARNINGS" : "COMPLETE"/, "il backend deve distinguere completamento con warning");
assert.match(scanApi, /state: "PARTIAL"[\s\S]*error: "BATCH_RETRY_REQUIRED"/, "un errore batch transitorio deve lasciare il checkpoint Vercel riprendibile");
assert.match(worker, /state: "PARTIAL"[\s\S]*error: "BATCH_RETRY_REQUIRED"/, "il Worker deve lasciare il checkpoint transitorio riprendibile");
assert.match(scanApi, /state=in\.\(COMPLETE,COMPLETE_WITH_WARNINGS,PARTIAL,RUNNING,FAILED\)/, "Vercel deve poter recuperare anche scan FAILED creati dal runtime precedente");
assert.match(worker, /state=in\.\(COMPLETE,COMPLETE_WITH_WARNINGS,PARTIAL,RUNNING,FAILED\)/, "Cloudflare deve poter recuperare anche scan FAILED creati dal runtime precedente");

const originalFetch = globalThis.fetch;
const requestBodies: Array<{ forceNew?: boolean }> = [];
let responseIndex = 0;
const batches = [
  { scanId: "scan-1", state: "PARTIAL", hasMore: true, discoveredPages: 20, analyzedPages: 8, visualHints: {} },
  { scanId: "scan-1", state: "PARTIAL", hasMore: true, discoveredPages: 20, analyzedPages: 16, visualHints: {} },
  { scanId: "scan-1", state: "COMPLETE", hasMore: false, discoveredPages: 20, analyzedPages: 20, visualHints: {} },
];
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  requestBodies.push(JSON.parse(String(init?.body ?? "{}")) as { forceNew?: boolean });
  return Response.json(batches[responseIndex++] ?? batches[batches.length - 1]);
}) as typeof fetch;
try {
  const progressEvents: number[] = [];
  const result = await runFullWebsiteScan({ profileId: "p1", token: "t1", forceNew: true, onProgress: (batch) => progressEvents.push(batch.analyzedPages ?? 0) });
  assert.equal(result.batches, 3);
  assert.deepEqual(progressEvents, [8, 16, 20], "il progresso deve aggiornarsi dopo ogni batch");
  assert.equal(requestBodies.length, 3, "la continuation deve inviare esattamente un request per batch");
  assert.equal(requestBodies[0]?.forceNew, true);
  assert.equal(requestBodies[1]?.forceNew, false);
  assert.equal(requestBodies[2]?.forceNew, false, "i batch successivi devono continuare lo stesso scan senza duplicarlo");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("PASS site intelligence UI: parser fail-closed, dati reali visibili e query profile-scoped verificati.");