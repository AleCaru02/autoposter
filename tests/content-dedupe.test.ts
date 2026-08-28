import assert from "node:assert/strict";
import { findNearDuplicate, semanticContentSimilarity, type ContentDedupeCandidate } from "../api/_lib/content-dedupe.js";

const previous: ContentDedupeCandidate = {
  id: "old-1",
  topic: "Errori nella preparazione di un immobile per affitti brevi",
  angle: "Cinque errori pratici da evitare prima di pubblicare l'annuncio",
  hook: "5 errori che possono frenare il tuo annuncio",
  caption: "Prima di pubblicare un appartamento per affitti brevi conviene controllare foto, dotazioni, descrizione, pulizia e informazioni per gli ospiti.",
};

const paraphrase: ContentDedupeCandidate = {
  topic: "Errori preparazione immobile affitti brevi",
  angle: "Gli sbagli più comuni prima della pubblicazione dell'annuncio",
  hook: "Gli errori da non fare prima di mettere online la casa",
  caption: "Quando prepari una casa per gli affitti brevi evita problemi nelle fotografie, nelle dotazioni, nella descrizione, nella pulizia e nelle istruzioni agli ospiti.",
};

const sameTopicDifferentAngle: ContentDedupeCandidate = {
  topic: "Preparazione immobile per affitti brevi",
  angle: "Checklist fotografica per rendere coerenti le immagini dell'annuncio",
  hook: "Una checklist semplice per fotografare meglio ogni stanza",
  caption: "Organizza gli scatti per ambienti, luce, inquadrature e dettagli così da presentare l'immobile in modo coerente.",
};

const distinct: ContentDedupeCandidate = {
  topic: "Tassa di soggiorno a Milano",
  angle: "Cosa deve sapere un proprietario sulle comunicazioni e sulle scadenze",
  hook: "Tassa di soggiorno: quali passaggi controllare",
  caption: "Una panoramica dedicata agli adempimenti della tassa di soggiorno e alle relative comunicazioni amministrative.",
};

const duplicateScore = semanticContentSimilarity(previous, paraphrase);
assert.ok(duplicateScore.score >= 0.55, `la parafrasi deve superare la soglia combinata minima, score=${duplicateScore.score}`);
assert.ok(duplicateScore.topicScore >= 0.55, `la parafrasi deve avere forte sovrapposizione sul tema, topicScore=${duplicateScore.topicScore}`);
assert.equal(findNearDuplicate(paraphrase, [previous])?.candidate.id, "old-1", "la parafrasi dello stesso concept deve essere bloccata");

const differentAngleScore = semanticContentSimilarity(previous, sameTopicDifferentAngle);
assert.ok(differentAngleScore.topicScore < 0.55 || differentAngleScore.score < 0.55, `un angolo realmente diverso non deve soddisfare entrambe le condizioni topic-led, score=${differentAngleScore.score}, topic=${differentAngleScore.topicScore}`);
assert.ok(differentAngleScore.bodyScore < 0.78, `un angolo realmente diverso non deve sembrare una copia del copy, body=${differentAngleScore.bodyScore}`);
assert.equal(findNearDuplicate(sameTopicDifferentAngle, [previous]), null, "un angolo realmente diverso sullo stesso ambito deve restare consentito");

const distinctScore = semanticContentSimilarity(previous, distinct);
assert.ok(distinctScore.score < 0.35, `temi distinti devono restare nettamente separati, score=${distinctScore.score}`);
assert.equal(findNearDuplicate(distinct, [previous]), null);

const exact = semanticContentSimilarity(previous, { ...previous, id: "copy" });
assert.ok(exact.score > 0.95, `una copia esatta deve avere score molto alto, score=${exact.score}`);
assert.equal(findNearDuplicate({ ...previous, id: "copy" }, [previous])?.candidate.id, "old-1", "una copia esatta deve essere bloccata");

const legacyInstruction: ContentDedupeCandidate = {
  id: "legacy",
  topic: "Scegli autonomamente un nuovo tema editoriale. Evita di ripetere questi temi recenti.",
  angle: "",
  hook: "Un contenuto storico non pertinente",
  caption: "Testo completamente differente.",
};
assert.equal(findNearDuplicate(paraphrase, [legacyInstruction]), null, "i vecchi prompt salvati erroneamente come topic non devono creare falsi positivi");

console.log("PASS content dedupe: copie/parafrasi bloccate, angoli diversi e temi distinti consentiti, legacy prompt ignorati.");
