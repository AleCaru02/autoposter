export type BrandVisualIdentity = {
  colors: string[];
  fonts: string[];
  visualStyle: string | null;
  activeSocialPalette: { primary: string; secondary: string; accent: string; neutral: string; source: "MANUAL" | "OBSERVED" | "FALLBACK" };
  typography: { observedFonts: string[]; renderableFont: string; source: "OBSERVED_RENDERABLE" | "CONTROLLED_FALLBACK" };
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

function fallbackPalette(industry: unknown) {
  const value=clean(industry,160).toLowerCase();
  if(/health|salute|medical|benessere|beauty|estet/.test(value)) return ["#0f766e","#14b8a6","#f59e0b","#f8fafc"];
  if(/real estate|immobil|property|ospital|travel|turism/.test(value)) return ["#17324d","#4d7c8a","#c9923d","#f7f4ee"];
  if(/tech|software|digital|saas/.test(value)) return ["#3730a3","#2563eb","#06b6d4","#f8fafc"];
  return ["#1f3a5f","#426f8c","#c67b4b","#f8fafc"];
}

export function normalizeBrandVisualIdentity(value: unknown, industry?: unknown): BrandVisualIdentity {
  const source = record(value);
  const observedColors=strings(source.observedColors, 10).filter(concreteColor).slice(0, 8);
  const manualColors=strings(source.manualColors, 10).filter(concreteColor).slice(0, 4);
  const fallback=fallbackPalette(industry);
  const observedPalette=observedColors.length>=2
    ? [observedColors[0], observedColors[1], observedColors[2]??fallback[2], observedColors.find((color)=>/^(#fff|#f[ef]|white|#000|black)/i.test(color))??fallback[3]]
    : fallback;
  // Owner-confirmed colors win over fresh crawls; remaining slots retain coherent defaults.
  const selected=manualColors.length
    ? [manualColors[0],manualColors[1]??observedPalette[1],manualColors[2]??observedPalette[2],manualColors[3]??observedPalette[3]]
    : observedPalette;
  const paletteSource=manualColors.length?"MANUAL":observedColors.length>=2?"OBSERVED":"FALLBACK";
  const observedFonts=strings(source.observedFonts, 8).slice(0, 6);
  const interObserved=observedFonts.some((font)=>/^inter$/i.test(font));
  return {
    colors: manualColors.length?manualColors:observedColors,
    fonts: observedFonts,
    visualStyle: clean(source.summary, 1_200) || null,
    activeSocialPalette: { primary:selected[0], secondary:selected[1], accent:selected[2], neutral:selected[3], source:paletteSource },
    typography: { observedFonts, renderableFont:"Inter", source:interObserved?"OBSERVED_RENDERABLE":"CONTROLLED_FALLBACK" },
  };
}
