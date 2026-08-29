export type SiteIntelligenceView = {
  colors: string[];
  fonts: string[];
  logoUrl: string | null;
  pillars: Array<{ name: string; description: string }>;
  pageInsightCount: number;
  services: string[];
  toneTraits: string[];
  targetSummary: string | null;
  differentiators: string[];
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, max = 220) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function strings(value: unknown, max: number) {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const valueText = text(item, 180);
    if (!valueText) continue;
    const key = valueText.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(valueText);
    if (result.length >= max) break;
  }
  return result;
}

function safeHttpUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch { return null; }
}

function safeColor(value: unknown) {
  const color = text(value, 80).toLowerCase();
  if (!color) return null;
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^rgba?\([0-9.% ,/]+\)$/i.test(color)) return color;
  if (/^hsla?\([0-9.% ,/a-z-]+\)$/i.test(color)) return color;
  return null;
}

export function siteIntelligenceView(row: {
  visual_identity?: unknown;
  services?: unknown;
  tone_of_voice?: unknown;
  target_audience?: unknown;
  differentiators?: unknown;
} | null | undefined): SiteIntelligenceView {
  const visual = object(row?.visual_identity);
  const tone = object(row?.tone_of_voice);
  const target = object(row?.target_audience);
  const colors = Array.isArray(visual.observedColors)
    ? visual.observedColors.map(safeColor).filter((item): item is string => Boolean(item)).slice(0, 12)
    : [];
  const fonts = strings(visual.observedFonts, 10);
  const logoUrl = safeHttpUrl(visual.logoUrl);
  const pillarsRaw = Array.isArray(visual.contentPillars) ? visual.contentPillars : [];
  const pillars: Array<{ name: string; description: string }> = [];
  const seenPillars = new Set<string>();
  for (const raw of pillarsRaw) {
    const item = object(raw);
    const name = text(item.name, 120);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seenPillars.has(key)) continue;
    seenPillars.add(key);
    pillars.push({ name, description: text(item.description, 260) });
    if (pillars.length >= 12) break;
  }
  return {
    colors,
    fonts,
    logoUrl,
    pillars,
    pageInsightCount: Array.isArray(visual.pageInsights) ? Math.min(visual.pageInsights.length, 1000) : 0,
    services: strings(row?.services, 16),
    toneTraits: strings(tone.traits, 8),
    targetSummary: text(target.summary, 320) || null,
    differentiators: strings(row?.differentiators, 12),
  };
}
