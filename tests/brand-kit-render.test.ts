import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {Resvg,initWasm} from "@resvg/resvg-wasm";
import {logoSvgOverlay} from "../api/_lib/deterministic-logo.js";

const logoPng="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLQXQAAAABJRU5ErkJggg==";
const overlay=logoSvgOverlay({logoDataUrl:"data:image/png;base64,"+logoPng,width:1080,height:1080,panelColor:"#FFFFFF"});
assert.match(overlay,/<image href="data:image\/png;base64,/);
assert.match(overlay,/preserveAspectRatio="xMidYMid meet"/);
assert.equal(logoSvgOverlay({logoDataUrl:"https://example.com/logo.svg",width:1080,height:1080,panelColor:"#FFFFFF"}),"");
assert.equal(logoSvgOverlay({logoDataUrl:"data:image/svg+xml;base64,c3Zn",width:1080,height:1080,panelColor:"#FFFFFF"}),"");
assert.equal(logoSvgOverlay({logoDataUrl:"data:image/png;base64,"+logoPng,width:30,height:30,panelColor:"#FFFFFF"}),"");

await initWasm(await readFile(new URL("../node_modules/@resvg/resvg-wasm/index_bg.wasm",import.meta.url)));
function rendered(overlayMarkup:string) {
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080"><rect width="1080" height="1080" fill="#101010"/>'+overlayMarkup+'</svg>';
  return new Resvg(svg).render().asPng();
}
const plain=rendered("");
const branded=rendered(overlay);
assert.deepEqual([...plain.slice(0,8)],[137,80,78,71,13,10,26,10]);
assert.deepEqual([...branded.slice(0,8)],[137,80,78,71,13,10,26,10]);
assert.notDeepEqual(branded,plain,"approved brand logo must alter rendered pixels");
console.log("Brand Kit visual overlay: PASS — real WASM SVG raster changes with approved logo.");
