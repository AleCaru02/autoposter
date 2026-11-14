import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../src/components/reel-studio-panel.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/reel-studio.css", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/pages/content-generator-page.tsx", import.meta.url), "utf8");
const approvals = readFileSync(new URL("../src/pages/approvals-page.tsx", import.meta.url), "utf8");

assert.match(page, /<ReelStudioPanel profileId=\{selectedProfile\.id\} \/>/);
assert.match(panel, /\/api\/render\/status\?profileId=/, "status comes from the server pipeline, never from local state");
assert.match(panel, /job\.steps_completed \/ job\.steps_total/, "progress is derived from real completed steps only");
assert.doesNotMatch(panel, /Math\.random|setTimeout\([^)]*progress/i, "no simulated progress");
assert.match(panel, /currentProfile\.current !== requested/, "stale responses from another activity are ignored");
assert.match(panel, /playsInline/, "inline playback on iPhone");
assert.match(panel, /Da configurare/, "missing configuration is shown explicitly instead of a dead button");
assert.match(panel, /disabled=\{!engine\?\.ready/, "Create is disabled while the engine is not configured");
assert.match(css, /min-height:44px/, "44px touch targets");
assert.match(css, /font-size:16px/, "16px select avoids iOS zoom");
assert.match(css, /prefers-reduced-motion/);
assert.match(approvals, /variant\.format === "REEL" \? <ReelVariantPreview/);
assert.match(approvals, /variant\.format !== "REEL" && <button/, "image regeneration is hidden for REEL variants");
console.log("PASS reel studio UI: stato reale, progresso a step, iPhone (44px, 16px, playsInline), Revisioni con video.");
