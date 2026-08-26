import { neonClient } from "../../lib/neon-client";
import type { GeneratedSocialContent } from "../../../api/_lib/openai-text";

export type ApprovalStatus = "PENDING" | "APPROVED" | "CHANGES_REQUESTED";
export type ContentStatus = "IN_REVIEW" | "APPROVED" | "CHANGES_REQUESTED";

export type ContentItemRow = {
  id: string;
  profile_id: string;
  topic: string;
  objective: string | null;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ContentVariantRow = {
  id: string;
  content_id: string;
  profile_id: string;
  provider: string;
  format: string;
  eligible: boolean;
  hook: string | null;
  caption: string;
  cta: string | null;
  hashtags: string[];
  visual_brief: string | null;
  image_asset_id: string | null;
  alt_text: string | null;
  approval_status: ApprovalStatus;
  created_at: string;
  updated_at: string;
};

export type AssetRow = {
  id: string;
  profile_id: string;
  source: string;
  kind: string;
  name: string;
  storage_url: string;
  mime_type: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type SavedGeneration = {
  contentId: string;
  variantIds: Record<string, string>;
};

export function variantKey(provider: string, format: string, index: number) {
  return `${provider}-${format}-${index}`;
}

export function deriveContentStatus(statuses: ApprovalStatus[]): ContentStatus {
  if (statuses.length > 0 && statuses.every((status) => status === "APPROVED")) return "APPROVED";
  if (statuses.some((status) => status === "CHANGES_REQUESTED")) return "CHANGES_REQUESTED";
  return "IN_REVIEW";
}

export function normalizeHashtags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean).slice(0, 30);
}

export async function saveGeneratedContent(input: {
  profileId: string;
  topic: string;
  objective: string | null;
  content: GeneratedSocialContent;
}): Promise<SavedGeneration> {
  const contentId = crypto.randomUUID();
  const now = new Date().toISOString();
  const variantRows = input.content.variants.map((variant, index) => ({
    id: crypto.randomUUID(),
    content_id: contentId,
    profile_id: input.profileId,
    provider: variant.provider,
    format: variant.format,
    eligible: variant.eligible,
    hook: variant.hook,
    caption: variant.caption,
    cta: variant.cta,
    hashtags: variant.hashtags,
    visual_brief: variant.visualBrief,
    alt_text: variant.altText,
    approval_status: "PENDING" as ApprovalStatus,
    updated_at: now,
    _key: variantKey(variant.provider, variant.format, index),
  }));

  const item = await neonClient.from("content_items").insert({
    id: contentId,
    profile_id: input.profileId,
    topic: input.topic.trim(),
    objective: input.objective?.trim() || null,
    title: input.content.strategySummary.slice(0, 240),
    status: "IN_REVIEW",
    updated_at: now,
  }).select("id").single();
  if (item.error || !item.data) throw new Error(item.error?.message ?? "Impossibile salvare il contenuto.");

  const payload = variantRows.map(({ _key, ...row }) => row);
  const variants = await neonClient.from("content_variants").insert(payload).select("id,provider,format");
  if (variants.error) {
    await neonClient.from("content_items").delete().eq("id", contentId).eq("profile_id", input.profileId);
    throw new Error(variants.error.message);
  }

  return {
    contentId,
    variantIds: Object.fromEntries(variantRows.map((row) => [row._key, row.id])),
  };
}

export async function loadContentWorkflow(profileId: string) {
  const [itemsResult, variantsResult, assetsResult] = await Promise.all([
    neonClient.from("content_items").select("id,profile_id,topic,objective,title,status,created_at,updated_at").eq("profile_id", profileId).order("updated_at", { ascending: false }),
    neonClient.from("content_variants").select("id,content_id,profile_id,provider,format,eligible,hook,caption,cta,hashtags,visual_brief,image_asset_id,alt_text,approval_status,created_at,updated_at").eq("profile_id", profileId).order("created_at", { ascending: true }),
    neonClient.from("assets").select("id,profile_id,source,kind,name,storage_url,mime_type,metadata,created_at").eq("profile_id", profileId).eq("kind", "IMAGE").order("created_at", { ascending: false }),
  ]);
  if (itemsResult.error) throw new Error(itemsResult.error.message);
  if (variantsResult.error) throw new Error(variantsResult.error.message);
  if (assetsResult.error) throw new Error(assetsResult.error.message);
  return {
    items: (itemsResult.data ?? []) as ContentItemRow[],
    variants: ((variantsResult.data ?? []) as Omit<ContentVariantRow, "hashtags">[] & { hashtags?: unknown }).map((row) => ({ ...row, hashtags: normalizeHashtags(row.hashtags) })) as ContentVariantRow[],
    assets: (assetsResult.data ?? []) as AssetRow[],
  };
}

export async function updateVariant(input: {
  profileId: string;
  variantId: string;
  contentId: string;
  hook: string;
  caption: string;
  cta: string;
  hashtags: string[];
  visualBrief: string;
  altText: string;
}) {
  const now = new Date().toISOString();
  const result = await neonClient.from("content_variants").update({
    hook: input.hook.trim() || null,
    caption: input.caption.trim(),
    cta: input.cta.trim() || null,
    hashtags: normalizeHashtags(input.hashtags),
    visual_brief: input.visualBrief.trim() || null,
    alt_text: input.altText.trim() || null,
    approval_status: "PENDING",
    updated_at: now,
  }).eq("id", input.variantId).eq("profile_id", input.profileId).select("id").single();
  if (result.error) throw new Error(result.error.message);
  const parent = await neonClient.from("content_items").update({ status: "IN_REVIEW", updated_at: now }).eq("id", input.contentId).eq("profile_id", input.profileId).select("id").single();
  if (parent.error) throw new Error(parent.error.message);
}

export async function setVariantApproval(input: {
  profileId: string;
  variantId: string;
  contentId: string;
  approvalStatus: ApprovalStatus;
}) {
  const now = new Date().toISOString();
  const result = await neonClient.from("content_variants").update({ approval_status: input.approvalStatus, updated_at: now }).eq("id", input.variantId).eq("profile_id", input.profileId).select("id").single();
  if (result.error) throw new Error(result.error.message);
  const statusesResult = await neonClient.from("content_variants").select("approval_status").eq("content_id", input.contentId).eq("profile_id", input.profileId);
  if (statusesResult.error) throw new Error(statusesResult.error.message);
  const statuses = (statusesResult.data ?? []).map((row) => row.approval_status as ApprovalStatus);
  const status = deriveContentStatus(statuses);
  const parent = await neonClient.from("content_items").update({ status, updated_at: now }).eq("id", input.contentId).eq("profile_id", input.profileId).select("id").single();
  if (parent.error) throw new Error(parent.error.message);
  return status;
}

export async function deleteContent(profileId: string, contentId: string) {
  const result = await neonClient.from("content_items").delete().eq("id", contentId).eq("profile_id", profileId).select("id");
  if (result.error) throw new Error(result.error.message);
}
