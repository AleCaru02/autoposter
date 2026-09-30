export type BrandVisualIdentity = {
  colors: string[];
  fonts: string[];
  visualStyle: string | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown, max: number) {
  return Array.isArray(value)
    ? [...new Set(value
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .map((item) => item.trim()))]
        .slice(0, max)
    : [];
}

function concreteColor(value: string) {
  const normalized = value.trim().toLowerCase();
  return Boolean(normalized)
    && !/(?:var|calc|min|max|clamp)\(|--/.test(normalized)
    && !/^#(?:0000|00000000)$/.test(normalized);
}

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

export function normalizeBrandVisualIdentity(value: unknown): BrandVisualIdentity {
  const source = record(value);
  return {
    colors: strings(source.observedColors, 10).filter(concreteColor).slice(0, 8),
    fonts: strings(source.observedFonts, 8).slice(0, 6),
    visualStyle: clean(source.summary, 1_200) || null,
  };
}
