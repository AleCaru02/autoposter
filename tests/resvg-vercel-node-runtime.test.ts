import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadNodeTypographyAssets } from "../api/_lib/deterministic-text-node-assets.js";
import { composeDeterministicTypography } from "../api/_lib/deterministic-text-compositor.js";

const bin = await loadNodeTypographyAssets();
assert.ok(bin.resvgWasm.byteLength>100_000, "real WASM binary should load through fs, not ESM");
assert.ok(bin.interRegular.byteLength>10_000 && bin.interBold.byteLength>10_000, "real Inter fonts present");
const src = readFileSync(new URL("../api/_lib/deterministic-text-node-assets.ts",import.meta.url),"utf8");
assert.doesNotMatch(src,/import\s+.*\.wasm["']/,"Node cannot import binary .wasm as an ES module");
const vercel=JSON.parse(readFileSync(new URL("../vercel.json",import.meta.url),"utf8"));
for (const route of ["api/cron.ts","api/cron-canary.ts","api/generate-image.ts","api/render.ts"]) {
  assert.ok(vercel.functions[route].includeFiles.includes("node_modules/@resvg/resvg-wasm"),
    route+" must package the actual WASM binary");
  assert.ok(vercel.functions[route].includeFiles.includes("@fontsource/inter/files"),
    route+" must package the font binaries");
}
const background="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y5tL1cAAAAASUVORK5CYII=";
const composed=await composeDeterministicTypography({
  backgroundPngBase64:background,width:1080,height:1350,
  brand:"Il Tuo Property Manager",headline:"Milano: prepara la tua casa",
});
const png=Buffer.from(composed.base64,"base64");
assert.equal(png.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
assert.ok(png.length>1000,"Typography renderer must return a real PNG");
assert.equal(composed.font.family,"Inter");
console.log("Vercel-compatible Node resvg font+WASM production typography render: PASS");
