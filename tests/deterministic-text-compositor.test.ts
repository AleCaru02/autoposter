import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
import { assertTypographySafety, createTypographyLayout, TypographyPreflightError } from "../api/_lib/deterministic-text-layout.js";

const regular = new Uint8Array(await readFile(new URL("../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff", import.meta.url)));
const bold = new Uint8Array(await readFile(new URL("../node_modules/@fontsource/inter/files/inter-latin-700-normal.woff", import.meta.url)));
const italian = "Città, perché è già così: l'energia dà più valore all'idea.";

function layoutFor(width: number, height: number) {
  return createTypographyLayout({
    canvas: { width, height }, fontRegular: regular, fontBold: bold,
    brand: "Orizzonte Studio", headline: "Strategie chiare per progetti che crescono", subheadline: italian,
  });
}

for (const [label, width, height] of [["1:1", 2048, 2048], ["4:5", 1600, 2000], ["9:16", 1080, 1920]] as const) {
  const layout = layoutFor(width, height);
  assert.equal(layout.blocks.length, 3, `${label} must render all text roles`);
  assert.ok(layout.blocks.every((block) => block.measuredWidth <= block.box.width && block.measuredHeight <= block.box.height), `${label} must fit measured glyphs`);
  assert.ok(layout.visualZone.y >= layout.textZone.y + layout.textZone.height + 32, `${label} text and visual zones must not collide`);
  assert.ok(layout.blocks.some((block) => block.role === "SUBHEADLINE" && block.lines.join(" ").includes("Città")), `${label} must retain Italian characters`);
  assert.deepEqual(layoutFor(width, height), layout, `${label} identical input must produce identical layout`);
}

const square = layoutFor(2048, 2048);
const brand = square.blocks.find((block) => block.role === "BRAND")!;
const headline = square.blocks.find((block) => block.role === "HEADLINE")!;
assert.ok(headline.box.y - (brand.box.y + brand.box.height) >= 60, "brand/headline clearspace must be geometric");

assert.throws(() => createTypographyLayout({
  canvas: { width: 2048, height: 2048 }, fontRegular: regular, fontBold: bold,
  brand: "Brand", headline: "parola ".repeat(300), subheadline: null,
}), (error: unknown) => error instanceof TypographyPreflightError && error.code === "TEXT_FIT_FAIL");

assert.throws(() => assertTypographySafety([{ box: { x: 200, y: 200, width: 500, height: 200 } }, { box: { x: 600, y: 300, width: 500, height: 200 } }], { width: 1600, height: 1600 }, 100), (error: unknown) => error instanceof TypographyPreflightError && error.code === "TEXT_COLLISION");
assert.throws(() => assertTypographySafety([{ box: { x: 20, y: 100, width: 500, height: 200 } }], { width: 1600, height: 1600 }, 100), (error: unknown) => error instanceof TypographyPreflightError && error.code === "TEXT_EDGE_COLLISION");

await initWasm(await readFile(new URL("../node_modules/@resvg/resvg-wasm/index_bg.wasm", import.meta.url)));
const fixturePng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLQXQAAAABJRU5ErkJggg==";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="2048"><image href="data:image/png;base64,${fixturePng}" width="2048" height="2048" preserveAspectRatio="xMidYMid slice"/><rect x="${square.textZone.x}" y="${square.textZone.y}" width="${square.textZone.width}" height="${square.textZone.height}" fill="#fffdf8"/><text x="${headline.box.x}" y="${headline.box.y + headline.fontSize}" font-family="Inter" font-size="${headline.fontSize}" font-weight="700" fill="#172430">${headline.lines.map((line, index) => `<tspan x="${headline.box.x}" dy="${index ? headline.lineHeight : 0}">${line}</tspan>`).join("")}</text></svg>`;
const rendered = new Resvg(svg, { font: { fontBuffers: [regular, bold], defaultFontFamily: "Inter" } }).render();
const png = rendered.asPng();
assert.equal(rendered.width, 2048);
assert.equal(rendered.height, 2048);
assert.deepEqual([...png.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.ok(png.length > 10_000, "fixture composition must produce a substantive PNG");
console.log("PASS deterministic text compositor: formats, Italian glyphs, real metrics, wrapping, fit, overflow, collision, safe area, determinism and PNG composition.");
