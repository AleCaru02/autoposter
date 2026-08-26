export type ApprovalStatus = "PENDING" | "APPROVED" | "CHANGES_REQUESTED";
export type ContentStatus = "IN_REVIEW" | "APPROVED" | "CHANGES_REQUESTED";

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

export function parseHashtagInput(value: string): string[] {
  return value.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean).map((entry) => entry.startsWith("#") ? entry : `#${entry}`).slice(0, 30);
}
