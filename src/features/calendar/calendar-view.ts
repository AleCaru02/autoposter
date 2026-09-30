import type { CalendarJobRow, CalendarVariantRow } from "./calendar-store.js";
import type { SocialProvider } from "./calendar-workflow.js";

export type CalendarViewMode = "MONTH" | "WEEK" | "DAY";
export type CalendarDisplayStatus = "DRAFT" | "REVIEW" | "APPROVED" | "SCHEDULED" | "PUBLISHING" | "PUBLISHED" | "FAILED";

export type CalendarFilters = {
  provider: "ALL" | SocialProvider;
  format: "ALL" | string;
  status: "ALL" | CalendarDisplayStatus;
};

export function variantDisplayStatus(variant: CalendarVariantRow): CalendarDisplayStatus {
  if (variant.workflow_status === "APPROVED" && variant.approval_status === "APPROVED") return "APPROVED";
  if (variant.workflow_status === "DRAFT") return "DRAFT";
  return "REVIEW";
}

export function jobDisplayStatus(job: CalendarJobRow): CalendarDisplayStatus {
  if (job.state === "PUBLISHED") return "PUBLISHED";
  if (job.state === "FAILED") return "FAILED";
  if (job.state === "PROCESSING") return "PUBLISHING";
  if (job.state === "SCHEDULED" || job.state === "QUEUED") return "SCHEDULED";
  return "REVIEW";
}

export function jobMatchesFilters(
  job: CalendarJobRow,
  variant: CalendarVariantRow | undefined,
  filters: CalendarFilters,
) {
  if (filters.provider !== "ALL" && job.provider !== filters.provider) return false;
  if (filters.format !== "ALL" && variant?.format !== filters.format) return false;
  if (filters.status !== "ALL" && jobDisplayStatus(job) !== filters.status) return false;
  return true;
}

export function variantMatchesFilters(variant: CalendarVariantRow, filters: CalendarFilters) {
  if (filters.provider !== "ALL" && variant.provider !== filters.provider) return false;
  if (filters.format !== "ALL" && variant.format !== filters.format) return false;
  if (filters.status !== "ALL" && variantDisplayStatus(variant) !== filters.status) return false;
  return true;
}

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("CALENDAR_DATE_KEY_INVALID");
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function dateKeyUtc(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function shiftDateKey(value: string, days: number) {
  const date = parseDateKey(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKeyUtc(date);
}

export function weekDateKeys(focusDateKey: string) {
  const date = parseDateKey(focusDateKey);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(date);
    day.setUTCDate(date.getUTCDate() + index);
    return dateKeyUtc(day);
  });
}

export function visibleStatuses() {
  return ["DRAFT","REVIEW","APPROVED","SCHEDULED","PUBLISHING","PUBLISHED","FAILED"] as CalendarDisplayStatus[];
}
