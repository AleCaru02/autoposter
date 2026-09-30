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
  rejectedReason?: string | null;
};

export type ContentReviewResult = {
  variantId: string;
  approvalStatus: ContentReviewStatus;
  workflowStatus: "DRAFT" | "REVIEW" | "REVIEW_REQUIRED" | "APPROVED" | "REJECTED";
  contentStatus: "IN_REVIEW" | "APPROVED" | "CHANGES_REQUESTED";
  updatedAt: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVIEW_STATUSES = new Set<ContentReviewStatus>(["PENDING", "APPROVED", "CHANGES_REQUESTED"]);
export type ContentFeedbackCode =
  | "TOO_GENERIC" | "WRONG_TONE" | "BAD_VISUAL" | "TOO_SALESY" | "REPETITIVE"
  | "FACT_ERROR" | "IDENTITY_BAD" | "WRONG_CTA" | "WRONG_SUBJECT" | "USER_CUSTOM";

type PreviousVariant = {
  hook: string | null;
  caption: string | null;
  cta: string | null;
  hashtags: unknown;
  visual_brief: string | null;
  alt_text: string | null;
};

export function classifyContentFeedback(note: string | null | undefined, changed: {
  hook: boolean; caption: boolean; cta: boolean; hashtags: boolean; visualBrief: boolean; altText: boolean;
}): ContentFeedbackCode {
  const text = (note ?? "").normalize("NFKC").toLowerCase();
  if (/identit|volto|faccia|face|somigl|persona diversa/.test(text)) return "IDENTITY_BAD";
  if (/tono|tone|voce|stile di scrittura/.test(text)) return "WRONG_TONE";
  if (/visual|immagine|foto|grafica|composizione|colore|font/.test(text)) return "BAD_VISUAL";
  if (/generic|banal|superficial|vuoto/.test(text)) return "TOO_GENERIC";
  if (/troppo.{0,12}(vend|commercial)|salesy|aggressiv/.test(text)) return "TOO_SALESY";
  if (/ripet|gi[aà] visto|uguale|simile al post/.test(text)) return "REPETITIVE";
  if (/fatto|dato|fonte|fake|falso|inesatt|errore fatt/.test(text)) return "FACT_ERROR";
  if (/cta|call to action|invito all.?azione/.test(text)) return "WRONG_CTA";
  if (/soggetto|subject|persona sbagliata|prodotto sbagliato/.test(text)) return "WRONG_SUBJECT";
  if (changed.visualBrief || changed.altText) return "BAD_VISUAL";
  if (changed.cta && !changed.caption && !changed.hook) return "WRONG_CTA";
  return "USER_CUSTOM";
}

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
    rejectedReason: typeof input.rejectedReason === "string" ? input.rejectedReason.trim().slice(0, 1000) : null,
  };
}

export async function reviewContentVariant(databaseUrl: string, authUserId: string, rawInput: ContentReviewInput): Promise<ContentReviewResult> {
  if (!authUserId.trim()) throw new Error("CONTENT_REVIEW_UNAUTHENTICATED");
  const input = normalizedInput(rawInput);
  const sql = neon(databaseUrl);
  const previousRows = await sql`
    select hook,caption,cta,hashtags,visual_brief,alt_text
    from public.content_variants
    where id=${input.variantId}::uuid and content_id=${input.contentId}::uuid and profile_id=${input.profileId}::uuid
    limit 1
  ` as unknown as PreviousVariant[];
  const previous = previousRows[0] ?? null;
  const rows = await sql`
    select variant_id::text, approval_status, workflow_status, content_status, updated_at::text
    from public.review_content_variant_v2(
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
      ${input.approvalStatus},
      ${input.rejectedReason}
    )
  ` as unknown as Array<{ variant_id: string; approval_status: ContentReviewStatus; workflow_status: ContentReviewResult["workflowStatus"]; content_status: ContentReviewResult["contentStatus"]; updated_at: string }>;
  const result = rows[0];
  if (!result) throw new Error("CONTENT_REVIEW_FAILED");

  if (previous && input.approvalStatus !== "APPROVED") {
    const previousHashtags = Array.isArray(previous.hashtags) ? previous.hashtags : [];
    const changed = {
      hook: (previous.hook ?? "").trim() !== input.hook,
      caption: (previous.caption ?? "").trim() !== input.caption,
      cta: (previous.cta ?? "").trim() !== input.cta,
      hashtags: JSON.stringify(previousHashtags) !== JSON.stringify(input.hashtags),
      visualBrief: (previous.visual_brief ?? "").trim() !== input.visualBrief,
      altText: (previous.alt_text ?? "").trim() !== input.altText,
    };
    const edited = Object.values(changed).some(Boolean);
    if (input.approvalStatus === "CHANGES_REQUESTED" || edited) {
      const feedbackCode = classifyContentFeedback(input.rejectedReason, changed);
      const weight = input.approvalStatus === "CHANGES_REQUESTED" ? 1 : 0.35;
      try {
        await sql`
          insert into public.content_feedback_events(profile_id,content_id,variant_id,feedback_code,note,weight,source)
          values(
            ${input.profileId}::uuid,${input.contentId}::uuid,${input.variantId}::uuid,
            ${feedbackCode},${input.rejectedReason || null},${weight},'USER'
          )
        `;
      } catch (reason) {
        console.error("content-feedback-persist-failed", {
          profileId: input.profileId,
          variantId: input.variantId,
          code: feedbackCode,
          error: reason instanceof Error ? reason.message.slice(0,120) : "unknown",
        });
      }
    }
  }

  return { variantId: result.variant_id, approvalStatus: result.approval_status, workflowStatus: result.workflow_status, contentStatus: result.content_status, updatedAt: result.updated_at };
}
