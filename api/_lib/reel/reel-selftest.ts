import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveMediaBinary, runMediaBinary } from "./media-binaries.js";
import { renderCaptionPng, splitCaptionCues, timeCaptionCues } from "./reel-captions.js";
import { renderReel } from "./reel-render.js";
import { probeReel, reelTechnicalQa } from "./reel-probe.js";

/** Renders a synthetic 9 s Reel with the deployed binaries; proves the cloud render path end to end. */
export async function renderSelfTest() {
  const started = Date.now();
  const dir = mkdtempSync(join(tmpdir(), "reel-selftest-"));
  try {
    const scenes = [];
    for (let index = 0; index < 3; index += 1) {
      const imagePath = join(dir, `scene-${index}.png`);
      const made = await runMediaBinary("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1440x2560:rate=1", "-frames:v", "1", imagePath], { timeoutMs: 30_000 });
      if (made.code !== 0) throw new Error(`SELFTEST_SCENE_FAILED: ${made.stderrTail.slice(-200)}`);
      scenes.push({ imagePath, durationSeconds: 3 });
    }
    const audioPath = join(dir, "tone.wav");
    const tone = await runMediaBinary("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=9", "-ac", "1", audioPath], { timeoutMs: 30_000 });
    if (tone.code !== 0) throw new Error("SELFTEST_AUDIO_FAILED");
    const captions = [];
    for (const [index, cue] of timeCaptionCues(splitCaptionCues("Test cloud di Post Automatici. Rendering, sottotitoli e audio verificati nella funzione Vercel."), 9).entries()) {
      const pngPath = join(dir, `caption-${index}.png`);
      writeFileSync(pngPath, await renderCaptionPng(cue.text));
      captions.push({ pngPath, start: cue.start, end: cue.end });
    }
    const outputPath = join(dir, "selftest.mp4");
    const rendered = await renderReel({ scenes, captions, audioPath, outputPath });
    const qa = reelTechnicalQa(await probeReel(outputPath), 9);
    return { ok: qa.status === "PASS", qa, renderMs: rendered.durationMs, totalMs: Date.now() - started, ffmpeg: resolveMediaBinary("ffmpeg").replace(/^.*node_modules/, "node_modules"), platform: `${process.platform}-${process.arch}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
