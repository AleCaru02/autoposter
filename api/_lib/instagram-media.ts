/**
 * Strict server-side checks for Meta Instagram Content Publishing.
 * Validation is duplicated at the remote-write boundary intentionally: a
 * browser-side preview is never proof that an asset can be published.
 */
export type InstagramPublishImage = {
  position: number;
  asset_id: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  qa_status: string | null;
  asset_quality_status: string | null;
  asset_identity_status: string | null;
  alt_text?: string | null;
};

export function validateInstagramPublishImage(asset: InstagramPublishImage): string | null {
  if (!asset.asset_id) return "INSTAGRAM_ASSET_MISSING";
  if (asset.qa_status !== "PASS") return "INSTAGRAM_ASSET_QA_NOT_APPROVED";
  if (asset.asset_quality_status !== "PASS") return "INSTAGRAM_ASSET_QUALITY_NOT_APPROVED";
  if (asset.asset_identity_status !== "PASS" && asset.asset_identity_status !== "NOT_REQUIRED") return "INSTAGRAM_ASSET_IDENTITY_NOT_APPROVED";
  if ((asset.mime_type ?? "").split(";")[0].trim().toLowerCase() !== "image/jpeg") return "INSTAGRAM_ASSET_JPEG_REQUIRED";
  const w = Number(asset.width);
  const h = Number(asset.height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return "INSTAGRAM_ASSET_DIMENSIONS_REQUIRED";
  if (w * h > 100_000_000) return "INSTAGRAM_ASSET_DIMENSIONS_EXCESSIVE";
  const ratio = w / h;
  if (ratio < 0.8 - 0.0001 || ratio > 1.91 + 0.0001) return "INSTAGRAM_ASSET_ASPECT_RATIO_UNSUPPORTED";
  return null;
}

export function validateInstagramCarousel(slides: readonly InstagramPublishImage[]) {
  if (slides.length < 4 || slides.length > 10) throw new Error("INSTAGRAM_CAROUSEL_SLIDE_COUNT_INVALID");
  const seen = new Set<string>();
  let firstRatio: number | null = null;
  for (let index = 0; index < slides.length; index++) {
    const slide = slides[index];
    if (!slide || slide.position !== index + 1) throw new Error("INSTAGRAM_CAROUSEL_SLIDE_ORDER_INVALID");
    const issue = validateInstagramPublishImage(slide);
    if (issue) throw new Error(issue);
    if (seen.has(slide.asset_id!)) throw new Error("INSTAGRAM_CAROUSEL_DUPLICATE_IMAGE");
    seen.add(slide.asset_id!);
    const ratio = Number(slide.width) / Number(slide.height);
    if (firstRatio !== null && Math.abs(firstRatio - ratio) > 0.015) throw new Error("INSTAGRAM_CAROUSEL_MIXED_ASPECT_RATIOS");
    firstRatio = ratio;
  }
  return slides.map(slide => slide.asset_id!);
}

export function assertInstagramCaption(caption: string) {
  if (Array.from(caption).length > 2200) throw new Error("INSTAGRAM_CAPTION_TOO_LONG");
  if (!caption.trim()) throw new Error("INSTAGRAM_CAPTION_EMPTY");
}

export function instagramCarouselChildForm(url: string, token: string, alt?: string | null) {
  const form = new URLSearchParams({ image_url: url, access_token: token, is_carousel_item: "true" });
  if (alt?.trim()) form.set("alt_text", alt.trim().slice(0, 100));
  return form;
}

export function instagramCarouselParentForm(children: readonly string[], caption: string, token: string) {
  if (children.length < 4 || children.length > 10 || children.some(child => !/^\\d+$/.test(child))) throw new Error("INSTAGRAM_CAROUSEL_CONTAINER_IDS_INVALID");
  assertInstagramCaption(caption);
  return new URLSearchParams({ media_type: "CAROUSEL", children: children.join(","), caption, access_token: token });
}
