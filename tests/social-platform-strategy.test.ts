import assert from "node:assert/strict";
import {
  crossPlatformCopySimilarity,
  platformCopyStrategyPrompt,
  platformDiversityIssues,
  platformVisualStrategyPrompt,
  selectedPlatformStrategies,
  socialPlatformStrategy,
} from "../api/_lib/social-platform-strategy.js";

const instagram = socialPlatformStrategy("INSTAGRAM");
assert.match(instagram.copy.join(" "), /hook forte/i);
assert.match(instagram.copy.join(" "), /salvare/i);
assert.match(instagram.visual.join(" "), /visual/i);
assert.match(instagram.format.join(" "), /CAROUSEL/);
assert.match(instagram.format.join(" "), /STORY/);

const facebook = socialPlatformStrategy("FACEBOOK");
assert.match(facebook.copy.join(" "), /discorsivo e umano/i);
assert.match(facebook.copy.join(" "), /community/i);
assert.match(facebook.copy.join(" "), /WhatsApp/i);
assert.match(facebook.copy.join(" "), /hashtag/i);

const linkedin = socialPlatformStrategy("LINKEDIN");
assert.match(linkedin.copy.join(" "), /professionale e business/i);
assert.match(linkedin.copy.join(" "), /insight/i);
assert.match(linkedin.copy.join(" "), /pochissimi hashtag/i);
assert.match(linkedin.copy.join(" "), /discussione professionale/i);
assert.match(linkedin.visual.join(" "), /editoriale e professionale/i);

const gbp = socialPlatformStrategy("GBP");
assert.match(gbp.copy.join(" "), /servizio, novità, evento/i);
assert.match(gbp.copy.join(" "), /utilità locale/i);
assert.match(gbp.copy.join(" "), /eligible=false/i);
assert.match(gbp.visual.join(" "), /chiarezza e fiducia/i);
assert.match(gbp.visual.join(" "), /Non inventare sede/i);

assert.match(platformCopyStrategyPrompt("INSTAGRAM"), /STRATEGIA COPY Instagram/);
assert.match(platformVisualStrategyPrompt("LINKEDIN"), /STRATEGIA VISUAL LinkedIn/);

const selected = selectedPlatformStrategies(["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"]);
assert.deepEqual(selected.map((item) => item.provider), ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"]);
assert.equal(selected.length, 4);

assert.ok(crossPlatformCopySimilarity("Gestire meglio gli affitti brevi a Milano", "Gestire meglio gli affitti brevi a Milano") > 0.99);
const similarIssues = platformDiversityIssues([
  { provider: "INSTAGRAM", format: "POST", hook: "5 differenze tra Airbnb e Booking", caption: "Commissioni, tariffe, cancellazioni, pagamenti e gestione operativa sono i cinque aspetti da conoscere.", cta: "Contattaci" },
  { provider: "FACEBOOK", format: "POST", hook: "5 differenze tra Airbnb e Booking", caption: "Commissioni, tariffe, cancellazioni, pagamenti e gestione operativa sono i cinque aspetti da conoscere davvero.", cta: "Contattaci" },
]);
assert.ok(similarIssues.some((issue) => issue.startsWith("CROSS_PLATFORM_TOO_SIMILAR:")), "near-copy cross-platform variants must be rejected");

const distinctIssues = platformDiversityIssues([
  { provider: "INSTAGRAM", format: "POST", hook: "Airbnb o Booking? Salva queste 5 differenze", caption: "Una guida rapida da scorrere: commissioni, tariffa, cancellazioni, pagamenti e gestione. Salvala prima di pubblicare il tuo immobile.", cta: "Salva il post" },
  { provider: "FACEBOOK", format: "POST", hook: "Prima di scegliere il portale, guarda come cambia la gestione", caption: "Per un proprietario non conta solo il costo. Vale la pena capire come cambiano cancellazioni, incassi e operatività quotidiana, soprattutto se gestisci l'immobile a distanza.", cta: "Scrivici per confrontare il tuo caso" },
  { provider: "LINKEDIN", format: "POST", hook: "La scelta del canale è una decisione operativa, non solo commerciale", caption: "Confrontare Airbnb e Booking significa valutare struttura economica, pricing, policy di cancellazione, flussi di pagamento e impatto sul processo di gestione.", cta: "Confrontiamoci sul modello operativo" },
  { provider: "GBP", format: "POST", hook: "Gestione affitti brevi a Milano: quale canale usare?", caption: "Per ogni immobile valutiamo canali, regole operative e modalità di incasso prima della pubblicazione. La scelta dipende dal caso concreto e dagli obiettivi del proprietario.", cta: "Richiedi informazioni" },
]);
assert.deepEqual(distinctIssues, []);

console.log("PASS social platform strategy: Instagram, Facebook, LinkedIn e GBP hanno logiche native separate.");
