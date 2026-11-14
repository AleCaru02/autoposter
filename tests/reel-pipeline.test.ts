import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMediaBinary } from "../api/_lib/reel/media-binaries.js";
import { advanceRenderJob, ReelPipelineError, sceneDurations, type ReelDeps, type RenderJob, type StoredArtifact } from "../api/_lib/reel/reel-pipeline.js";
import { unsupportedScriptClaims, validateReelScript, type ReelScript, type ReelSource } from "../api/_lib/reel/reel-script.js";
import { classifyRenderError } from "../api/_lib/reel/render-jobs.js";

const source: ReelSource = {
  profileName: "Il Tuo Property Manager",
  industry: "Property management affitti brevi",
  tone: "professionale e diretto",
  topic: "Gestire un affitto breve a Milano",
  hook: "Affitti brevi a Milano: da dove partire?",
  caption: "Gestire un affitto breve significa prezzi aggiornati, check-in senza attese, pulizie coordinate e burocrazia in regola. Ti seguiamo su Airbnb e Booking con una valutazione gratuita.",
  cta: "Richiedi una valutazione gratuita",
  visualBrief: "Soggiorno luminoso a Milano",
  confirmedFacts: [],
};

const script: ReelScript = {
  title: "Affitti brevi a Milano",
  hook: "Affitti brevi a Milano: da dove partire?",
  scenes: [
    { voiceover: "Affitti brevi a Milano: da dove partire? Non basta pubblicare un annuncio.", visualBrief: "Soggiorno luminoso di un appartamento milanese pronto per gli ospiti, luce naturale" },
    { voiceover: "Servono prezzi aggiornati ogni giorno, check-in senza attese e pulizie coordinate.", visualBrief: "Tavolo con calendario delle prenotazioni e chiavi, atmosfera ordinata e professionale" },
    { voiceover: "Poi c'è la burocrazia: deve essere sempre in regola, senza sorprese.", visualBrief: "Scrivania pulita con documenti ordinati e laptop chiuso, luce calda del pomeriggio" },
    { voiceover: "Ti seguiamo su Airbnb e Booking. Richiedi una valutazione gratuita.", visualBrief: "Ingresso accogliente di un appartamento con valigia pronta, invito a entrare" },
  ],
  cta: "Richiedi una valutazione gratuita",
  caption: "Affitti brevi a Milano: prezzi, check-in, pulizie e burocrazia. Ti seguiamo su Airbnb e Booking.",
  hashtags: ["affittibrevi", "milano"],
  coverText: "Affitti brevi a Milano",
};

// --- Deterministic guards ---
assert.deepEqual(validateReelScript(script, source), [], "lo script fedele alla fonte è valido");
assert.deepEqual(unsupportedScriptClaims({ ...script, caption: "Abbiamo aumentato i ricavi del 35% per 120 proprietari." }, source).sort(), ["NUMBER_NOT_IN_SOURCE:120", "NUMBER_NOT_IN_SOURCE:35"]);
assert.ok(unsupportedScriptClaims({ ...script, cta: "Leggi le recensioni dei nostri ospiti" }, source).some((issue) => issue.startsWith("SOCIAL_PROOF_NOT_IN_SOURCE")), "recensioni non presenti nella fonte vengono bloccate");
const durations = sceneDurations(script, 12);
assert.ok(Math.abs(durations.reduce((a, b) => a + b, 0) - 12.6) < 0.01 && durations.every((value) => value >= 1));

assert.deepEqual(classifyRenderError("AI_BUDGET_HARD_STOP"), { state: "BLOCKED", retryable: false });
assert.deepEqual(classifyRenderError("CAPABILITY_CAPABILITY_LIMIT_REACHED"), { state: "BLOCKED", retryable: false });
assert.deepEqual(classifyRenderError("REEL_SCRIPT_REJECTED"), { state: "FAILED", retryable: false });
assert.deepEqual(classifyRenderError("OPENAI_TTS_HTTP_503"), { state: "FAILED", retryable: true });

// --- Pipeline with fake providers and the real FFmpeg renderer ---
const dir = mkdtempSync(join(tmpdir(), "reel-pipeline-test-"));
try {
  const blobs = new Map<string, Uint8Array>();
  const scenePath = join(dir, "scene.png");
  assert.equal((await runMediaBinary("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1440x2560:rate=1", "-frames:v", "1", scenePath], { timeoutMs: 30_000 })).code, 0);
  const voicePath = join(dir, "voice.mp3");
  assert.equal((await runMediaBinary("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=12", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k", voicePath], { timeoutMs: 30_000 })).code, 0);
  const scenePng = new Uint8Array(readFileSync(scenePath));
  const voiceMp3 = new Uint8Array(readFileSync(voicePath));

  const calls = { script: 0, scenes: [] as number[], tts: 0, finalize: 0, saves: 0 };
  let clock = 0;
  const store = async (_job: RenderJob, name: string, body: Uint8Array, contentType: string): Promise<StoredArtifact> => {
    const url = `https://test.public.blob.vercel-storage.com/${name}-${blobs.size}`;
    blobs.set(url, body);
    return { url, sizeBytes: body.byteLength, contentType };
  };
  const persisted: { step?: string; steps?: number; cost: number } = { cost: 0 };
  const deps: ReelDeps = {
    now: () => clock,
    loadContext: async () => ({ source, contentId: "00000000-0000-4000-8000-000000000001", provider: "INSTAGRAM", brandAccent: "#1b7e50" }),
    metered: async (input) => { const result = await input.run(); return { value: result.value, costUsd: result.usage.reduce((sum, event) => sum + (event.costUsd ?? 0), 0) }; },
    generateScript: async () => { calls.script += 1; return { value: structuredClone(script), usage: [{ operation: "REEL_SCRIPT", model: "fake", inputTokens: 1000, outputTokens: 500, costUsd: 0.01 }] }; },
    generateSceneImage: async ({ job, index }) => { calls.scenes.push(index); clock += 20_000; return { stored: await store(job, `scene-${index}.png`, scenePng, "image/png"), costUsd: 0.25 }; },
    synthesize: async () => { calls.tts += 1; return { value: { audio: voiceMp3, model: "fake-tts", voice: "alloy" }, usage: [{ operation: "REEL_TTS", model: "fake-tts", inputTokens: null, outputTokens: null, costUsd: null }] }; },
    store,
    fetchArtifact: async (url) => { const body = blobs.get(url); if (!body) throw new Error("missing blob"); return body; },
    saveStep: async (_job, patch) => { calls.saves += 1; persisted.step = patch.step; persisted.steps = patch.stepsCompleted; persisted.cost += patch.costDeltaUsd; },
    finalize: async (job, _context, artifacts) => { calls.finalize += 1; assert.equal(artifacts.qa?.technical, "PASS"); return { outputVariantId: "variant-1", videoAssetId: "asset-1" }; },
  };
  const job: RenderJob = { id: "11111111-1111-4111-8111-111111111111", profile_id: "22222222-2222-4222-8222-222222222222", source_variant_id: "33333333-3333-4333-8333-333333333333", step: "SCRIPT", steps_completed: 0, steps_total: 5, attempt_count: 1, max_attempts: 3, claim_token: "44444444-4444-4444-8444-444444444444", artifacts: {}, cost_usd: 0, dry_run: false };

  // First invocation: deadline hits during VISUALS (each scene costs 20s of fake clock).
  const first = await advanceRenderJob(job, deps, { deadlineAt: 150_000 });
  assert.deepEqual(first, { state: "RUNNING", step: "RENDER", reason: "DEADLINE" }, "si ferma prima del render che sforerebbe la deadline");
  assert.equal(calls.script, 1);
  assert.deepEqual(calls.scenes, [0, 1, 2, 3]);
  assert.equal(calls.tts, 1);
  assert.equal(job.steps_completed, 3);

  // Simulated crash: scene 3 lost from artifacts → resume regenerates only what is missing.
  job.step = "VISUALS";
  job.steps_completed = 1;
  job.artifacts = { ...job.artifacts, scenes: job.artifacts.scenes!.filter((scene) => scene.index !== 3) };
  const second = await advanceRenderJob(job, deps, { deadlineAt: Number.POSITIVE_INFINITY });
  assert.equal(second.state, "READY_FOR_REVIEW");
  assert.equal(calls.script, 1, "lo script non viene rigenerato alla ripresa");
  assert.deepEqual(calls.scenes, [0, 1, 2, 3, 3], "solo la scena mancante viene rigenerata");
  assert.equal(calls.tts, 1);
  assert.equal(calls.finalize, 1);
  assert.equal(job.steps_completed, 5);
  assert.equal(job.step, "DONE");
  assert.ok(job.artifacts.video && job.artifacts.video.probe.width === 1080 && job.artifacts.video.probe.height === 1920);
  assert.ok(Math.abs(job.artifacts.video.probe.durationSeconds - 12.6) < 0.6, `durata ${job.artifacts.video.probe.durationSeconds}`);
  assert.ok(job.artifacts.voice && job.artifacts.voice.seconds > 11.5);
  assert.ok(job.cost_usd > 1.2 && job.cost_usd < 1.4, `costo tracciato ${job.cost_usd}`);

  // A fabricated script is rejected, never rendered.
  const bad: RenderJob = { ...job, id: "55555555-5555-4555-8555-555555555555", step: "SCRIPT", steps_completed: 0, artifacts: {}, cost_usd: 0 };
  const badDeps: ReelDeps = { ...deps, generateScript: async () => ({ value: { ...structuredClone(script), caption: "Più 40% di prenotazioni garantito." }, usage: [] }) };
  await assert.rejects(advanceRenderJob(bad, badDeps, { deadlineAt: Number.POSITIVE_INFINITY }), (error: unknown) => error instanceof ReelPipelineError && error.code === "REEL_SCRIPT_REJECTED" && !error.retryable);

  console.log(`PASS reel pipeline: 5 step reali, ripresa idempotente, nessun doppio costo, QA tecnico ${job.artifacts.video.probe.durationSeconds}s, script inventati bloccati.`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
