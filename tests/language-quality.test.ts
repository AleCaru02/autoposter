import assert from "node:assert/strict";
import { italianNativeQualityIssues, languageQualityIssues, titleQualityIssues } from "../api/_lib/language-quality.js";
import { editorialQualityIssues, type GeneratedSocialContent } from "../api/_lib/openai-text.js";

assert.ok(italianNativeQualityIssues("5 cose che 20 anni di network mi hanno insegnato", "title").some((issue)=>issue.includes("UNNATURAL_EXPERIENCE_FORMULA")));
assert.deepEqual(italianNativeQualityIssues("5 cose che ho imparato in 20 anni di network marketing", "title"), []);
assert.ok(italianNativeQualityIssues("Una scelta utile per chi gestisce immobili con i", "angle").some((issue)=>issue.includes("DANGLING_ENDING")));
assert.ok(titleQualityIssues("5 differenze principali").includes("TITLE_GENERIC_LISTICLE"));
assert.ok(titleQualityIssues("Airbnb e Booking: 5 differenze principali").includes("TITLE_GENERIC_LISTICLE"));
assert.deepEqual(titleQualityIssues("Airbnb o Booking? Cosa cambia nella gestione di un immobile"), []);

const native: GeneratedSocialContent = {
  editorialTopic:"Airbnb o Booking? Cosa cambia nella gestione di un immobile",
  pillar:"Distribuzione",
  editorialAngle:"Cinque differenze operative aiutano il proprietario a capire quale configurazione è più coerente con il proprio immobile.",
  strategySummary:"Confronto concreto e verificabile.",
  variants:[{
    provider:"INSTAGRAM",format:"POST",eligible:true,
    hook:"Airbnb o Booking? Guarda cosa cambia davvero.",
    caption:"1. Commissioni: confronta la struttura dei costi.\n2. Tariffa: valuta come costruire il prezzo.\n3. Cancellazioni: verifica le policy disponibili.\n4. Pagamenti: controlla tempi e modalità di incasso.\n5. Operatività: considera il lavoro necessario per gestire il canale.",
    cta:"Salva il confronto.",hashtags:["#affittibrevi"],visualBrief:"Confronto editoriale",altText:"Confronto tra cinque aspetti",factualBasis:["BASE BRAND/SITO"],carouselSlides:[]
  }]
};
assert.deepEqual(languageQualityIssues(native), []);
assert.deepEqual(editorialQualityIssues(native,"booking vs airbnb","le 5 differenze fra i due"), []);

const fakeCount: GeneratedSocialContent = {
  ...native,
  variants:[{...native.variants[0],caption:"Airbnb e Booking: 5 differenze da conoscere prima di scegliere."}],
};
assert.ok(editorialQualityIssues(fakeCount,"booking vs airbnb","le 5 differenze fra i due").some((issue)=>issue.startsWith("REQUESTED_COUNT_STRUCTURE_INVALID")));

const evasive: GeneratedSocialContent = {
  ...native,
  editorialTopic:"Airbnb e Booking: aspetti da confrontare",
  editorialAngle:"Più che cercare un vincitore, ci sono alcuni criteri da valutare.",
};
const evasiveIssues=editorialQualityIssues(evasive,"booking vs airbnb","le 5 differenze fra i due");
assert.ok(evasiveIssues.includes("COMPARISON_FRAMING_EVASIVE"));
assert.ok(evasiveIssues.includes("DIFFERENCE_REQUEST_DILUTED"));

const genericTitle: GeneratedSocialContent = {...native,editorialTopic:"5 differenze principali"};
assert.ok(editorialQualityIssues(genericTitle,"confronto canali","").includes("TITLE_GENERIC_LISTICLE"));

console.log("PASS Italian native quality: natural syntax, title quality, structured count and comparison fidelity.");
