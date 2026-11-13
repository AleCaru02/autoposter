import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { woffToSfnt } from "../woff-to-sfnt.js";

/**
 * Burned-in Italian subtitles rendered as transparent PNG overlays with resvg + Inter.
 * FFmpeg then only needs `overlay`, so captions do not depend on libass/fontconfig in the cloud.
 */
export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1920;

export type CaptionCue = { text: string; start: number; end: number };

const MAX_LINE_CHARS = 22;
const MAX_CUE_CHARS = 44;

function words(text: string) {
  return text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
}

/** Splits narration into short cues (max 2 lines), preferring sentence and clause boundaries. */
export function splitCaptionCues(narration: string): string[] {
  const cues: string[] = [];
  let current: string[] = [];
  const flush = () => { if (current.length) cues.push(current.join(" ")); current = []; };
  for (const word of words(narration)) {
    const candidate = [...current, word].join(" ");
    if (current.length && candidate.length > MAX_CUE_CHARS) flush();
    current.push(word);
    if (/[.!?…]$/.test(word) || (/[,;:]$/.test(word) && current.join(" ").length >= MAX_CUE_CHARS * 0.55)) flush();
  }
  flush();
  return cues;
}

/** Wraps a cue on at most two balanced lines. */
export function wrapCaptionLines(cue: string): string[] {
  const all = words(cue);
  if (cue.length <= MAX_LINE_CHARS || all.length < 2) return [cue];
  let best: [string, string] = [cue, ""];
  let bestScore = Number.POSITIVE_INFINITY;
  for (let split = 1; split < all.length; split += 1) {
    const first = all.slice(0, split).join(" ");
    const second = all.slice(split).join(" ");
    const score = Math.max(first.length, second.length) * 10 + Math.abs(first.length - second.length);
    if (score < bestScore) { bestScore = score; best = [first, second]; }
  }
  return best;
}

/**
 * Timing proportional to spoken length (characters + pause weight on punctuation),
 * scaled to the real narration duration measured with ffprobe.
 */
export function timeCaptionCues(cues: string[], narrationSeconds: number, leadIn = 0.1): CaptionCue[] {
  if (!cues.length) return [];
  const weights = cues.map((cue) => cue.length + (/[.!?…]$/.test(cue) ? 8 : /[,;:]$/.test(cue) ? 4 : 0));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const available = Math.max(narrationSeconds - leadIn, 0.5);
  let cursor = leadIn;
  return cues.map((text, index) => {
    const duration = (weights[index] / total) * available;
    const cue = { text, start: Number(cursor.toFixed(3)), end: Number((cursor + duration).toFixed(3)) };
    cursor += duration;
    return cue;
  });
}

let resvgReady: Promise<void> | null = null;
let fontCache: { regular: Uint8Array; bold: Uint8Array } | null = null;
const require = createRequire(import.meta.url);

async function renderer() {
  resvgReady ??= initWasm(readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm"))).catch((error: unknown) => {
    // The image compositor may have initialised the same wasm module in this process.
    if (error instanceof Error && /already initialized/i.test(error.message)) return;
    resvgReady = null;
    throw error;
  });
  await resvgReady;
  fontCache ??= {
    regular: await woffToSfnt(new Uint8Array(readFileSync(require.resolve("@fontsource/inter/files/inter-latin-400-normal.woff")))),
    bold: await woffToSfnt(new Uint8Array(readFileSync(require.resolve("@fontsource/inter/files/inter-latin-700-normal.woff")))),
  };
  return fontCache;
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function countPaintedPixels(rgba: Uint8Array) {
  let painted = 0;
  for (let index = 3; index < rgba.length; index += 4) if (rgba[index] > 0) painted += 1;
  return painted;
}

export type CaptionStyle = { textColor?: string; panelColor?: string; panelOpacity?: number; accentColor?: string };

function safeColor(value: string | undefined, fallback: string) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

/**
 * Full-frame transparent PNG with the cue inside the Reels safe area
 * (clear of the top 14% and the bottom ~25% used by Instagram UI).
 */
export async function renderCaptionPng(text: string, style: CaptionStyle = {}): Promise<Uint8Array> {
  const fonts = await renderer();
  const lines = wrapCaptionLines(text);
  const fontSize = 66;
  const lineHeight = 84;
  const longest = Math.max(...lines.map((line) => line.length));
  const panelWidth = Math.min(REEL_WIDTH - 120, Math.max(420, Math.round(longest * fontSize * 0.56) + 96));
  const panelHeight = lines.length * lineHeight + 56;
  const centerY = Math.round(REEL_HEIGHT * 0.66);
  const panelY = centerY - Math.round(panelHeight / 2);
  const panelX = Math.round((REEL_WIDTH - panelWidth) / 2);
  const textColor = safeColor(style.textColor, "#ffffff");
  const panelColor = safeColor(style.panelColor, "#101418");
  const accent = safeColor(style.accentColor, "#1b7e50");
  const opacity = Math.min(Math.max(style.panelOpacity ?? 0.78, 0.4), 0.95);
  const tspans = lines.map((line, index) => `<tspan x="${REEL_WIDTH / 2}" y="${panelY + 28 + fontSize + index * lineHeight - 8}">${escapeXml(line)}</tspan>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${REEL_WIDTH}" height="${REEL_HEIGHT}" viewBox="0 0 ${REEL_WIDTH} ${REEL_HEIGHT}">`
    + `<rect x="${panelX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}" rx="28" fill="${panelColor}" fill-opacity="${opacity}"/>`
    + `<rect x="${panelX}" y="${panelY + 18}" width="8" height="${panelHeight - 36}" rx="4" fill="${accent}"/>`
    + `<text text-anchor="middle" font-family="Inter" font-size="${fontSize}" font-weight="700" fill="${textColor}">${tspans}</text></svg>`;
  const options = { font: { fontBuffers: [fonts.regular, fonts.bold], defaultFontFamily: "Inter", loadSystemFonts: false }, textRendering: 2 as const, shapeRendering: 2 as const };
  // Fail closed: a caption panel without visible glyphs must never reach a published Reel.
  const textOnly = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${REEL_WIDTH}" height="${REEL_HEIGHT}"><text text-anchor="middle" font-family="Inter" font-size="${fontSize}" font-weight="700" fill="#000000">${tspans}</text></svg>`, options).render();
  if (countPaintedPixels(textOnly.pixels) < text.replace(/\s/g, "").length * 40) throw new Error("CAPTION_TEXT_NOT_RENDERED");
  return new Resvg(svg, options).render().asPng();
}
