/**
 * Node/Vercel binary asset loader.
 *
 * The .wasm and .woff imports in deterministic-text-worker-assets.ts are
 * bundled as binary only by the Cloudflare Worker build. Vercel Node's file
 * tracer instead tries to evaluate the .wasm import as JavaScript ("wbg").
 *
 * Resolve the package files as paths and load them as bytes. The Vercel
 * functions' includeFiles entries ship these immutable assets with each
 * function that can generate images.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

async function binary(specifier: string): Promise<ArrayBuffer> {
  const filepath = require.resolve(specifier);
  const buffer = await readFile(filepath);
  // Copy to a standalone ArrayBuffer; initWasm and the font conversion
  // routines must never receive Buffer's pooled byteOffset/byteLength.
  return Uint8Array.from(buffer).buffer;
}

export const [resvgWasm, interRegular, interBold] = await Promise.all([
  binary("@resvg/resvg-wasm/index_bg.wasm"),
  binary("@fontsource/inter/files/inter-latin-400-normal.woff"),
  binary("@fontsource/inter/files/inter-latin-700-normal.woff"),
]);
