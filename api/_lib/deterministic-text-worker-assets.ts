/* Worker-only binary asset boundary.  This module is deliberately loaded
 * dynamically by the compositor so Node can import the application graph
 * without asking its ESM loader to interpret .woff or .wasm files. */
// @ts-ignore Cloudflare bundler loads binary assets; Vercel's isolated API typecheck has no .wasm declaration.
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
// @ts-ignore Cloudflare bundles WOFF directly; no Node/Vercel ambient module declaration is available.
import interRegular from "@fontsource/inter/files/inter-latin-400-normal.woff";
// @ts-ignore Same Worker-only asset boundary as the regular font.
import interBold from "@fontsource/inter/files/inter-latin-700-normal.woff";

export { interBold, interRegular, resvgWasm };
