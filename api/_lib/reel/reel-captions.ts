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

/**
 * Italian words that must not close a cue or a line: articles, prepositions (simple and
 * articulated), conjunctions, negation and determiners belong with the word that follows.
 */
const WEAK_ENDINGS = new Set([
  "il", "lo", "la", "i", "gli", "le", "l'", "un", "uno", "una", "un'",
  "di", "a", "da", "in", "con", "su", "per", "tra", "fra",
  "del", "dello", "della", "dei", "degli", "delle", "al", "allo", "alla", "ai", "agli", "alle",
  "dal", "dallo", "dalla", "dai", "dagli", "dalle", "nel", "nello", "nella", "nei", "negli", "nelle",
  "sul", "sullo", "sulla", "sui", "sugli", "sulle", "col", "coi",
  "e", "ed", "o", "od", "ma", "che", "se", "come", "ciò", "non", "né", "anche", "più", "meno", "molto",
  "ogni", "questo", "questa", "questi", "queste", "quel", "quello", "quella", "quei", "quelle",
  "mio", "mia", "tuo", "tua", "suo", "sua", "nostro", "nostra", "vostro", "vostra", "loro",
  "è", "sono", "ha", "hai", "ho", "va", "vanno", "può", "puoi", "devi", "deve", "ti", "ci", "si", "mi", "vi",
]);

function bareWord(word: string) {
  return word.toLowerCase().replace(/^[«"“(]+|[»"”).,;:!?…]+$/g, "");
}

/** Cost of ending a cue/line after `word`: 0 at punctuation, high after a weak word. */
export function breakPenalty(word: string) {
  if (/[.!?…]["»”)]?$/.test(word)) return 0;
  if (/[,;:]["»”)]?$/.test(word)) return 1;
  const bare = bareWord(word);
  if (WEAK_ENDINGS.has(bare) || /'$/.test(bare)) return 60;
  return 8;
}

/** A heading word: only capital letters (apostrophes allowed), at least 2 letters. */
function isHeadingWord(word: string) {
  const letters = word.replace(/[^\p{L}]/gu, "");
  return letters.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

/**
 * An ALL-CAPS heading of 2+ words followed by a normal capitalised word ends a sentence even
 * without punctuation ("DOCUMENTI DELL'IMMOBILE Titolo…" → heading | "Titolo…").
 */
function splitHeadings(sentence: string) {
  const list = words(sentence);
  const parts: string[] = [];
  let start = 0;
  for (let index = 2; index < list.length; index += 1) {
    const next = list[index];
    const startsUpper = /^[\p{Lu}]/u.test(next) && !isHeadingWord(next);
    if (startsUpper && isHeadingWord(list[index - 1]) && isHeadingWord(list[index - 2])) {
      parts.push(list.slice(start, index).join(" "));
      start = index;
    }
  }
  parts.push(list.slice(start).join(" "));
  return parts.filter(Boolean);
}

function sentences(narration: string) {
  return narration.replace(/\s+/g, " ").trim().split(/(?<=[.!?…]["»”)]?)\s+/).filter(Boolean).flatMap(splitHeadings);
}

/**
 * Splits narration into cues of at most two lines. Each sentence is segmented with dynamic
 * programming: segments fit MAX_CUE_CHARS, prefer punctuation, never end on an article,
 * preposition or conjunction when an alternative exists, and avoid one-word fragments.
 */
export function splitCaptionCues(narration: string): string[] {
  const cues: string[] = [];
  for (const sentence of sentences(narration)) {
    const list = words(sentence);
    if (sentence.length <= MAX_CUE_CHARS) { cues.push(list.join(" ")); continue; }
    const n = list.length;
    const best = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY);
    const from = new Array<number>(n + 1).fill(-1);
    best[0] = 0;
    for (let end = 1; end <= n; end += 1) {
      for (let begin = end - 1; begin >= 0; begin -= 1) {
        const text = list.slice(begin, end).join(" ");
        if (text.length > MAX_CUE_CHARS && end - begin > 1) break;
        if (!Number.isFinite(best[begin])) continue;
        const fill = MAX_CUE_CHARS - text.length;
        let cost = best[begin] + (fill * fill) / 40 + (end === n ? 0 : breakPenalty(list[end - 1]));
        if (end - begin === 1 && n > 1) cost += 40;
        if (text.length < 12 && n > 1) cost += 20;
        if (cost < best[end]) { best[end] = cost; from[end] = begin; }
      }
    }
    const parts: string[] = [];
    for (let end = n; end > 0; end = from[end]) parts.unshift(list.slice(from[end], end).join(" "));
    cues.push(...parts);
  }
  return cues;
}

/** Wraps a cue on at most two balanced lines, never leaving a weak word at the end of line one. */
export function wrapCaptionLines(cue: string): string[] {
  const all = words(cue);
  if (cue.length <= MAX_LINE_CHARS || all.length < 2) return [cue];
  let best: [string, string] = [cue, ""];
  let bestScore = Number.POSITIVE_INFINITY;
  for (let split = 1; split < all.length; split += 1) {
    const first = all.slice(0, split).join(" ");
    const second = all.slice(split).join(" ");
    const score = Math.max(first.length, second.length) * 10 + Math.abs(first.length - second.length) + breakPenalty(all[split - 1]) * 6;
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
