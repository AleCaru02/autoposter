import assert from "node:assert/strict";
import { buildGeminiImagePrompt, estimateGeminiImageCostUsd, generateGeminiImage, geminiAspectRatioForFormat } from "../api/_lib/gemini-image.js";

assert.equal(geminiAspectRatioForFormat("POST"), "1:1");
assert.equal(geminiAspectRatioForFormat("CAROUSEL"), "1:1");
assert.equal(geminiAspectRatioForFormat("STORY"), "9:16");
assert.ok(estimateGeminiImageCostUsd("gemini-3.1-flash-image", 100) < estimateGeminiImageCostUsd("gemini-3-pro-image", 100));

const prompt = buildGeminiImagePrompt({
  profileName: "QA Property",
  industry: "Property management",
  tone: "Professionale",
  provider: "INSTAGRAM",
  format: "POST",
  visualBrief: "Interno luminoso e ordinato",
  caption: "Gestione professionale degli affitti brevi",
  additionalDirection: null,
});
assert.match(prompt, /Template Engine/);
assert.match(prompt, /Non inventare loghi, clienti/);

let capturedUrl = "";
let capturedBody: Record<string, any> = {};
let capturedHeaders: HeadersInit | undefined;
const fetcher: typeof fetch = async (input, init) => {
  capturedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  capturedBody = JSON.parse(String(init?.body ?? "{}"));
  capturedHeaders = init?.headers;
  return new Response(JSON.stringify({
    id: "interaction-test",
    output_image: { data: Buffer.from("fake-gemini-image").toString("base64"), mime_type: "image/png" },
    usage: { input_tokens: 120, output_tokens: 0, total_tokens: 120 },
  }), {
    status: 200,
    headers: { "content-type": "application/json", "x-goog-request-id": "google-req-1" },
  });
};

const result = await generateGeminiImage({
  apiKey: "gemini-test-key",
  model: "gemini-3.1-flash-image",
  profileName: "QA Property",
  industry: "Property management",
  tone: "Professionale",
  provider: "INSTAGRAM",
  format: "POST",
  visualBrief: "Interno luminoso e ordinato",
  caption: "Gestione professionale degli affitti brevi",
  fetcher,
});

assert.equal(capturedUrl, "https://generativelanguage.googleapis.com/v1beta/interactions");
assert.equal(new Headers(capturedHeaders).get("x-goog-api-key"), "gemini-test-key");
assert.equal(capturedBody.model, "gemini-3.1-flash-image");
assert.equal(capturedBody.response_format.type, "image");
assert.equal(capturedBody.response_format.aspect_ratio, "1:1");
assert.equal(capturedBody.response_format.image_size, "1K");
assert.equal(JSON.stringify(capturedBody).includes("gemini-test-key"), false);
assert.equal(result.provider, "GOOGLE");
assert.equal(result.model, "gemini-3.1-flash-image");
assert.equal(result.mimeType, "image/png");
assert.equal(Buffer.from(result.base64, "base64").toString(), "fake-gemini-image");
assert.equal(result.requestId, "google-req-1");
assert.equal(result.technicalEvents[0]?.model, "gemini-3.1-flash-image");
assert.equal(result.usage.estimatedCostUsd, estimateGeminiImageCostUsd("gemini-3.1-flash-image", 120));

console.log("Gemini image provider contract: PASS");
