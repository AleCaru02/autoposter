import assert from "node:assert/strict";
import { generateOpenAIImage } from "../api/_lib/openai-image.js";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.log("SKIP OpenAI image live: OPENAI_API_KEY non configurata.");
  process.exit(0);
}

const result = await generateOpenAIImage({
  apiKey,
  profileName: "Post Automatici QA",
  industry: "Software",
  tone: "Pulito e professionale",
  provider: "INSTAGRAM",
  format: "POST",
  visualBrief: "Composizione astratta minimal di un calendario social e forme geometriche, nessun testo e nessun logo",
  caption: "Test tecnico di generazione immagine.",
});

assert.equal(result.model, "gpt-image-2");
assert.equal(result.quality, "high");
assert.equal(result.size, "1024x1024");
assert.ok(result.base64.length > 1_000, "l'API deve restituire dati immagine reali");
assert.equal(Buffer.from(result.base64, "base64").length > 1_000, true);
console.log(`PASS OpenAI image live: ${result.model}, quality=${result.quality}, size=${result.size}, immagine reale ricevuta.`);
