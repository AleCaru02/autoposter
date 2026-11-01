import { validateVideoForReview, type VideoPlan } from "./video-studio.js";

export type VideoPublicationEvidence = {
  mp4Url: string;
  mp4MimeType: string;
  renderedDurationMs: number;
  videoWidth: number;
  videoHeight: number;
  reviewApproved: boolean;
  reviewedPlanFingerprint: string;
  currentPlanFingerprint: string;
  socialAccountConnected: boolean;
  scheduledAt?: string;
  budgetSpentEur: number;
  assets: Record<string, { licensed: boolean; available: boolean }>;
};

export function videoPublicationBlockers(plan: VideoPlan, evidence: VideoPublicationEvidence): string[] {
  const blockers = validateVideoForReview(plan, evidence.assets, evidence.budgetSpentEur);
  if (!evidence.mp4Url.startsWith("https://")) blockers.push("PUBLIC_MP4_URL_REQUIRED");
  if (evidence.mp4MimeType !== "video/mp4") blockers.push("MP4_REQUIRED");
  if (evidence.videoWidth !== 1080 || evidence.videoHeight !== 1920) blockers.push("INVALID_RENDER_RESOLUTION");
  const duration = plan.scenes.at(-1)?.endMs ?? 0;
  if (Math.abs(duration - evidence.renderedDurationMs) > 1000) blockers.push("RENDER_DURATION_MISMATCH");
  if (!evidence.reviewApproved) blockers.push("MANUAL_APPROVAL_REQUIRED");
  if (!evidence.reviewedPlanFingerprint || evidence.reviewedPlanFingerprint !== evidence.currentPlanFingerprint) blockers.push("APPROVAL_STALE");
  if (!evidence.socialAccountConnected) blockers.push("INSTAGRAM_CONNECTION_REQUIRED");
  if (evidence.scheduledAt && (!Number.isFinite(Date.parse(evidence.scheduledAt)) || Date.parse(evidence.scheduledAt) <= Date.now())) blockers.push("INVALID_SCHEDULE");
  return [...new Set(blockers)];
}
