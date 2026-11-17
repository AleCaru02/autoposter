import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const requireAsset = createRequire(import.meta.url);
function assetPath(packageName: string, relativeFile: string) {
  try {
    return requireAsset.resolve(packageName + "/" + relativeFile);
  } catch {
    // Some Node exports hide non-JS binary assets: find package entry first.
    return join(dirname(requireAsset.resolve(packageName)), relativeFile);
  }
}
function arrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = Uint8Array.from(value);
  return copy.buffer;
}

/** Node binary asset loader. Explicit readFile prevents Node ESM from
 * interpreting index_bg.wasm as a JavaScript module ("wbg" not found).
 * Cloudflare retains its original worker-bundled binary imports. */
export async function loadNodeTypographyAssets() {
  const files = [
    assetPath("@resvg/resvg-wasm", "index_bg.wasm"),
    assetPath("@fontsource/inter", "files/inter-latin-400-normal.woff"),
    assetPath("@fontsource/inter", "files/inter-latin-700-normal.woff"),
  ];
  const [resvg,regular,bold] = await Promise.all(files.map(file => readFile(file)));
  if (!resvg.length || !regular.length || !bold.length) throw new Error("NODE_TYPOGRAPHY_ASSET_EMPTY");
  return {
    resvgWasm: arrayBuffer(resvg),
    interRegular: arrayBuffer(regular),
    interBold: arrayBuffer(bold),
  };
}
