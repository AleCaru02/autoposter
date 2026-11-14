import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { neon } from "@neondatabase/serverless";
import { isIsolatedPreview } from "../neon-endpoints.js";
import { runMediaBinary } from "./media-binaries.js";
import { ITALIAN_WORDS_PER_SECOND, type ReelScript, type ReelSource } from "./reel-script.js";
import { fetchArtifact, storeReelArtifact } from "./reel-storage.js";
import { finalizeRenderJob, saveRenderStep } from "./render-jobs.js";
import { loadReelContext } from "./reel-runtime.js";
import { ReelPipelineError, type ReelDeps, type RenderJob } from "./reel-pipeline.js";

/**
 * Dry run: the real pipeline (queue, lease, Neon QA persistence, Vercel Blob, FFmpeg render,
 * technical QA, REEL variant) with deterministic stand-ins for the three paid AI steps.
 * Allowed only on an isolated Vercel preview; never available in production.
 */
export function dryRunAllowed(env: Record<string, string | undefined> = process.env) {
  return env.VERCEL_ENV === "preview" && isIsolatedPreview(env);
}

function sentences(text: string) {
  return (text.replace(/\s+/g, " ").match(/[^.!?…]+[.!?…]+/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 20 && sentence.length <= 240 && !/#/.test(sentence));
}

/** Script built only from the source text: no model, no invention. */
export function dryRunScript(source: ReelSource): ReelScript {
  const picked = sentences(`${source.hook ?? ""}. ${source.caption ?? ""}`).slice(0, 4);
  while (picked.length < 3) picked.push(`${source.topic}.`.padEnd(24, "."));
  const palette = ["luce naturale calda", "toni verdi e neutri", "atmosfera ordinata e professionale", "inquadratura verticale pulita"];
  return {
    title: `Prova a secco · ${source.topic}`.slice(0, 120),
    hook: (source.hook ?? picked[0]).slice(0, 90),
    scenes: picked.map((voiceover, index) => ({ voiceover, visualBrief: `Scena ${index + 1} di prova senza AI: fondo a tinta unita, ${palette[index % palette.length]}.` })),
    cta: (source.cta ?? "Scopri il servizio").slice(0, 120),
    caption: `[PROVA A SECCO, nessuna AI] ${(source.caption ?? "").slice(0, 400)}`,
    hashtags: [],
    coverText: "Prova a secco",
  };
}

const SCENE_COLORS = ["0x1b7e50", "0x26302a", "0x0c833d", "0x5e6b63", "0x19c95d", "0x111713"];

async function ffmpegToBytes(args: string[], fileName: string) {
  const dir = mkdtempSync(join(tmpdir(), "reel-dry-"));
  try {
    const out = join(dir, fileName);
    const result = await runMediaBinary("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args, out], { timeoutMs: 60_000 });
    if (result.code !== 0) throw new ReelPipelineError("REEL_DRY_RUN_MEDIA_FAILED", false, result.stderrTail.slice(-200));
    return new Uint8Array(readFileSync(out));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function createDryRunReelRuntime(env: { DATABASE_URL?: string; BLOB_READ_WRITE_TOKEN?: string }): ReelDeps {
  if (!dryRunAllowed()) throw new ReelPipelineError("REEL_DRY_RUN_NOT_ALLOWED", false);
  if (!env.DATABASE_URL) throw new ReelPipelineError("DATABASE_URL_REQUIRED", false);
  if (!env.BLOB_READ_WRITE_TOKEN) throw new ReelPipelineError("REEL_STORAGE_NOT_CONFIGURED", false);
  const sql = neon(env.DATABASE_URL);
  const store = (job: RenderJob, name: string, body: Uint8Array, contentType: string) => storeReelArtifact({ profileId: job.profile_id, jobId: job.id, name, body, contentType, token: env.BLOB_READ_WRITE_TOKEN });
  return {
    now: () => Date.now(),
    loadContext: (job) => loadReelContext(sql, job),
    // No entitlement or budget is consumed: nothing here can reach a paid provider.
    metered: async (input) => { const result = await input.run(); return { value: result.value, costUsd: 0 }; },
    generateScript: async (source) => ({ value: dryRunScript(source), usage: [] }),
    async generateSceneImage({ job, index }) {
      const png = await ffmpegToBytes(["-f", "lavfi", "-i", `color=c=${SCENE_COLORS[index % SCENE_COLORS.length]}:s=1440x2560:d=1`, "-frames:v", "1"], "scene.png");
      return { stored: await store(job, `scene-${index}.png`, png, "image/png"), costUsd: 0 };
    },
    async synthesize(text) {
      const seconds = Math.min(Math.max(text.split(/\s+/).filter(Boolean).length / ITALIAN_WORDS_PER_SECOND, 12), 45);
      const audio = await ffmpegToBytes(["-f", "lavfi", "-i", `sine=frequency=220:duration=${seconds.toFixed(2)}`, "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k"], "voice.mp3");
      return { value: { audio, model: "dry-run-tone", voice: "none" }, usage: [{ operation: "REEL_TTS_DRY_RUN", model: "dry-run-tone", inputTokens: null, outputTokens: null, costUsd: 0 }] };
    },
    store,
    fetchArtifact: (url) => fetchArtifact(url),
    saveStep: (job, patch) => saveRenderStep(sql, job, patch),
    finalize: (job, context, artifacts) => finalizeRenderJob(sql, job, context, artifacts),
  };
}
