import { authClient, neonClient } from "../../lib/neon-client";
import type { GeneratedSocialContent } from "../../../api/_lib/openai-text";
import { normalizeHashtags, variantKey, type ApprovalStatus } from "./content-workflow";

export type { ApprovalStatus, ContentStatus } from "./content-workflow";

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

type JwtAuth = { getJWTToken?: () => Promise<string | null> };

type ReviewResponse = {
  variantId?: string;
  approvalStatus?: ApprovalStatus;
  contentStatus?: "IN_REVIEW" | "APPROVED" | "CHANGES_REQUESTED";
  updatedAt?: string;
  error?: string;
};

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
  const itemsResult = await neonClient.from("content_items")
    .select("id,profile_id,topic,objective,title,status,created_at,updated_at")
    .eq("profile_id", profileId)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (itemsResult.error) throw new Error(itemsResult.error.message);
  const items = (itemsResult.data ?? []) as ContentItemRow[];
  if (!items.length) return { items: [], variants: [] as ContentVariantRow[], assets: [] as AssetRow[] };

  const contentIds = items.map((item) => item.id);
  const variantsResult = await neonClient.from("content_variants")
    .select("id,content_id,profile_id,provider,format,eligible,hook,caption,cta,hashtags,visual_brief,image_asset_id,alt_text,approval_status,created_at,updated_at")
    .eq("profile_id", profileId)
    .in("content_id", contentIds)
    .order("created_at", { ascending: true });
  if (variantsResult.error) throw new Error(variantsResult.error.message);
  const rawVariants = (variantsResult.data ?? []) as Array<Omit<ContentVariantRow, "hashtags"> & { hashtags: unknown }>;
  const variants = rawVariants.map((row) => ({ ...row, hashtags: normalizeHashtags(row.hashtags) })) as ContentVariantRow[];

  const assetIds = Array.from(new Set(variants.map((variant) => variant.image_asset_id).filter((id): id is string => typeof id === "string" && Boolean(id))));
  let assets: AssetRow[] = [];
  if (assetIds.length) {
    const assetsResult = await neonClient.from("assets")
      .select("id,profile_id,source,kind,name,storage_url,mime_type,metadata,created_at")
      .eq("profile_id", profileId)
      .in("id", assetIds);
    if (assetsResult.error) throw new Error(assetsResult.error.message);
    assets = (assetsResult.data ?? []) as AssetRow[];
  }

  return { items, variants, assets };
}

export async function reviewVariant(input: {
  profileId: string;
  variantId: string;
  contentId: string;
  expectedUpdatedAt: string;
  hook: string;
  caption: string;
  cta: string;
  hashtags: string[];
  visualBrief: string;
  altText: string;
  approvalStatus: ApprovalStatus;
}) {
  const token = await (authClient as typeof authClient & JwtAuth).getJWTToken?.();
  if (!token) throw new Error("Sessione non valida: effettua nuovamente l’accesso.");
  const response = await fetch("/api/content-review", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ ...input, hashtags: normalizeHashtags(input.hashtags) }),
  });
  const body = await response.json() as ReviewResponse;
  if (!response.ok || !body.variantId || !body.approvalStatus || !body.contentStatus || !body.updatedAt) {
    if (response.status === 409) throw new Error("Il contenuto è stato modificato in un’altra sessione. Aggiorna la pagina prima di continuare.");
    if (response.status === 403 || response.status === 404) throw new Error("Non puoi modificare questo contenuto.");
    throw new Error("Revisione non salvata. Riprova.");
  }
  return { approvalStatus: body.approvalStatus, contentStatus: body.contentStatus, updatedAt: body.updatedAt };
}

export async function deleteContent(profileId: string, contentId: string) {
  const variantAssets = await neonClient.from("content_variants").select("image_asset_id").eq("content_id", contentId).eq("profile_id", profileId);
  if (variantAssets.error) throw new Error(variantAssets.error.message);
  const assetIds = (variantAssets.data ?? []).map((row) => row.image_asset_id).filter((id): id is string => typeof id === "string" && Boolean(id));

  const result = await neonClient.from("content_items").delete().eq("id", contentId).eq("profile_id", profileId).select("id");
  if (result.error) throw new Error(result.error.message);
  if (assetIds.length) {
    const assetDelete = await neonClient.from("assets").delete().eq("profile_id", profileId).in("id", assetIds);
    if (assetDelete.error) throw new Error(assetDelete.error.message);
  }
}
