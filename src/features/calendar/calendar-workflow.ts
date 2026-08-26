export type SocialProvider = "INSTAGRAM" | "FACEBOOK" | "LINKEDIN" | "GBP";

export type PreferredSlot = {
  day: number;
  time: string;
};

export const SOCIAL_PROVIDERS: Array<{ value: SocialProvider; label: string }> = [
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "FACEBOOK", label: "Facebook" },
  { value: "LINKEDIN", label: "LinkedIn" },
  { value: "GBP", label: "Google Business Profile" },
];

export const WEEK_DAYS = [
  { value: 1, label: "Lunedì" },
  { value: 2, label: "Martedì" },
  { value: 3, label: "Mercoledì" },
  { value: 4, label: "Giovedì" },
  { value: 5, label: "Venerdì" },
  { value: 6, label: "Sabato" },
  { value: 7, label: "Domenica" },
];

export function normalizePreferredSlots(value: unknown): PreferredSlot[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const rows: PreferredSlot[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const day = Number((entry as Record<string, unknown>).day);
    const time = String((entry as Record<string, unknown>).time ?? "").trim();
    if (!Number.isInteger(day) || day < 1 || day > 7 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) continue;
    const key = `${day}-${time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ day, time });
  }
  return rows.sort((a, b) => a.day - b.day || a.time.localeCompare(b.time)).slice(0, 28);
}

export function clampPostsPerWeek(value: unknown) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 21);
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
    second: pick("second"),
  };
}

function offsetAt(timestamp: number, timeZone: string) {
  const parts = zonedParts(new Date(timestamp), timeZone);
  const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return representedAsUtc - Math.floor(timestamp / 1000) * 1000;
}

export function zonedLocalToIso(localValue: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localValue);
  if (!match) throw new Error("Data e ora non valide.");
  const [, y, m, d, h, min] = match;
  const localAsUtc = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), 0);
  let instant = localAsUtc - offsetAt(localAsUtc, timeZone);
  instant = localAsUtc - offsetAt(instant, timeZone);
  const roundtrip = zonedParts(new Date(instant), timeZone);
  if (roundtrip.year !== Number(y) || roundtrip.month !== Number(m) || roundtrip.day !== Number(d) || roundtrip.hour !== Number(h) || roundtrip.minute !== Number(min)) {
    throw new Error("Questa ora non esiste nel fuso del profilo, probabilmente per il cambio dell’ora legale.");
  }
  return new Date(instant).toISOString();
}

export function isoToZonedInput(iso: string, timeZone: string) {
  const parts = zonedParts(new Date(iso), timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function formatZonedDateTime(iso: string, timeZone: string, locale = "it-IT") {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function createCalendarIdempotencyKey(jobId: string) {
  return `calendar:${jobId}`;
}
