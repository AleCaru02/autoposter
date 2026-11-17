import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { createTypographyLayout, escapeXml, type TypographyLayout, type TypographyPlacement } from "./deterministic-text-layout.js";
import { logoSvgOverlay } from "./deterministic-logo.js";
import { woffToSfnt } from "./woff-to-sfnt.js";

/** Optional per-profile font data.  A complete pair is used as supplied; an
 * incomplete or unavailable pair deliberately falls back to bundled Inter and
 * reports that fallback rather than claiming the original brand typeface. */
export type BrandFonts = { family?: string; regular?: ArrayBuffer; bold?: ArrayBuffer };
export type TypographyStyle = { panelColor?: string; textColor?: string; brandColor?: string; panelOpacity?: number; layout?: TypographyPlacement };

let rendererReady: Promise<void> | null = null;
let fontsReady: Promise<{ regular: Uint8Array; bold: Uint8Array }> | null = null;
type TypographyBinaryAssets = { resvgWasm: ArrayBuffer | WebAssembly.Module; interRegular: ArrayBuffer; interBold: ArrayBuffer };
let workerAssetsReady: Promise<TypographyBinaryAssets> | null = null;

function workerAssets(): Promise<TypographyBinaryAssets> {
  // Vercel uses actual Node. Workers have WebSocketPair and a binary asset
  // bundler; do not change their existing .wasm / WOFF loading contract.
  const nodeRuntime = typeof process !== "undefined" && Boolean(process.versions?.node)
    && typeof (globalThis as { WebSocketPair?: unknown }).WebSocketPair === "undefined";
  workerAssetsReady ??= nodeRuntime
    ? import("./deterministic-text-node-assets.js").then(({ loadNodeTypographyAssets }) => loadNodeTypographyAssets())
    : import("./deterministic-text-worker-assets.js");
  return workerAssetsReady!;
}

function bytes(asset: ArrayBuffer) {
  if (!(asset instanceof ArrayBuffer)) throw new Error("TEXT_COMPOSITOR_FONT_UNAVAILABLE");
  return new Uint8Array(asset);
}

// resvg-wasm ignores WOFF data (text would silently render as nothing): always hand it SFNT.
async function fonts() {
  fontsReady ??= workerAssets().then(async ({ interRegular, interBold }) => ({ regular: await woffToSfnt(bytes(interRegular)), bold: await woffToSfnt(bytes(interBold)) }));
  return fontsReady;
}

async function effectiveFonts(brandFonts?: BrandFonts) {
  if (brandFonts?.regular instanceof ArrayBuffer && brandFonts.bold instanceof ArrayBuffer) {
    return {
      regular: await woffToSfnt(new Uint8Array(brandFonts.regular)), bold: await woffToSfnt(new Uint8Array(brandFonts.bold)),
      family: brandFonts.family?.trim() || "Brand-provided font", source: "brand" as const,
    };
  }
  return fonts().then((fallback) => ({ ...fallback, family: "Inter", source: "controlled_fallback" as const }));
}

async function ready() {
  rendererReady ??= workerAssets().then(({ resvgWasm }) => initWasm(resvgWasm));
  return rendererReady;
}

function textSvg(layout: TypographyLayout, fontFamily: string, style: Required<TypographyStyle>) {
  return layout.blocks.map((block) => {
    const fill = block.role === "BRAND" ? style.brandColor : style.textColor;
    const tracking = block.role === "BRAND" ? "0.12em" : "0";
    return `<text x="${block.box.x}" y="${block.box.y + block.fontSize}" font-family="${escapeXml(fontFamily)}" font-size="${block.fontSize}" font-weight="${block.weight}" letter-spacing="${tracking}" fill="${fill}">${block.lines.map((line, index) => `<tspan x="${block.box.x}" dy="${index ? block.lineHeight : 0}">${escapeXml(line)}</tspan>`).join("")}</text>`;
  }).join("");
}

/** Photo-led cover based on social-post-designer's contrast and no-filler grid rules. */
export function photoLedBackdropSvg(layout: TypographyLayout, backgroundPngBase64: string): string {
  const { width, height } = layout.canvas;
  const image = `<image href="data:image/png;base64,${backgroundPngBase64}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>`;
  if (layout.placement === "EDITORIAL_SPLIT") {
    const split = layout.visualZone.x;
    // Photo fills a continuous right-hand editorial column. An opaque, dark
    // brand canvas is intentional here: it is a genuine magazine text column,
    // not the semi-transparent empty card that was rejected in production.
    return `<defs>
      <clipPath id="pa-photo-column"><rect x="${split}" y="0" width="${width-split}" height="${height}"/></clipPath>
      <linearGradient id="pa-photo-depth" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#071723" stop-opacity="0.34"/>
        <stop offset="65%" stop-color="#071723" stop-opacity="0"/>
        <stop offset="100%" stop-color="#071723" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="#112839"/>
    <image href="data:image/png;base64,${backgroundPngBase64}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#pa-photo-column)"/>
    <rect x="${split}" y="0" width="${width-split}" height="${height}" fill="url(#pa-photo-depth)"/>
    <rect x="${layout.protectedMargins}" y="${Math.round(height*0.87)}" width="${Math.round(split-layout.protectedMargins*2.3)}" height="2" fill="#EDF1EF" opacity="0.27"/>`;
  }
  if (layout.placement === "BOTTOM_GRADIENT") {
    const from = Math.round(height * 0.41);
    return `<defs><linearGradient id="pa-contrast" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#081621" stop-opacity="0"/>
      <stop offset="39%" stop-color="#081621" stop-opacity="0.45"/>
      <stop offset="73%" stop-color="#081621" stop-opacity="0.88"/>
      <stop offset="100%" stop-color="#081621" stop-opacity="0.97"/>
      </linearGradient></defs>${image}<rect x="0" y="${from}" width="${width}" height="${height-from}" fill="url(#pa-contrast)"/>`;
  }
  const coverHeight = Math.round(Math.min(height*0.64,layout.textZone.y+layout.textZone.height+height*0.22));
  return `<defs><linearGradient id="pa-contrast" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#081621" stop-opacity="0.93"/>
    <stop offset="65%" stop-color="#081621" stop-opacity="0.82"/>
    <stop offset="100%" stop-color="#081621" stop-opacity="0"/>
    </linearGradient></defs>${image}<rect x="0" y="0" width="${width}" height="${coverHeight}" fill="url(#pa-contrast)"/>`;
}

export async function composeDeterministicTypography(input: { backgroundPngBase64: string; width: number; height: number; brand: string; headline: string; subheadline?: string | null; logoDataUrl?: string | null; brandFonts?: BrandFonts; style?: TypographyStyle }) {
  const font = await effectiveFonts(input.brandFonts);
  const layout = createTypographyLayout({ canvas: { width: input.width, height: input.height }, fontRegular: font.regular, fontBold: font.bold, brand: input.brand, headline: input.headline, subheadline: input.subheadline, placement: input.style?.layout });
  await ready();
  const style: Required<TypographyStyle> = { panelColor: input.style?.panelColor || "#fffdf8", textColor: input.style?.textColor || "#172430", brandColor: input.style?.brandColor || "#0e5973", panelOpacity: input.style?.panelOpacity ?? 0.94, layout: layout.placement };
  const accent = /^#[0-9a-fA-F]{6}$/.test(style.brandColor) ? style.brandColor : "#c9923d";
  const imageAndBackdrop = photoLedBackdropSvg(layout, input.backgroundPngBase64);
  // Dark photograph-integrated gradients replace the 60%-height cream rectangle.
  // White type and a restrained brand accent keep contrast stable on arbitrary photos.
  const textStyle = { ...style, textColor: "#FFFFFF", brandColor: "#FFFFFF" };
  const accentBar = `<rect x="${layout.blocks[0].box.x}" y="${layout.blocks[0].box.y + layout.blocks[0].box.height + 9}" width="${Math.round(input.width*0.075)}" height="7" rx="3" fill="${accent}"/>`;
  const splitRule = layout.placement === "EDITORIAL_SPLIT"
    ? `<rect x="${layout.visualZone.x-5}" y="0" width="5" height="${input.height}" fill="${accent}"/>`
    : "";
  const logoMarkup = logoSvgOverlay({logoDataUrl:input.logoDataUrl,width:input.width,height:input.height,panelColor:"#0d1b26"});
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}">${imageAndBackdrop}${splitRule}${accentBar}${textSvg(layout, font.family, textStyle)}${logoMarkup}</svg>`;
  const image = new Resvg(svg, { font: { fontBuffers: [font.regular, font.bold], defaultFontFamily: font.family }, textRendering: 2, imageRendering: 0, shapeRendering: 2 }).render();
  const png = image.asPng();
  const base64 = typeof Buffer !== "undefined" ? Buffer.from(png).toString("base64") : btoa(String.fromCharCode(...png));
  return { base64, layout, mimeType: "image/png" as const, font: { family: font.family, source: font.source }, logoApplied: Boolean(logoMarkup) };
}

export async function preflightDeterministicTypography(input: { width: number; height: number; brand: string; headline: string; subheadline?: string | null; brandFonts?: BrandFonts; style?: TypographyStyle }) {
  const font = await effectiveFonts(input.brandFonts);
  const layout = createTypographyLayout({ canvas: { width: input.width, height: input.height }, fontRegular: font.regular, fontBold: font.bold, brand: input.brand, headline: input.headline, subheadline: input.subheadline, placement: input.style?.layout });
  // Fail before OpenAI image generation is billed if WASM/assets are missing.
  // Layout checking alone does not initialize the renderer.
  await ready();
  return { ...layout, font: { family: font.family, source: font.source } };
}
