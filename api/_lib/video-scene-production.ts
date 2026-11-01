import { generateSceneImages, type ImageGenerationSettings, type SceneImage } from "./video-image-generator.js";
import type { VideoPlan } from "./video-studio.js";

export type SceneProduction = {
  plan: VideoPlan;
  images: SceneImage[];
  missingSceneIds: string[];
  readyForLocalRender: boolean;
};

/** Fail closed: production cannot claim a complete Reel when any scene lacks a visual. */
export async function produceVideoSceneAssets(
  plan: VideoPlan,
  settings: ImageGenerationSettings,
  existingImages: SceneImage[] = []
): Promise<SceneProduction> {
  if (plan.status !== "DRAFT") throw new Error("VIDEO_PLAN_NOT_DRAFT");
  if (plan.scenes.length === 0 || plan.scenes.some(s => !s.id)) throw new Error("INVALID_SCENES");
  const generated = await generateSceneImages(plan, settings);
  const imageMap = new Map(existingImages.map(image => [image.sceneId, image]));
  for (const image of generated) imageMap.set(image.sceneId, image);
  const missingSceneIds = plan.scenes.filter(scene => !imageMap.has(scene.id)).map(scene => scene.id);
  return { plan, images: [...imageMap.values()], missingSceneIds, readyForLocalRender: missingSceneIds.length === 0 };
}
