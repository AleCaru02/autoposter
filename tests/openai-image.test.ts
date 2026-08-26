import assert from "node:assert/strict";
import { buildImagePrompt, estimateImageCostUsd, generateOpenAIImage, imageSizeForFormat } from "../api/_lib/openai-image.js";

let capturedUrl = "";
let capturedInit: RequestInit | undefined;
const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
  capturedUrl = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
  capturedInit = init;
  return new Response(JSON.stringify({ created: 1, data: [{ b64_json: Buffer.from("fake-png").toString("base64"), revised_prompt: "Professional property image" }], usage: { input_tokens: 50, output_tokens: 1200, total_tokens: 1250 } }), { status: 200, headers: { "x-request-id": "req_image_test", "content-type": "application/json" } });
}) as typeof fetch;

assert.equal(imageSizeForFormat("POST"), "1024x1024");
assert.equal(imageSizeForFormat("CAROUSEL"), "1024x1024");
assert.equal(imageSizeForFormat("STORY"), "1024x1536");

const prompt = buildImagePrompt({ profileName: "QA Property", industry: "Property management", tone: "Professionale", provider: "INSTAGRAM", format: "POST", visualBrief: "Appartamento luminoso e ordinato", caption: "Gestione professionale degli affitti brevi.", additionalDirection: null });
assert.ok(prompt.includes("Appartamento luminoso"));
assert.ok(prompt.includes("Non aggiungere testo, loghi"));
assert.ok(prompt.toLowerCase().includes("senza affermare fatti nuovi"));

const result = await generateOpenAIImage({ apiKey: "sk-image-test-only", profileName: "QA Property", industry: "Property management", tone: "Professionale", provider: "INSTAGRAM", format: "POST", visualBrief: "Appartamento luminoso e ordinato", caption: "Gestione professionale degli affitti brevi.", fetcher });

assert.equal(capturedUrl, "https://api.openai.com/v1/images/generations");
assert.equal((capturedInit?.headers as Record<string, string>).authorization, "Bearer sk-image-test-only");
const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
assert.equal(body.model, "gpt-image-2", "deve essere usato esclusivamente GPT-Image-2");
assert.equal(body.quality, "high", "la riduzione dei costi non deve abbassare la qualità finale");
assert.equal(body.size, "1024x1024");
assert.equal(body.n, 1, "una sola immagine per azione esplicita limita spesa e duplicazioni");
assert.equal(body.output_format, "png");
assert.equal(String(capturedInit?.body).includes("sk-image-test-only"), false, "la chiave non deve entrare nel prompt/body");
assert.equal(result.model, "gpt-image-2");
assert.equal(result.quality, "high");
assert.equal(result.mimeType, "image/png");
assert.equal(result.requestId, "req_image_test");
assert.equal(Buffer.from(result.base64, "base64").toString(), "fake-png");
assert.equal(estimateImageCostUsd(50, 1200), 0.03625);
assert.deepEqual(result.usage, { inputTokens: 50, outputTokens: 1200, totalTokens: 1250, estimatedCostUsd: 0.03625 });

console.log("PASS OpenAI image contract: esclusivamente gpt-image-2, qualità high, una immagine per richiesta, costo da usage tracciato.");
