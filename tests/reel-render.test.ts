import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMediaBinary } from "../api/_lib/reel/media-binaries.js";
import { renderCaptionPng, countPaintedPixels, splitCaptionCues, timeCaptionCues, wrapCaptionLines } from "../api/_lib/reel/reel-captions.js";
import { buildReelFfmpegArgs, extractFrame, renderReel } from "../api/_lib/reel/reel-render.js";
import { parseFfprobeJson, probeReel, reelTechnicalQa } from "../api/_lib/reel/reel-probe.js";

// --- Pure caption logic ---
const narration = "Gestire un affitto breve a Milano non è solo pubblicare un annuncio. Servono prezzi aggiornati, check-in senza attese e pulizie coordinate. Ecco da dove partire.";
const cues = splitCaptionCues(narration);
assert.ok(cues.length >= 4, "la narrazione deve essere divisa in più sottotitoli brevi");
assert.ok(cues.every((cue) => cue.length <= 44 || !cue.includes(" ")), `cue troppo lunghi: ${cues.join(" | ")}`);
assert.equal(cues.join(" "), narration.replace(/\s+/g, " "), "i sottotitoli devono riportare esattamente la narrazione, senza aggiungere o perdere parole");
assert.ok(cues.every((cue) => wrapCaptionLines(cue).length <= 2));
const captionPng = await renderCaptionPng("Perché è così importante?");
assert.deepEqual([...captionPng.slice(0, 4)], [137, 80, 78, 71], "caption overlay is a PNG");
const timed = timeCaptionCues(cues, 9.4);
assert.equal(timed[0].start, 0.1);
assert.ok(Math.abs(timed[timed.length - 1].end - 9.4) < 0.01, "l'ultimo sottotitolo termina con la narrazione");
assert.ok(timed.every((cue, index) => index === 0 || Math.abs(cue.start - timed[index - 1].end) < 0.002), "sottotitoli contigui senza sovrapposizioni");

// --- Argument validation (no process) ---
assert.throws(() => buildReelFfmpegArgs({ scenes: [], captions: [], audioPath: "a.wav", outputPath: "o.mp4" }), /REEL_SCENES_INVALID/);
assert.throws(() => buildReelFfmpegArgs({ scenes: [{ imagePath: "a.png", durationSeconds: 2 }], captions: [], audioPath: "a.wav", outputPath: "o.mp4" }), /REEL_DURATION_INVALID/);
assert.throws(() => buildReelFfmpegArgs({ scenes: [{ imagePath: "a.png", durationSeconds: 4 }], captions: [{ pngPath: "c.png", start: 2, end: 1 }], audioPath: "a.wav", outputPath: "o.mp4" }), /REEL_CAPTION_TIMING_INVALID/);
const args = buildReelFfmpegArgs({ scenes: [{ imagePath: "a.png", durationSeconds: 3 }, { imagePath: "b.png", durationSeconds: 3 }], captions: [{ pngPath: "c.png", start: 0.1, end: 2 }], audioPath: "v.wav", outputPath: "o.mp4" });
for (const required of ["libx264", "aac", "+faststart", "yuv420p", "48000"]) assert.ok(args.includes(required), `argomento mancante: ${required}`);
assert.ok(!args.some((arg) => /xfade|subtitles=|ass=|drawtext/.test(arg)), "solo filtri disponibili in FFmpeg 4.1 statico, nessuna dipendenza da libass/fontconfig");

// --- ffprobe parsing + QA (no process) ---
const fakeProbe = parseFfprobeJson(JSON.stringify({
  streams: [
    { codec_type: "video", codec_name: "h264", width: 1080, height: 1920, avg_frame_rate: "30/1", pix_fmt: "yuv420p" },
    { codec_type: "audio", codec_name: "aac", sample_rate: "48000" },
  ],
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "12.000" },
}), 3_000_000);
assert.equal(reelTechnicalQa(fakeProbe, 12).status, "PASS");
assert.deepEqual(reelTechnicalQa({ ...fakeProbe, width: 1080, height: 1080 }).errors, ["REEL_NOT_1080X1920"]);
assert.ok(reelTechnicalQa({ ...fakeProbe, audioCodec: "" }).errors.includes("REEL_AUDIO_CODEC_INVALID"), "un Reel senza audio non supera il QA");

// --- Real render with the packaged FFmpeg binary ---
const dir = mkdtempSync(join(tmpdir(), "reel-render-test-"));
try {
  const scenes = [];
  for (let index = 0; index < 3; index += 1) {
    const imagePath = join(dir, `scene-${index}.png`);
    const made = await runMediaBinary("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `testsrc2=size=1440x2560:rate=1`, "-frames:v", "1", imagePath], { timeoutMs: 30_000 });
    assert.equal(made.code, 0, made.stderrTail);
    scenes.push({ imagePath, durationSeconds: 2.5 });
  }
  const audioPath = join(dir, "voice.wav");
  const audio = await runMediaBinary("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=7", "-ac", "1", "-ar", "24000", audioPath], { timeoutMs: 30_000 });
  assert.equal(audio.code, 0, audio.stderrTail);

  const captionCues = timeCaptionCues(splitCaptionCues("Questo è un test reale del motore Reel. Sottotitoli in italiano, voce e montaggio nel cloud."), 7);
  const captions = [];
  for (const [index, cue] of captionCues.entries()) {
    const pngPath = join(dir, `caption-${index}.png`);
    writeFileSync(pngPath, await renderCaptionPng(cue.text));
    captions.push({ pngPath, start: cue.start, end: cue.end });
  }
  const outputPath = join(dir, "reel.mp4");
  const rendered = await renderReel({ scenes, captions, audioPath, outputPath });
  assert.ok(existsSync(outputPath) && statSync(outputPath).size > 50_000, "MP4 reale prodotto");

  const qa = reelTechnicalQa(await probeReel(outputPath), 7.5);
  assert.equal(qa.status, "PASS", `QA tecnico fallito: ${qa.errors.join(",")}`);
  assert.equal(qa.probe.videoCodec, "h264");
  assert.equal(qa.probe.audioCodec, "aac");

  const framePath = join(dir, "frame.png");
  await extractFrame(outputPath, 1, framePath);
  assert.ok(statSync(framePath).size > 10_000, "frame di copertina/QA estraibile");
  if (process.env.REEL_TEST_KEEP_DIR) {
    console.log(`artefatti: ${dir}`);
  }
  console.log(`PASS reel render: ${qa.probe.width}x${qa.probe.height} ${qa.probe.videoCodec}/${qa.probe.audioCodec} ${qa.probe.durationSeconds}s ${Math.round(qa.probe.sizeBytes / 1024)}KB in ${rendered.durationMs}ms`);
} finally {
  if (!process.env.REEL_TEST_KEEP_DIR) rmSync(dir, { recursive: true, force: true });
}
