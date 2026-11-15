import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMediaBinary } from "../api/_lib/reel/media-binaries.js";
import { advanceRenderJob, ReelPipelineError, type ReelDeps, type RenderJob, type StoredArtifact } from "../api/_lib/reel/reel-pipeline.js";
import { countWords, normalizeDurationPolicy, planVoiceFit, resolveDurationPolicy, scriptTargets } from "../api/_lib/reel/reel-duration.js";
import { narrationText, scriptLengthInstructions, validateReelScript, type ReelScript, type ReelSource } from "../api/_lib/reel/reel-script.js";
import { breakPenalty, splitCaptionCues, wrapCaptionLines } from "../api/_lib/reel/reel-captions.js";
import { loudnessQa, parseLoudnormJson } from "../api/_lib/reel/reel-probe.js";
import { classifyRenderError, enqueueReelJob, RENDER_FUNCTION_MAX_DURATION_SECONDS, RENDER_LEASE_SECONDS, renderRetryBackoffSeconds } from "../api/_lib/reel/render-jobs.js";
import { dispatchContinuation, MAX_CONTINUATION_HOPS, parseContinuationQuery, planContinuation } from "../api/_lib/reel/render-continuation.js";

// ---------- 2. Duration policy ----------
assert.deepEqual(resolveDurationPolicy({}), { minSeconds: 20, maxSeconds: 40, source: "DEFAULT" });
assert.deepEqual(resolveDurationPolicy({ profile: { minSeconds: 15, maxSeconds: 30 } }), { minSeconds: 15, maxSeconds: 30, source: "PROFILE" });
assert.deepEqual(resolveDurationPolicy({ content: { minSeconds: 30, maxSeconds: 60 }, profile: { minSeconds: 15, maxSeconds: 30 } }), { minSeconds: 30, maxSeconds: 60, source: "CONTENT" }, "content overrides profile");
assert.equal(normalizeDurationPolicy({ minSeconds: 5, maxSeconds: 40 }, "CONTENT"), null, "below 10 s is refused");
assert.equal(normalizeDurationPolicy({ minSeconds: 30, maxSeconds: 32 }, "CONTENT"), null, "span under 5 s is refused");
assert.equal(normalizeDurationPolicy({ minSeconds: "20", maxSeconds: 40 }, "CONTENT"), null);
const targets = scriptTargets({ minSeconds: 20, maxSeconds: 40 });
assert.deepEqual(targets, { minWords: 39, maxWords: 74, minScenes: 3, maxScenes: 6 });
assert.match(scriptLengthInstructions({ minSeconds: 20, maxSeconds: 40 }), /20-40 secondi.*tra 39 e 74 parole.*da 3 a 6 scene/s);

// The first real Reel (14/11/2026): 104 words, 52.8 s. It must now be caught before any image.
const realNarration = [
  "Prima di scegliere la formula locativa, apri una cartella. Non un portale.",
  "Per confrontare affitto breve, medio termine e 4+4, parti da ciò che sai davvero del tuo appartamento.",
  "Raccogli documenti, caratteristiche e dotazioni. Poi metti in chiaro i costi a carico della proprietà.",
  "Considera anche disponibilità e vincoli personali. E prepara foto aggiornate di ogni ambiente, degli affacci e dei dettagli da sistemare.",
  "L'affitto breve richiede calendario e organizzazione operativa. Il medio termine richiede disponibilità reale. Il 4+4 va valutato per un impegno più stabile.",
  "Gli adempimenti locali, contrattuali e fiscali vanno verificati sul caso specifico. Salva questo Reel prima della tua valutazione.",
];
const source: ReelSource = {
  profileName: "Il Tuo Property Manager", industry: "Property management", tone: null,
  topic: "Checklist per confrontare affitto breve, medio termine e 4+4",
  hook: "Prima di scegliere la formula locativa, apri una cartella. Non un portale.",
  caption: realNarration.join(" "), cta: "Salva questo Reel", visualBrief: null,
};
const brief = "Scrivania in legno chiaro con cartella blu aperta, luce naturale, atmosfera ordinata";
const longScript: ReelScript = { title: "Checklist", hook: source.hook!, scenes: realNarration.map((voiceover) => ({ voiceover, visualBrief: brief })), cta: "Salva questo Reel", caption: "Checklist formule locative.", hashtags: [], coverText: "Checklist formule" };
assert.equal(countWords(narrationText(longScript)), 104);
assert.ok(validateReelScript(longScript, source).includes("REEL_SCRIPT_TOO_LONG"), "the 53 s script is rejected for 20-40 s");
const shortScript: ReelScript = { ...longScript, scenes: [realNarration[0], realNarration[1], realNarration[2], realNarration[5]].map((voiceover) => ({ voiceover, visualBrief: brief })) };
assert.deepEqual(validateReelScript(shortScript, source), [], `fitted script is valid (${countWords(narrationText(shortScript))} words)`);

// Voice fit: keep, speed up slightly, pad, or block.
assert.deepEqual(planVoiceFit(30, { minSeconds: 20, maxSeconds: 40 }), { action: "OK", tailSeconds: 0.6 });
const speed = planVoiceFit(41.5, { minSeconds: 20, maxSeconds: 40 });
assert.equal(speed.action, "SPEED_UP");
assert.ok(speed.action === "SPEED_UP" && speed.tempo <= 1.12 && speed.expectedSeconds + speed.tailSeconds <= 40);
assert.equal(planVoiceFit(52.8, { minSeconds: 20, maxSeconds: 40 }).action, "BLOCK", "the real 52.8 s narration cannot be saved by a speed-up");
const padded = planVoiceFit(18, { minSeconds: 20, maxSeconds: 40 });
assert.ok(padded.action === "OK" && 18 + padded.tailSeconds >= 20, "a slightly short narration gets a longer final hold");
assert.equal(planVoiceFit(12, { minSeconds: 20, maxSeconds: 40 }).action, "BLOCK");

// ---------- 4. Captions ----------
const cues = splitCaptionCues(realNarration.join(" "));
for (const cue of cues) {
  assert.ok(cue.length <= 44 || !cue.includes(" "), `cue too long: ${cue}`);
  const last = cue.split(" ").at(-1)!;
  assert.ok(breakPenalty(last) < 60, `cue ends on a weak word: "${cue}"`);
  const lines = wrapCaptionLines(cue);
  assert.ok(lines.length <= 2);
  if (lines.length === 2) assert.ok(breakPenalty(lines[0].split(" ").at(-1)!) < 60, `line ends on a weak word: "${lines[0]}"`);
}
assert.ok(cues.some((cue) => cue.endsWith("della proprietà.")), "\"della\" stays with \"proprietà\"");
assert.ok(!cues.some((cue) => /\b(della|dei|degli|del|di|a|il|la|e)$/i.test(cue)), "no cue ends with an article, preposition or conjunction");
assert.equal(cues.join(" "), realNarration.join(" "), "captions keep every word, in order");

// ---------- 4. Loudness ----------
const sample = `[Parsed_loudnorm_0 @ 0x1] \n{\n\t"input_i" : "-23.31",\n\t"input_tp" : "-4.62",\n\t"input_lra" : "5.10",\n\t"input_thresh" : "-33.60",\n\t"output_i" : "-14.02",\n\t"output_tp" : "-1.50",\n\t"output_lra" : "4.90",\n\t"output_thresh" : "-24.30",\n\t"normalization_type" : "dynamic",\n\t"target_offset" : "0.02"\n}\n`;
assert.deepEqual(parseLoudnormJson(sample), { integratedLufs: -23.31, truePeakDb: -4.62, lra: 5.1, threshold: -33.6, offset: 0.02 });
assert.deepEqual(loudnessQa({ integratedLufs: -23.3, truePeakDb: -4.6 }), ["REEL_LOUDNESS_OUT_OF_RANGE"], "the first real Reel (-23 dB mean) would now fail QA");
assert.deepEqual(loudnessQa({ integratedLufs: -14.1, truePeakDb: -1.6 }), []);
assert.deepEqual(loudnessQa({ integratedLufs: -14, truePeakDb: -0.2 }), ["REEL_TRUE_PEAK_CLIPPING"]);

// ---------- 3. Continuation and retries ----------
const jobId = "fed59750-2d9c-4daa-9375-3d635278e99f";
const prod = planContinuation({ VERCEL_ENV: "production", VERCEL_URL: "post-automatici-canonical-abc.vercel.app", CRON_SECRET: "secret" }, jobId, 1);
assert.ok(prod.dispatch && prod.url === `https://post-automatici-canonical-abc.vercel.app/api/render/tick?jobId=${jobId}&hop=1` && prod.headers.authorization === "Bearer secret");
assert.deepEqual(planContinuation({ VERCEL_ENV: "preview", VERCEL_URL: "x.vercel.app", CRON_SECRET: "s" }, jobId, 1), { dispatch: false, reason: "PREVIEW_PROTECTED_NO_BYPASS" });
const preview = planContinuation({ VERCEL_ENV: "preview", VERCEL_URL: "x.vercel.app", CRON_SECRET: "s", VERCEL_AUTOMATION_BYPASS_SECRET: "b" }, jobId, 2, 61);
assert.ok(preview.dispatch && preview.headers["x-vercel-protection-bypass"] === "b" && preview.url.endsWith("&hop=2&delay=61"));
assert.deepEqual(planContinuation({ VERCEL_URL: "x.vercel.app", CRON_SECRET: "s" }, jobId, MAX_CONTINUATION_HOPS + 1), { dispatch: false, reason: "HOP_LIMIT" });
assert.deepEqual(planContinuation({ VERCEL_URL: "x.vercel.app" }, jobId, 1), { dispatch: false, reason: "CRON_SECRET_MISSING" });
assert.deepEqual(planContinuation({ VERCEL_URL: "evil.com/path?", CRON_SECRET: "s" }, jobId, 1), { dispatch: false, reason: "DEPLOYMENT_URL_MISSING" });
assert.deepEqual(parseContinuationQuery({ jobId, hop: "3", delay: "999" }), { jobId, hop: 3, delaySeconds: 180 });
assert.equal(parseContinuationQuery({ jobId: "x'; drop" }).jobId, null);
let seen: { url: string; auth: string | null } | null = null;
const fakeFetch = (async (url: string, init?: RequestInit) => { seen = { url, auth: new Headers(init?.headers).get("authorization") }; return new Response("{}", { status: 202 }); }) as unknown as typeof fetch;
assert.deepEqual(await dispatchContinuation({ VERCEL_URL: "x.vercel.app", CRON_SECRET: "s" }, jobId, 1, 0, fakeFetch), { dispatched: true, status: 202 });
assert.equal(seen!.auth, "Bearer s");
const rejected = (async () => new Response("", { status: 401 })) as unknown as typeof fetch;
assert.deepEqual(await dispatchContinuation({ VERCEL_URL: "x.vercel.app", CRON_SECRET: "s" }, jobId, 1, 0, rejected), { dispatched: false, reason: "HTTP_401" });
assert.deepEqual([1, 2, 3].map(renderRetryBackoffSeconds), [30, 60, 120]);
assert.deepEqual(classifyRenderError("REEL_VOICE_TOO_LONG"), { state: "FAILED", retryable: false });
assert.deepEqual(classifyRenderError("OPENAI_IMAGE_HTTP_502"), { state: "FAILED", retryable: true });

const route = readFileSync(new URL("../api/render.ts", import.meta.url), "utf8");
assert.match(route, /maxDuration: 800/);
assert.match(route, /return res\.status\(202\)\.json\(\{ ok: true, accepted: jobId, hop \}\)/, "a continuation is accepted immediately and worked in waitUntil");
assert.match(route, /driveRenderJob\(queued\.id, deadlineAt, 0\)/, "enqueue drives the job with in-place retries and hand-off");
assert.match(readFileSync(new URL("../db/migrations/20261115_reel_duration_policy.sql", import.meta.url), "utf8"), /reel_max_seconds - reel_min_seconds >= 5/);

// ---------- 2. Pipeline: correct or block before paid images ----------
const dir = mkdtempSync(join(tmpdir(), "reel-length-test-"));
try {
  const tone = async (seconds: number) => {
    const path = join(dir, `tone-${seconds}.mp3`);
    assert.equal((await runMediaBinary("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=220:duration=${seconds}`, "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k", path], { timeoutMs: 30_000 })).code, 0);
    return new Uint8Array(readFileSync(path));
  };
  const blobs = new Map<string, Uint8Array>();
  const makeDeps = (scripts: ReelScript[], voiceSeconds: number, calls: { script: number; tts: number; images: number; saved: number; cost: number }): ReelDeps => ({
    now: () => 0,
    loadContext: async () => ({ source, contentId: "00000000-0000-4000-8000-000000000001", provider: "INSTAGRAM", brandAccent: null }),
    metered: async (input) => { const result = await input.run(); return { value: result.value, costUsd: result.usage.reduce((sum, event) => sum + (event.costUsd ?? 0), 0) }; },
    generateScript: async (_source, options) => {
      const value = structuredClone(scripts[Math.min(calls.script, scripts.length - 1)]);
      if (calls.script > 0) assert.match(options.feedback ?? "", /104 parole.*39-74 parole/s, "the corrective request states the measured and the allowed length");
      calls.script += 1;
      return { value, usage: [{ operation: "REEL_SCRIPT", model: "fake", inputTokens: 1, outputTokens: 1, costUsd: 0.011 }] };
    },
    generateSceneImage: async () => { calls.images += 1; throw new Error("images must not be generated in this test"); },
    synthesize: async () => { calls.tts += 1; return { value: { audio: await tone(voiceSeconds), model: "fake-tts", voice: "alloy" }, usage: [{ operation: "REEL_TTS", model: "fake-tts", inputTokens: null, outputTokens: null, costUsd: 0.013 }] }; },
    store: async (_job, name, body, contentType): Promise<StoredArtifact> => { const url = `https://t/${name}-${blobs.size}`; blobs.set(url, body); return { url, sizeBytes: body.byteLength, contentType }; },
    fetchArtifact: async (url) => blobs.get(url)!,
    saveStep: async (_job, patch) => { calls.saved += 1; calls.cost += patch.costDeltaUsd; },
    finalize: async () => { throw new Error("not reached"); },
  });
  const newJob = (id: string): RenderJob => ({ id, profile_id: "22222222-2222-4222-8222-222222222222", source_variant_id: null, step: "SCRIPT", steps_completed: 0, steps_total: 5, attempt_count: 1, max_attempts: 3, claim_token: "44444444-4444-4444-8444-444444444444", artifacts: {}, cost_usd: 0, dry_run: false, duration: { minSeconds: 20, maxSeconds: 40, source: "DEFAULT" } });
  const stopBeforeVisuals = { deadlineAt: 1_000_000, reserveMs: { VISUALS: 10_000_000 } };

  // Too long → one corrective rewrite → fitted script → voice measured and fitted → stops before images.
  {
    const calls = { script: 0, tts: 0, images: 0, saved: 0, cost: 0 };
    const job = newJob("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const result = await advanceRenderJob(job, makeDeps([longScript, shortScript], 30, calls), stopBeforeVisuals);
    assert.deepEqual(result, { state: "RUNNING", step: "VISUALS", reason: "DEADLINE" });
    assert.equal(calls.script, 2, "exactly one corrective rewrite");
    assert.equal(job.artifacts.lengthControl?.scriptAttempts, 2);
    assert.equal(job.artifacts.voice?.tempo, 1);
    assert.equal(calls.images, 0);
    assert.ok(Math.abs(job.cost_usd - (0.022 + 0.013)) < 1e-9, `both script calls and the voice are counted: ${job.cost_usd}`);
  }
  // Still too long after the rewrite → rejected, cost recorded, no voice, no images.
  {
    const calls = { script: 0, tts: 0, images: 0, saved: 0, cost: 0 };
    const job = newJob("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    await assert.rejects(advanceRenderJob(job, makeDeps([longScript], 30, calls), stopBeforeVisuals), (error: unknown) => error instanceof ReelPipelineError && error.code === "REEL_SCRIPT_REJECTED" && /REEL_SCRIPT_TOO_LONG/.test(error.message));
    assert.deepEqual([calls.script, calls.tts, calls.images], [2, 0, 0]);
    assert.ok(Math.abs(calls.cost - 0.022) < 1e-9, "the spent script cost is saved before stopping");
  }
  // Narration slightly too long → sped up (≤ 12 %) and kept under 40 s.
  {
    const calls = { script: 0, tts: 0, images: 0, saved: 0, cost: 0 };
    const job = newJob("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    await advanceRenderJob(job, makeDeps([shortScript], 41.5, calls), stopBeforeVisuals);
    const voice = job.artifacts.voice!;
    assert.ok(voice.tempo! > 1 && voice.tempo! <= 1.12, `tempo ${voice.tempo}`);
    assert.ok(voice.seconds + voice.tailSeconds! <= 40.05, `fitted ${voice.seconds}s + ${voice.tailSeconds}s`);
    assert.ok(Math.abs(voice.rawSeconds! - 41.5) < 0.2);
    assert.equal(calls.images, 0);
  }
  // Narration far too long → blocked before images, TTS cost recorded.
  {
    const calls = { script: 0, tts: 0, images: 0, saved: 0, cost: 0 };
    const job = newJob("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    await assert.rejects(advanceRenderJob(job, makeDeps([shortScript], 52.8, calls), { deadlineAt: Number.POSITIVE_INFINITY }), (error: unknown) => error instanceof ReelPipelineError && error.code === "REEL_VOICE_TOO_LONG" && !error.retryable);
    assert.equal(calls.images, 0, "no image is paid for a narration that cannot fit");
    assert.ok(Math.abs(job.cost_usd - 0.024) < 1e-9, `script + voice cost recorded: ${job.cost_usd}`);
    assert.equal(job.artifacts.voice?.blocked?.code, "REEL_VOICE_TOO_LONG", "the decision is stored, a resume does not pay the TTS again");
    await assert.rejects(advanceRenderJob(job, makeDeps([shortScript], 52.8, calls), { deadlineAt: Number.POSITIVE_INFINITY }), (error: unknown) => error instanceof ReelPipelineError && error.code === "REEL_VOICE_TOO_LONG");
    assert.equal(calls.tts, 1, "resume reuses the stored decision");
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// ---------- Captions: ALL-CAPS headings end a cue ----------
{
  const headingCues = splitCaptionCues("Verifica sempre i documenti. DOCUMENTI DELL’IMMOBILE Titolo di proprietà, planimetria e regolamento condominiale. IMU e TARI restano a carico tuo.");
  assert.ok(headingCues.some((cue) => cue === "DOCUMENTI DELL’IMMOBILE"), `heading isolated: ${JSON.stringify(headingCues)}`);
  assert.ok(!headingCues.some((cue) => /IMMOBILE Titolo/.test(cue)), "heading never merged with the next sentence");
  assert.ok(headingCues.some((cue) => cue.startsWith("IMU e TARI")), "a single acronym does not split a sentence");
}

// ---------- TTS cost from official rates ----------
{
  const { estimateTtsCostUsd, TTS_ESTIMATED_USD_PER_MINUTE } = await import("../api/_lib/reel/openai-tts.js");
  assert.ok(Math.abs(TTS_ESTIMATED_USD_PER_MINUTE - 0.015) < 1e-12, "1,250 audio tokens/min x $12/M = $0.015/min");
  assert.ok(Math.abs(estimateTtsCostUsd(52.8, 600) - 0.01329) < 1e-6, `first real Reel narration: ${estimateTtsCostUsd(52.8, 600)}`);
  assert.equal(estimateTtsCostUsd(0, 0), 0);
}

// ---------- No double execution ----------
{
  const routeSource = readFileSync(new URL("../api/render.ts", import.meta.url), "utf8");
  const vercelConfig = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  const routeMax = Number(/maxDuration:\s*(\d+)/.exec(routeSource)?.[1]);
  const configMax = Number(Object.values(vercelConfig.functions ?? {}).map((item) => (item as { maxDuration?: number }).maxDuration).find((value) => value === routeMax));
  assert.equal(routeMax, RENDER_FUNCTION_MAX_DURATION_SECONDS, "lease constant tracks the route maxDuration");
  assert.equal(configMax, RENDER_FUNCTION_MAX_DURATION_SECONDS, "vercel.json maxDuration matches");
  assert.ok(RENDER_LEASE_SECONDS > routeMax && RENDER_LEASE_SECONDS <= 900, "a lease outlives the invocation that holds it (claim functions accept up to 900 s)");
  const jobsSource = readFileSync(new URL("../api/_lib/reel/render-jobs.ts", import.meta.url), "utf8");
  const finalize = jobsSource.slice(jobsSource.indexOf("export async function finalizeRenderJob"), jobsSource.indexOf("export async function listRenderJobs"));
  assert.match(finalize, /state='RUNNING' for update/, "finalize locks the job row first");
  assert.equal((finalize.match(/where exists \(select 1 from public\.render_jobs where id=\$\{job\.id\}::uuid and claim_token=\$\{job\.claim_token\}::uuid and state='RUNNING'\)/g) ?? []).length, 3, "every output insert requires the live claim");
  assert.match(finalize, /RENDER_LEASE_LOST/, "a runner without the claim gets an error, not a second output");
  const migration = readFileSync(new URL("../db/migrations/20261116_render_jobs_single_active.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS render_jobs_one_active_per_source/);
  assert.match(migration, /WHERE state IN \('QUEUED','RUNNING'\)/);

  // enqueue: an active job for the same source is returned, never duplicated (also after a 23505 race).
  const sourceRow = [{ id: "s", min_seconds: null, max_seconds: null }];
  const ids = { profileId: "11111111-1111-4111-8111-111111111111", sourceVariantId: "22222222-2222-4222-8222-222222222222", requestedBy: null };
  let inserts = 0;
  const fakeSql = (active: Array<Record<string, unknown>>, raceWinner: Array<Record<string, unknown>> | null) => {
    let activeCalls = 0;
    return ((strings: TemplateStringsArray) => {
      const text = strings.join("?");
      if (text.includes("from public.content_variants variant")) return Promise.resolve(sourceRow);
      if (text.includes("count(*)::int")) return Promise.resolve([{ count: 0 }]);
      if (text.includes("false as created")) { activeCalls += 1; return Promise.resolve(activeCalls === 1 ? active : raceWinner ?? []); }
      if (text.includes("insert into public.render_jobs")) {
        inserts += 1;
        if (raceWinner) return Promise.reject(Object.assign(new Error("duplicate key"), { code: "23505" }));
        return Promise.resolve([{ id: "new", state: "QUEUED", created: true }]);
      }
      throw new Error(`unexpected query: ${text.slice(0, 60)}`);
    }) as unknown as Parameters<typeof enqueueReelJob>[0];
  };
  const reused = await enqueueReelJob(fakeSql([{ id: "running", state: "RUNNING", created: false }], null), { ...ids, requestId: "33333333-3333-4333-8333-333333333333" });
  assert.deepEqual(reused, { id: "running", state: "RUNNING", created: false }, "second click returns the active job");
  assert.equal(inserts, 0, "no insert while a job for the source is active");
  const raced = await enqueueReelJob(fakeSql([], [{ id: "winner", state: "QUEUED", created: false }]), { ...ids, requestId: "44444444-4444-4444-8444-444444444444" });
  assert.deepEqual(raced, { id: "winner", state: "QUEUED", created: false }, "lost race returns the winner, created=false (no second drive)");
  const fresh = await enqueueReelJob(fakeSql([], null), { ...ids, requestId: "55555555-5555-4555-8555-555555555555" });
  assert.equal(fresh.created, true);
}

console.log(`PASS reel length/audio/captions/continuation: script 104→${countWords(narrationText(shortScript))} parole con 1 riscrittura, voce accelerata ≤12% o bloccata prima delle immagini, ${cues.length} sottotitoli senza parole deboli a fine riga, loudness -14 LUFS/TP ≤ -1, ripresa cloud con hop limitati.`);
