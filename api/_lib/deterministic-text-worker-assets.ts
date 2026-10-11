/* Worker-only binary asset boundary.  This module is deliberately loaded
 * dynamically by the compositor so Node can import the application graph
 * without asking its ESM loader to interpret .woff or .wasm files. */
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm";
import interRegular from "@fontsource/inter/files/inter-latin-400-normal.woff";
import interBold from "@fontsource/inter/files/inter-latin-700-normal.woff";

export { interBold, interRegular, resvgWasm };
