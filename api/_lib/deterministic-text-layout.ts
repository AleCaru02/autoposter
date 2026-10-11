import * as fontkit from "fontkit";

export type TextRole = "BRAND" | "HEADLINE" | "SUBHEADLINE" | "BODY" | "CTA";
export type TextBlockInput = { role: TextRole; text: string; weight: 400 | 700; preferredSize: number; minimumSize: number; maxLines: number; box: Box };
export type Box = { x: number; y: number; width: number; height: number };
export type LaidOutTextBlock = TextBlockInput & { fontSize: number; lineHeight: number; lines: string[]; measuredWidth: number; measuredHeight: number };
export type TypographyLayout = { canvas: { width: number; height: number }; blocks: LaidOutTextBlock[]; protectedMargins: number; visualZone: Box; textZone: Box };

export class TypographyPreflightError extends Error {
  constructor(readonly code: "TEXT_EMPTY" | "TEXT_FIT_FAIL" | "TEXT_COLLISION" | "TEXT_EDGE_COLLISION" | "BRAND_HEADLINE_CLEARSPACE") { super(code); }
}

function metric(font: fontkit.Font, value: string, size: number) {
  return font.layout(value).advanceWidth / font.unitsPerEm * size;
}

function splitLines(font: fontkit.Font, text: string, size: number, maxWidth: number, maxLines: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (metric(font, candidate, size) <= maxWidth) { line = candidate; continue; }
    if (!line || metric(font, word, size) > maxWidth) return null;
    lines.push(line);
    line = word;
    if (lines.length >= maxLines) return null;
  }
  if (line) lines.push(line);
  return lines.length && lines.length <= maxLines ? lines : null;
}

function layoutBlock(fontData: Uint8Array, input: TextBlockInput): LaidOutTextBlock {
  if (!input.text.trim()) throw new TypographyPreflightError("TEXT_EMPTY");
  const font = fontkit.create(fontData);
  for (let size = input.preferredSize; size >= input.minimumSize; size -= 2) {
    const lines = splitLines(font, input.text, size, input.box.width, input.maxLines);
    const lineHeight = Math.ceil(size * 1.18);
    if (!lines || lineHeight * lines.length > input.box.height) continue;
    const measuredWidth = Math.max(...lines.map((line) => metric(font, line, size)));
    return { ...input, fontSize: size, lineHeight, lines, measuredWidth, measuredHeight: lineHeight * lines.length };
  }
  throw new TypographyPreflightError("TEXT_FIT_FAIL");
}

function intersects(a: Box, b: Box) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function inside(box: Box, canvas: { width: number; height: number }, margin: number) {
  return box.x >= margin && box.y >= margin && box.x + box.width <= canvas.width - margin && box.y + box.height <= canvas.height - margin;
}

/** Shared fail-closed geometry check, kept public so the worker contract can
 * be tested without invoking a provider or PNG renderer. */
export function assertTypographySafety(blocks: Array<{ box: Box }>, canvas: { width: number; height: number }, margin: number) {
  for (const block of blocks) {
    if (!inside(block.box, canvas, margin)) throw new TypographyPreflightError("TEXT_EDGE_COLLISION");
  }
  for (let index = 0; index < blocks.length; index += 1) {
    for (let next = index + 1; next < blocks.length; next += 1) {
      if (intersects(blocks[index].box, blocks[next].box)) throw new TypographyPreflightError("TEXT_COLLISION");
    }
  }
}

export function createTypographyLayout(input: { canvas: { width: number; height: number }; fontRegular: Uint8Array; fontBold: Uint8Array; brand: string; headline: string; subheadline?: string | null }) {
  const { width, height } = input.canvas;
  const margin = Math.round(Math.min(width, height) * 0.08);
  const textWidth = width - margin * 2;
  const brandBox: Box = { x: margin, y: margin, width: textWidth, height: 74 };
  const headlineBox: Box = { x: margin, y: margin + 138, width: textWidth, height: Math.round(height * 0.25) };
  const subheadlineBox: Box = { x: margin, y: headlineBox.y + headlineBox.height + 34, width: textWidth, height: Math.round(height * 0.11) };
  const inputs: TextBlockInput[] = [
    { role: "BRAND", text: input.brand, weight: 700, preferredSize: 38, minimumSize: 30, maxLines: 1, box: brandBox },
    { role: "HEADLINE", text: input.headline, weight: 700, preferredSize: 116, minimumSize: 78, maxLines: 3, box: headlineBox },
    ...(input.subheadline?.trim() ? [{ role: "SUBHEADLINE" as const, text: input.subheadline.trim(), weight: 400 as const, preferredSize: 44, minimumSize: 32, maxLines: 2, box: subheadlineBox }] : []),
  ];
  const blocks = inputs.map((block) => layoutBlock(block.weight === 700 ? input.fontBold : input.fontRegular, block));
  assertTypographySafety(blocks, { width, height }, margin);
  const brand = blocks.find((block) => block.role === "BRAND")!;
  const headline = blocks.find((block) => block.role === "HEADLINE")!;
  if (headline.box.y - (brand.box.y + brand.box.height) < 60) throw new TypographyPreflightError("BRAND_HEADLINE_CLEARSPACE");
  const visualZone: Box = { x: margin, y: Math.round(height * 0.60), width: textWidth, height: height - Math.round(height * 0.60) - margin };
  return { canvas: { width, height }, blocks, protectedMargins: margin, textZone: { x: margin, y: margin, width: textWidth, height: visualZone.y - margin - 32 }, visualZone } satisfies TypographyLayout;
}

export function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}
