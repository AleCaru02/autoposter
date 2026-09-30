import assert from "node:assert/strict";
import {
  platformCopyStrategyPrompt,
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

console.log("PASS social platform strategy: Instagram, Facebook, LinkedIn e GBP hanno logiche native separate.");
