import { Resvg, initWasm } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import interRegular from "@fontsource/inter/files/inter-latin-400-normal.woff";
import interBold from "@fontsource/inter/files/inter-latin-700-normal.woff";
import { createTypographyLayout, escapeXml, type TypographyLayout } from "./deterministic-text-layout.js";

/** Optional per-profile font data.  A complete pair is used as supplied; an
 * incomplete or unavailable pair deliberately falls back to bundled Inter and
 * reports that fallback rather than claiming the original brand typeface. */
export type BrandFonts = { family?: string; regular?: ArrayBuffer; bold?: ArrayBuffer };
export type TypographyStyle = { panelColor?: string; textColor?: string; brandColor?: string; panelOpacity?: number };

let rendererReady: Promise<void> | null = null;
let fontsReady: Promise<{ regular: Uint8Array; bold: Uint8Array }> | null = null;

function bytes(asset: ArrayBuffer) {
  if (!(asset instanceof ArrayBuffer)) throw new Error("TEXT_COMPOSITOR_FONT_UNAVAILABLE");
  return new Uint8Array(asset);
}

async function fonts() {
  fontsReady ??= Promise.resolve({ regular: bytes(interRegular), bold: bytes(interBold) });
  return fontsReady;
}

function effectiveFonts(brandFonts?: BrandFonts) {
  if (brandFonts?.regular instanceof ArrayBuffer && brandFonts.bold instanceof ArrayBuffer) {
    return {
      regular: new Uint8Array(brandFonts.regular), bold: new Uint8Array(brandFonts.bold),
      family: brandFonts.family?.trim() || "Brand-provided font", source: "brand" as const,
    };
  }
  return fonts().then((fallback) => ({ ...fallback, family: "Inter", source: "controlled_fallback" as const }));
}

async function ready() {
  rendererReady ??= initWasm(resvgWasm);
  return rendererReady;
}

function textSvg(layout: TypographyLayout, fontFamily: string, style: Required<TypographyStyle>) {
  return layout.blocks.map((block) => {
    const fill = block.role === "BRAND" ? style.brandColor : style.textColor;
    const tracking = block.role === "BRAND" ? "0.12em" : "0";
    return `<text x="${block.box.x}" y="${block.box.y + block.fontSize}" font-family="${escapeXml(fontFamily)}" font-size="${block.fontSize}" font-weight="${block.weight}" letter-spacing="${tracking}" fill="${fill}">${block.lines.map((line, index) => `<tspan x="${block.box.x}" dy="${index ? block.lineHeight : 0}">${escapeXml(line)}</tspan>`).join("")}</text>`;
  }).join("");
}

export async function composeDeterministicTypography(input: { backgroundPngBase64: string; width: number; height: number; brand: string; headline: string; subheadline?: string | null; brandFonts?: BrandFonts; style?: TypographyStyle }) {
  const font = await effectiveFonts(input.brandFonts);
  const layout = createTypographyLayout({ canvas: { width: input.width, height: input.height }, fontRegular: font.regular, fontBold: font.bold, brand: input.brand, headline: input.headline, subheadline: input.subheadline });
  await ready();
  const style: Required<TypographyStyle> = { panelColor: input.style?.panelColor || "#fffdf8", textColor: input.style?.textColor || "#172430", brandColor: input.style?.brandColor || "#0e5973", panelOpacity: input.style?.panelOpacity ?? 0.94 };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}"><image href="data:image/png;base64,${input.backgroundPngBase64}" width="${input.width}" height="${input.height}" preserveAspectRatio="xMidYMid slice"/><rect x="${layout.textZone.x - 34}" y="${layout.textZone.y - 34}" width="${layout.textZone.width + 68}" height="${layout.textZone.height + 68}" rx="36" fill="${style.panelColor}" fill-opacity="${style.panelOpacity}"/>${textSvg(layout, font.family, style)}</svg>`;
  const image = new Resvg(svg, { font: { fontBuffers: [font.regular, font.bold], defaultFontFamily: font.family }, textRendering: 2, imageRendering: 0, shapeRendering: 2 }).render();
  const png = image.asPng();
  const base64 = typeof Buffer !== "undefined" ? Buffer.from(png).toString("base64") : btoa(String.fromCharCode(...png));
  return { base64, layout, mimeType: "image/png" as const, font: { family: font.family, source: font.source } };
}

export async function preflightDeterministicTypography(input: { width: number; height: number; brand: string; headline: string; subheadline?: string | null; brandFonts?: BrandFonts }) {
  const font = await effectiveFonts(input.brandFonts);
  const layout = createTypographyLayout({ canvas: { width: input.width, height: input.height }, fontRegular: font.regular, fontBold: font.bold, brand: input.brand, headline: input.headline, subheadline: input.subheadline });
  return { ...layout, font: { family: font.family, source: font.source } };
}
