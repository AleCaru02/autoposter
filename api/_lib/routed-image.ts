import type { ActivityBudgetPreflight } from "./activity-budget.js";
import type { ContentImportance } from "./ai-brain-policy.js";
import { generateGeminiImage, type GeminiImageResult } from "./gemini-image.js";
import { routeAiTask, type RouterEnvironment } from "./model-router.js";
import type { ImageSocialFormat, ImageSocialProvider } from "./openai-image.js";

export type RoutedImageOptions = {
  env: RouterEnvironment;
  budget: ActivityBudgetPreflight;
  importance?: ContentImportance;
  profileName: string;
  industry?: string | null;
  tone?: string | null;
  provider: ImageSocialProvider;
  format: ImageSocialFormat;
  visualBrief: string;
  caption?: string | null;
  additionalDirection?: string | null;
  reusableAssetAvailable?: boolean;
  difficultPhotoEditing?: boolean;
  fetcher?: typeof fetch;
};

export async function generateRoutedImage(options: RoutedImageOptions): Promise<GeminiImageResult> {
  const task = options.importance === "PREMIUM" || options.importance === "CRITICAL" ? "IMAGE_PREMIUM" : "IMAGE_STANDARD";
  const route = routeAiTask({
    task,
    importance: options.importance ?? "STANDARD",
    budget: options.budget,
    env: options.env,
    reusableAssetAvailable: options.reusableAssetAvailable,
    difficultPhotoEditing: options.difficultPhotoEditing,
  });
  if (route.status === "REUSE_ASSET") throw new Error("MODEL_ROUTER_REUSE_ASSET");
  if (route.status === "BLOCKED_BUDGET") throw new Error("MODEL_ROUTER_BLOCKED_BUDGET");
  if (route.status !== "READY" || !route.model?.apiModelId) throw new Error("MODEL_ROUTER_BLOCKED_PROVIDER");
  if (route.model.provider !== "GOOGLE" || !["gemini-3.1-flash-image", "gemini-3-pro-image"].includes(route.model.apiModelId)) {
    throw new Error("MODEL_ROUTER_IMAGE_ROUTE_UNSUPPORTED");
  }
  if (!options.env.GEMINI_API_KEY) throw new Error("MODEL_ROUTER_BLOCKED_PROVIDER");

  return generateGeminiImage({
    apiKey: options.env.GEMINI_API_KEY,
    model: route.model.apiModelId as "gemini-3.1-flash-image" | "gemini-3-pro-image",
    profileName: options.profileName,
    industry: options.industry,
    tone: options.tone,
    provider: options.provider,
    format: options.format,
    visualBrief: options.visualBrief,
    caption: options.caption,
    additionalDirection: options.additionalDirection,
    fetcher: options.fetcher,
  });
}
