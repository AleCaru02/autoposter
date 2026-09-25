import type { ImageSocialFormat, ImageSocialProvider } from "./openai-image.js";

export type ReusableAsset = {
  id: string;
  profile_id: string;
  source: string;
  kind: string;
  storage_url: string;
  mime_type: string | null;
  metadata: unknown;
  created_at?: string;
};

function normalized(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export function masterPlacementClass(provider: ImageSocialProvider, format: ImageSocialFormat) {
  if (format === "STORY") return "VERTICAL_9_16";
  if (provider === "INSTAGRAM" || provider === "FACEBOOK") return "FEED_4_5";
  return "SQUARE_1_1";
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function visualFingerprint(input: {
  profileId: string;
  provider: ImageSocialProvider;
  format: ImageSocialFormat;
  visualBrief: string;
  additionalDirection?: string | null;
}) {
  const placement = masterPlacementClass(input.provider, input.format);
  return sha256([
    "visual-master:v1",
    input.profileId,
    placement,
    normalized(input.visualBrief),
    normalized(input.additionalDirection),
  ].join("|"));
}

function metadata(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function findReusableAsset(rows: ReusableAsset[], fingerprint: string) {
  return rows.find((asset) => {
    if (asset.kind !== "IMAGE" || !asset.storage_url) return false;
    const meta = metadata(asset.metadata);
    return meta.visual_fingerprint === fingerprint
      && meta.reuse_allowed !== false
      && (asset.mime_type?.startsWith("image/") ?? true);
  }) ?? null;
}

export function assetReusePriority(asset: ReusableAsset) {
  const source = asset.source.toUpperCase();
  if (source.includes("UPLOAD") || source.includes("REAL") || source.includes("PHOTO")) return 0;
  if (source.includes("TEMPLATE")) return 1;
  if (source.includes("MASTER")) return 2;
  if (source.includes("GEMINI") || source.includes("OPENAI") || source.includes("AI_")) return 3;
  return 4;
}

export function rankReusableAssets(rows: ReusableAsset[]) {
  return [...rows].sort((a, b) => assetReusePriority(a) - assetReusePriority(b)
    || String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
}
