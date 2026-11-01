import { generateOpenAIImage, type GenerateImageOptions, type OpenAIImageResult } from "./openai-image.js";

/** Multi-slide API image generation. Caller must reserve and settle a VERIFIED budget before invoking. */
export type AiCarouselScene = { headline: string; visualBrief: string; subheadline?: string };
export type AiCarouselResult = { slides: OpenAIImageResult[]; count: number };

export async function generateAiCarousel(input: {
  scenes: AiCarouselScene[];
  imageOptions: Omit<GenerateImageOptions, "format" | "visualBrief" | "typography">;
  /** A durable reservation from the shared monthly API budget. */
  budgetReservationId: string;
  /** Fail closed unless the pricing/model contract has been independently verified. */
  verifiedPricing: boolean;
  /** Checks the reservation before EACH external paid call. */
  authorizeSlide: (reservationId: string, index: number) => Promise<boolean>;
  /** Persist each result immediately so partial work is not lost. */
  saveSlide: (index: number, result: OpenAIImageResult) => Promise<void>;
}): Promise<AiCarouselResult> {
  if (input.scenes.length < 2 || input.scenes.length > 10) throw new Error("CAROUSEL_INVALID_SLIDE_COUNT");
  if (!input.verifiedPricing) throw new Error("IMAGE_API_PRICING_UNVERIFIED");
  if (!input.budgetReservationId.trim()) throw new Error("CAROUSEL_BUDGET_RESERVATION_REQUIRED");
  if (input.scenes.some((s) => !s.headline.trim() || !s.visualBrief.trim())) throw new Error("CAROUSEL_INVALID_SCENE");
  const slides: OpenAIImageResult[] = [];
  for (const [index, scene] of input.scenes.entries()) {
    if (!(await input.authorizeSlide(input.budgetReservationId, index))) throw new Error("CAROUSEL_BUDGET_DENIED");
    const result = await generateOpenAIImage({
      ...input.imageOptions,
      format: "CAROUSEL",
      visualBrief: `Slide ${index + 1}/${input.scenes.length}. ${scene.visualBrief}`,
      typography: { brand: input.imageOptions.profileName, headline: scene.headline, subheadline: scene.subheadline },
    });
    await input.saveSlide(index, result);
    slides.push(result);
  }
  return { slides, count: slides.length };
}
