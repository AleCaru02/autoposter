import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const compositor = await import("../api/_lib/deterministic-text-compositor.js");
assert.equal(typeof compositor.preflightDeterministicTypography, "function");
assert.equal(typeof compositor.composeDeterministicTypography, "function");

// Import-only tests missed the Vercel production crash when a .wasm file was
// evaluated as JavaScript. Execute the real Node binary-loader + renderer.
const params = {
  backgroundPngBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLQXQAAAABJRU5ErkJggg==",
  width: 1536,
  height: 1920,
  brand: "Il Tuo Property Manager",
  headline: "Come scegliere la formula locativa",
  subheadline: null,
};
const preflight = await compositor.preflightDeterministicTypography(params);
assert.ok(preflight.blocks.length >= 2, "preflight must lay out readable copy");
const rendered = await compositor.composeDeterministicTypography(params);
const png = Buffer.from(rendered.base64, "base64");
assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.ok(png.byteLength > 1000, "real rendered PNG must not be empty");
assert.equal(rendered.font.source, "controlled_fallback");

const vercelJson = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
for (const route of ["api/cron.ts", "api/cron-canary.ts", "api/generate-image.ts", "api/autopilot.ts"]) {
  const includeFiles = vercelJson.functions?.[route]?.includeFiles ?? "";
  assert.match(includeFiles, /@resvg\/resvg-wasm\/\*\.wasm/, `${route}: WASM must be bundled`);
  assert.match(includeFiles, /@fontsource\/inter\/files/, `${route}: font binaries must be bundled`);
}
console.log("Deterministic text compositor real Node render + Vercel binary tracing: PASS");
