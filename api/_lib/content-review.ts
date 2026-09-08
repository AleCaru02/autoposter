import { neon } from "@neondatabase/serverless";

export type ContentReviewStatus = "PENDING" | "APPROVED" | "CHANGES_REQUESTED";

export type ContentReviewInput = {
  profileId: string;
  contentId: string;
  variantId: string;
  expectedUpdatedAt: string;
  hook: string;
  caption: string;
  cta: string;
  hashtags: string[];
  visualBrief: string;
  altText: string;
  approvalStatus: ContentReviewStatus;
};

export type ContentReviewResult = {
  variantId: string;
  approvalStatus: ContentReviewStatus;
  contentStatus: "IN_REVIEW" | "APPROVED" | "CHANGES_REQUESTED";
  updatedAt: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVIEW_STATUSES = new Set<ContentReviewStatus>(["PENDING", "APPROVED", "CHANGES_REQUESTED"]);

function normalizedInput(input: ContentReviewInput) {
  if (!input || typeof input !== "object") throw new Error("CONTENT_REVIEW_INPUT_INVALID");
  if (typeof input.profileId !== "string" || typeof input.contentId !== "string" || typeof input.variantId !== "string") throw new Error("CONTENT_REVIEW_INPUT_INVALID");
  if (!UUID.test(input.profileId) || !UUID.test(input.contentId) || !UUID.test(input.variantId)) throw new Error("CONTENT_REVIEW_INPUT_INVALID");
  if (typeof input.expectedUpdatedAt !== "string" || Number.isNaN(Date.parse(input.expectedUpdatedAt))) throw new Error("CONTENT_REVIEW_INPUT_INVALID");
  if (typeof input.approvalStatus !== "string" || !REVIEW_STATUSES.has(input.approvalStatus) || typeof input.caption !== "string" || !input.caption.trim()) throw new Error("CONTENT_REVIEW_INPUT_INVALID");
  if (![input.hook, input.cta, input.visualBrief, input.altText].every((value) => typeof value === "string") || !Array.isArray(input.hashtags) || !input.hashtags.every((tag) => typeof tag === "string")) throw new Error("CONTENT_REVIEW_INPUT_INVALID");
  return {
    ...input,
    hook: input.hook.trim(),
    caption: input.caption.trim(),
    cta: input.cta.trim(),
    hashtags: input.hashtags.map((tag) => tag.trim()).filter(Boolean).slice(0, 30),
    visualBrief: input.visualBrief.trim(),
    altText: input.altText.trim(),
  };
}

export async function reviewContentVariant(databaseUrl: string, authUserId: string, rawInput: ContentReviewInput): Promise<ContentReviewResult> {
  if (!authUserId.trim()) throw new Error("CONTENT_REVIEW_UNAUTHENTICATED");
  const input = normalizedInput(rawInput);
  const sql = neon(databaseUrl);
  const rows = await sql`
    select variant_id::text, approval_status, content_status, updated_at::text
    from public.review_content_variant(
      ${authUserId},
      ${input.profileId}::uuid,
      ${input.contentId}::uuid,
      ${input.variantId}::uuid,
      ${input.expectedUpdatedAt}::timestamptz,
      ${input.hook},
      ${input.caption},
      ${input.cta},
      ${JSON.stringify(input.hashtags)}::jsonb,
      ${input.visualBrief},
      ${input.altText},
      ${input.approvalStatus}
    )
  ` as unknown as Array<{ variant_id: string; approval_status: ContentReviewStatus; content_status: ContentReviewResult["contentStatus"]; updated_at: string }>;
  const result = rows[0];
  if (!result) throw new Error("CONTENT_REVIEW_FAILED");
  return { variantId: result.variant_id, approvalStatus: result.approval_status, contentStatus: result.content_status, updatedAt: result.updated_at };
}
