import type { VideoPlan } from "./video-studio.js";

export type SceneImage = { sceneId: string; base64: string; mimeType: "image/png" };
export type ImageGenerationSettings = {
  apiKey: string;
  enabled: boolean;
  monthlyLimitEur: number;
  spentEur: number;
  estimatedEurPerImage: number;
  fetcher?: typeof fetch;
};

export async function generateSceneImages(plan: VideoPlan, settings: ImageGenerationSettings): Promise<SceneImage[]> {
  const scenes = plan.scenes;
  if (!settings.enabled) throw new Error("IMAGE_GENERATION_DISABLED");
  if (!settings.apiKey) throw new Error("IMAGE_API_KEY_MISSING");
  if (![settings.monthlyLimitEur, settings.spentEur, settings.estimatedEurPerImage].every(value => Number.isFinite(value) && value >= 0)) throw new Error("INVALID_BUDGET");
  if (settings.monthlyLimitEur > 30 || settings.estimatedEurPerImage === 0 || settings.spentEur + scenes.length * settings.estimatedEurPerImage > settings.monthlyLimitEur) throw new Error("IMAGE_BUDGET_EXCEEDED");
  const fetcher = settings.fetcher ?? fetch;
  const images: SceneImage[] = [];
  for (const scene of scenes) {
    const response = await fetcher("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: "Bearer " + settings.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-image-2.5-flare",
        quality: "low",
        size: "1024x1536",
        n: 1,
        prompt: "Vertical photorealistic professional B-roll, no text, no logos, no recognizable people. Subject: " + plan.title + ". Scene: " + scene.narration
      })
    });
    if (!response.ok) throw new Error("IMAGE_PROVIDER_ERROR_" + response.status);
    const body = await response.json() as { data?: Array<{ b64_json?: string }> };
    const base64 = body.data?.[0]?.b64_json;
    if (!base64) throw new Error("IMAGE_PROVIDER_EMPTY_RESULT");
    images.push({ sceneId: scene.id, base64, mimeType: "image/png" });
  }
  return images;
}
