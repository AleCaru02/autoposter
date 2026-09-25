import assert from "node:assert/strict";
import {
  buildGeminiImagePrompt,
  generateGeminiImage,
  geminiImageModelForTier,
  geminiImagePlacement,
} from "../api/_lib/gemini-image.js";

assert.equal(geminiImageModelForTier("STANDARD"), "gemini-3.1-flash-image");
assert.equal(geminiImageModelForTier("PREMIUM"), "gemini-3-pro-image");
assert.deepEqual(geminiImagePlacement("INSTAGRAM", "STORY"), { aspectRatio: "9:16", imageSize: "1K" });
assert.deepEqual(geminiImagePlacement("INSTAGRAM", "POST"), { aspectRatio: "4:5", imageSize: "1K" });
assert.deepEqual(geminiImagePlacement("LINKEDIN", "POST"), { aspectRatio: "1:1", imageSize: "1K" });

const prompt = buildGeminiImagePrompt({
  tier: "STANDARD",
  profileName: "Brand",
  industry: "Property management",
  tone: "professionale",
  provider: "INSTAGRAM",
  format: "POST",
  visualBrief: "Appartamento moderno",
  caption: "Contenuto editoriale",
  additionalDirection: null,
});
assert.match(prompt, /Template Engine software/);
assert.match(prompt, /Non incorporare testo/);

let capturedUrl = "";
let capturedBody: any = null;
const result = await generateGeminiImage({
  apiKey: "gemini-test",
  tier: "STANDARD",
  profileName: "Brand",
  industry: "Property management",
  tone: "professionale",
  provider: "INSTAGRAM",
  format: "POST",
  visualBrief: "Appartamento moderno e luminoso",
  fetcher: async (url, init) => {
    capturedUrl = String(url);
    capturedBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "a".repeat(200) } }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 },
    }), { status: 200, headers: { "content-type": "application/json", "x-goog-request-id": "g-1" } });
  },
});
assert.match(capturedUrl, /gemini-3\.1-flash-image:generateContent$/);
assert.deepEqual(capturedBody.generationConfig.responseModalities, ["IMAGE"]);
assert.equal(capturedBody.generationConfig.imageConfig.aspectRatio, "4:5");
assert.equal(capturedBody.generationConfig.imageConfig.imageSize, "1K");
assert.equal(result.model, "gemini-3.1-flash-image");
assert.equal(result.provider, "GOOGLE");
assert.equal(result.mimeType, "image/png");
assert.ok((result.usage.estimatedCostUsd ?? 0) >= 0.067);
assert.equal(result.technicalEvents[0]?.operation, "GENERATE_SOCIAL_IMAGE");

const premium = await generateGeminiImage({
  apiKey: "gemini-test",
  tier: "PREMIUM",
  profileName: "Brand",
  industry: null,
  tone: null,
  provider: "GBP",
  format: "POST",
  visualBrief: "Visual premium",
  fetcher: async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    assert.equal(body.generationConfig.imageConfig.imageSize, "2K");
    return Response.json({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/jpeg", data: "b".repeat(200) } }] } }],
      usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10, totalTokenCount: 60 },
    });
  },
});
assert.equal(premium.model, "gemini-3-pro-image");
assert.ok((premium.usage.estimatedCostUsd ?? 0) >= 0.134);

console.log("Gemini image provider adapter: PASS");
