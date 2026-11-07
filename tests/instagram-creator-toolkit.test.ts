import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  INSTAGRAM_RECIPES,
  applyInstagramRecipe,
  instagramDraftPreflight,
} from "../src/features/content/instagram-creator-toolkit.js";
import type { GeneratedVariant } from "../api/_lib/openai-text.js";

const sample: GeneratedVariant = {
  provider: "INSTAGRAM",
  format: "POST",
  eligible: true,
  hook: "Come funziona?",
  caption: "Questa è una spiegazione chiara per il pubblico.",
  cta: "Scrivici per saperne di più.",
  hashtags: ["#esempio", "#attivita"],
  visualBrief: "Un visual professionale e leggibile",
  altText: "Una persona che consulta informazioni",
  factualBasis: [],
  carouselSlides: [],
};

assert.equal(INSTAGRAM_RECIPES.length, 5);
const guide = applyInstagramRecipe("guide", "Azienda", "");
assert.equal(guide.format, "CAROUSEL");
assert.deepEqual(guide.providers, ["INSTAGRAM"]);
assert.match(guide.topic, /Azienda/);
assert.match(guide.objective, /fatti verificati/);
assert.equal(applyInstagramRecipe("question", "Azienda", "Tema scelto").topic, "Tema scelto");
assert.equal(applyInstagramRecipe("question", "Azienda").format, "STORY");

const fine = instagramDraftPreflight(sample);
assert.equal(fine.blockingIssues.length, 0);
assert.equal(fine.warnings.length, 0);
assert.ok(fine.preview.startsWith("Come funziona?"));
assert.ok(fine.caption.includes("#attivita"));

const tooLong = instagramDraftPreflight({ ...sample, caption: "x".repeat(2201) });
assert.match(tooLong.blockingIssues.join(" "), /2.200 caratteri/);
const duplicate = instagramDraftPreflight({ ...sample, hashtags: ["#Casa", "casa", "#altro", "#a", "#b", "#c"] });
assert.match(duplicate.warnings.join(" "), /5 hashtag/);
assert.match(duplicate.warnings.join(" "), /ripetuti/);
const carousel = instagramDraftPreflight({ ...sample, format: "CAROUSEL", carouselSlides: [] });
assert.match(carousel.blockingIssues.join(" "), /4 a 10 slide/);
assert.deepEqual(instagramDraftPreflight({ ...sample, provider: "FACEBOOK" }).blockingIssues, []);

const composer = readFileSync(new URL("../src/components/manual-content-composer.tsx", import.meta.url), "utf8");
assert.match(composer, /INSTAGRAM_RECIPES\.map/);
assert.match(composer, /applyInstagramRecipe\(recipe\.id/);
assert.match(composer, /instagramDraftPreflight\(variant\)/);
assert.match(composer, /Anteprima caption e controllo Instagram/);
assert.match(composer, /setProviders\(\["INSTAGRAM"\]\)/);

console.log("Instagram Creator Toolkit: PASS — recipes, preview, caption checks and composer integration.");
