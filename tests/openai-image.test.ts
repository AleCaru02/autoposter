import assert from "node:assert/strict";
import { buildImagePrompt, estimateImageCostUsd, generateOpenAIImage, imageSizeForFormat } from "../api/_lib/openai-image.js";
import { estimateTerraCostUsd } from "../api/_lib/openai-text.js";

const calls: Array<{ url: string; body: Record<string, any>; headers: Record<string, string> }> = [];
const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
  const resolved = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
  calls.push({ url: resolved, body, headers: init?.headers as Record<string, string> });
  if (resolved.endsWith("/v1/responses")) {
    return new Response(JSON.stringify({
      id: "resp_media_test",
      model: "gpt-5.6-terra",
      output_text: JSON.stringify({
        visualIntent: "Trasmettere ordine e professionalità",
        composition: "Ambiente luminoso con punto focale centrale",
        subject: "Interno ordinato di un appartamento contemporaneo",
        environment: "Spazio realistico, pulito e abitabile",
        style: "Fotografia editoriale credibile e premium",
        imagePrompt: "PROMPT MEDIA MANAGER: interno luminoso, realistico, ordinato, composizione quadrata professionale, nessun testo o logo",
        altText: "Interno luminoso e ordinato di un appartamento",
        avoid: ["testo", "loghi", "watermark"],
      }),
      usage: { input_tokens: 100, output_tokens: 80, total_tokens: 180 },
    }), { status: 200, headers: { "x-request-id": "req_media_test", "content-type": "application/json" } });
  }
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

assert.equal(calls.length, 2, "ogni immagine effettiva deve passare prima dal Media Manager e poi da gpt-image-2");
assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
assert.equal(calls[0].body.model, "gpt-5.6-terra");
assert.equal(calls[0].body.store, false);
assert.equal(calls[0].body.reasoning.effort, "low");
assert.equal("tools" in calls[0].body, false, "Media Manager non deve spendere per web search");
assert.equal(calls[1].url, "https://api.openai.com/v1/images/generations");
assert.equal(calls[1].headers.authorization, "Bearer sk-image-test-only");
assert.equal(calls[1].body.model, "gpt-image-2", "i pixel devono essere generati esclusivamente da gpt-image-2");
assert.equal(calls[1].body.quality, "high");
assert.equal(calls[1].body.size, "1024x1024");
assert.equal(calls[1].body.n, 1);
assert.equal(calls[1].body.output_format, "png");
assert.match(calls[1].body.prompt, /PROMPT MEDIA MANAGER/);
assert.equal(JSON.stringify(calls.map((call) => call.body)).includes("sk-image-test-only"), false, "la chiave non deve entrare nei body/prompt");

const mediaCost = estimateTerraCostUsd(100, 80);
const imageCost = estimateImageCostUsd(50, 1200);
assert.equal(result.model, "gpt-image-2");
assert.equal(result.mediaManager.model, "gpt-5.6-terra");
assert.equal(result.mediaManager.responseId, "resp_media_test");
assert.equal(result.mediaManager.requestId, "req_media_test");
assert.equal(result.quality, "high");
assert.equal(result.mimeType, "image/png");
assert.equal(result.requestId, "req_image_test");
assert.equal(Buffer.from(result.base64, "base64").toString(), "fake-png");
assert.equal(imageCost, 0.03625);
assert.equal(result.usage.mediaManagerCostUsd, mediaCost);
assert.equal(result.usage.inputTokens, 150);
assert.equal(result.usage.outputTokens, 1280);
assert.equal(result.usage.totalTokens, 1430);
assert.equal(result.usage.estimatedCostUsd, imageCost + mediaCost);

console.log("PASS OpenAI image contract: Media Manager OpenAI precede esclusivamente gpt-image-2; qualità high e costo totale tracciato.");
