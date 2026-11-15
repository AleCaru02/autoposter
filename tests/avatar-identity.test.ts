import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMediaBinary } from "../api/_lib/reel/media-binaries.js";
import { ReelPipelineError, type RenderJob, type StoredArtifact } from "../api/_lib/reel/reel-pipeline.js";
import { dryRunScript } from "../api/_lib/reel/reel-dry-run.js";
import type { ReelSource } from "../api/_lib/reel/reel-script.js";
import { buildAvatarReelFfmpegArgs } from "../api/_lib/reel/reel-render.js";
import { classifyRenderError } from "../api/_lib/reel/render-jobs.js";
import { deriveSetupStates, scopesForKind, videoChecks } from "../api/_lib/avatar/avatar-requirements.js";
import { identityPathname, pathnameBelongsTo, IDENTITY_UPLOAD_RULES } from "../api/_lib/avatar/identity-storage.js";
import { IDENTITY_CONSENT_VERSION, identityConsentText, sha256Hex } from "../api/_lib/avatar/consent-text.js";
import { AVATAR_PROVIDERS, avatarProviderReadiness, createHeyGenProvider, createLiveAvatarProvider, estimateAvatarRenderUsd, AvatarProviderError } from "../api/_lib/avatar/avatar-provider.js";
import { advanceAvatarReelJob, avatarTargetSeconds, type AvatarReelDeps } from "../api/_lib/avatar/avatar-reel.js";

const P1 = "08d029d7-40dd-4885-b0fb-1114206923b5";
const P2 = "11111111-1111-4111-8111-111111111111";

// ---------- 1. Private storage scoping ----------
const pathname = identityPathname(P1, "VIDEO", "video/quicktime", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
assert.equal(pathname, `identity/${P1}/video/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.mov`);
assert.ok(pathnameBelongsTo(pathname, P1, "VIDEO"));
assert.ok(!pathnameBelongsTo(pathname, P2), "a profile never reaches another profile's files");
assert.ok(!pathnameBelongsTo(pathname, P1, "PHOTO"), "kind folder enforced");
assert.ok(!pathnameBelongsTo(`identity/${P1}/../${P2}/video/x.mp4`, P1), "no path traversal");
assert.throws(() => identityPathname(P1, "PHOTO", "application/pdf"), /IDENTITY_CONTENT_TYPE_NOT_ALLOWED/);
assert.ok(IDENTITY_UPLOAD_RULES.VIDEO.maxBytes >= 500 * 1024 * 1024, "a 5-minute iPhone video fits");

// ---------- 2. Consent ----------
assert.match(identityConsentText("Alessandro Caruso", ["FACE", "VOICE"]), /Alessandro Caruso.*il mio volto e la mia voce.*revocare/s);
assert.match(identityConsentText("A B", ["VOICE"]), /la mia voce/);
assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
assert.match(IDENTITY_CONSENT_VERSION, /^it-\d{4}-\d{2}-v\d+$/);
assert.deepEqual(scopesForKind("VOICE"), ["VOICE"]);
assert.deepEqual(scopesForKind("VIDEO"), ["FACE"]);

// ---------- 3. Material requirements and setup state ----------
{
  const good = videoChecks({ durationSeconds: 180, width: 1080, height: 1920, hasAudio: true });
  assert.ok(good.every((check) => check.ok), "3 min vertical 1080p with audio passes everything");
  const short = videoChecks({ durationSeconds: 10, width: 720, height: 1280, hasAudio: false });
  assert.deepEqual(short.filter((check) => check.blocking && !check.ok).map((check) => check.code).sort(), ["VIDEO_AUDIO", "VIDEO_DURATION_MIN"]);
  assert.ok(short.some((check) => check.code === "VIDEO_RESOLUTION_RECOMMENDED" && !check.ok && !check.blocking), "720p is a warning, not a block");
  const video = { id: "v", kind: "VIDEO" as const, status: "READY" as const, duration_seconds: 180 };
  assert.deepEqual(deriveSetupStates({ provider: "HEYGEN", consentScopes: null, assets: [video] }), { face: "NOT_STARTED", voice: "NOT_STARTED", missing: ["CONSENT"] });
  assert.deepEqual(deriveSetupStates({ provider: "HEYGEN", consentScopes: ["FACE", "VOICE"], assets: [video] }), { face: "MATERIALS_READY", voice: "MATERIALS_READY", missing: [] });
  assert.equal(deriveSetupStates({ provider: "HEYGEN", consentScopes: ["FACE"], assets: [video] }).voice, "NOT_STARTED", "voice is never cloned without the VOICE scope");
  assert.deepEqual(deriveSetupStates({ provider: "HIGGSFIELD_INTONE", consentScopes: ["FACE", "VOICE"], assets: [video] }).missing, ["PHOTO", "VOICE"]);
}

// ---------- 4. Provider choice, prices and the paid switch ----------
assert.equal(AVATAR_PROVIDERS.HEYGEN.role, "PRIMARY");
assert.equal(AVATAR_PROVIDERS.HIGGSFIELD_INTONE.integrated, false, "the alternative is documented, not integrated");
assert.ok(Math.abs(estimateAvatarRenderUsd("HEYGEN", 30)! - 30 * (4.83 / 60) * 1.1) < 1e-4);
assert.equal(estimateAvatarRenderUsd("HIGGSFIELD_INTONE", 30), null);
assert.deepEqual(avatarProviderReadiness("HEYGEN", {}).missing, ["AVATAR_PROVIDER_LIVE_ENABLED", "HEYGEN_API_KEY"]);
assert.equal(avatarProviderReadiness("HEYGEN", { AVATAR_PROVIDER_LIVE_ENABLED: "true", HEYGEN_API_KEY: "k" }).live, true);
assert.throws(() => createLiveAvatarProvider("HEYGEN", { HEYGEN_API_KEY: "k" }), (error: unknown) => error instanceof AvatarProviderError && error.code === "AVATAR_PROVIDER_NOT_ENABLED");

// HeyGen adapter against a fake API (request shapes from the official v3 docs).
{
  const calls: Array<{ url: string; method: string; body: unknown; key: string | null }> = [];
  const replies: Record<string, unknown> = {
    "POST /v3/avatars": { data: { avatar_item: { id: "look_1", default_voice_id: "voice_1" }, avatar_group: { id: "group_1" } } },
    "POST /v3/avatars/group_1/consent": { data: { url: "https://heygen.example/consent/abc" } },
    "GET /v3/avatars/looks/look_1": { data: { status: "processing" } },
    "POST /v3/videos": { data: { video_id: "vid_1" } },
    "GET /v3/videos/vid_1": { data: { status: "completed", video_url: "https://cdn.example/v.mp4", duration: 31.2 } },
  };
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url: url.pathname, method, body: init?.body ? JSON.parse(String(init.body)) : null, key: new Headers(init?.headers).get("x-api-key") });
    const reply = replies[`${method} ${url.pathname}`];
    return reply ? new Response(JSON.stringify(reply), { status: 200 }) : new Response('{"message":"nope"}', { status: 404 });
  }) as typeof fetch;
  const heygen = createHeyGenProvider({ apiKey: "test-key", fetcher });
  assert.deepEqual(await heygen.createIdentity({ name: "Alessandro", trainingVideoUrl: "https://signed.example/v.mp4" }), { avatarId: "look_1", groupId: "group_1", voiceId: "voice_1" });
  assert.deepEqual(calls[0].body, { type: "digital_twin", name: "Alessandro", file: { type: "url", url: "https://signed.example/v.mp4" } });
  assert.equal(calls[0].key, "test-key");
  assert.equal((await heygen.startConsent("group_1")).consentUrl, "https://heygen.example/consent/abc");
  assert.equal((await heygen.identityStatus("look_1")).status, "TRAINING");
  assert.deepEqual(await heygen.renderTalkingVideo({ avatarId: "look_1", voiceId: "voice_1", script: "Ciao" }), { renderId: "vid_1" });
  assert.deepEqual(calls[3].body, { type: "avatar", avatar_id: "look_1", engine: { type: "heygen-avatar-6" }, voice_id: "voice_1", script: "Ciao" });
  assert.deepEqual(await heygen.renderStatus("vid_1"), { status: "COMPLETED", videoUrl: "https://cdn.example/v.mp4", durationSeconds: 31.2, error: null });
  await assert.rejects(heygen.renderStatus("missing"), (error: unknown) => error instanceof AvatarProviderError && error.code === "HEYGEN_HTTP_404" && !error.retryable);
}

// ---------- 5. Avatar Reel through the existing pipeline (real FFmpeg, zero cost) ----------
assert.deepEqual(classifyRenderError("IDENTITY_CONSENT_REQUIRED"), { state: "FAILED", retryable: false });
assert.deepEqual(classifyRenderError("AVATAR_PROVIDER_NOT_ENABLED"), { state: "FAILED", retryable: false });
assert.deepEqual(classifyRenderError("AVATAR_RENDER_TIMEOUT"), { state: "FAILED", retryable: true });
assert.throws(() => buildAvatarReelFfmpegArgs({ videoPath: "a.mp4", durationSeconds: 120, captions: [], outputPath: "o.mp4" }), /REEL_DURATION_INVALID/);
assert.match(buildAvatarReelFfmpegArgs({ videoPath: "a.mp4", durationSeconds: 25, captions: [{ pngPath: "c.png", start: 0, end: 2 }], outputPath: "o.mp4" }).join(" "), /crop=1080:1920.*overlay=0:0:enable='between\(t,0,2\)'/s);

const source: ReelSource = {
  profileName: "Il Tuo Property Manager", industry: "Property management affitti brevi", tone: "professionale e diretto",
  topic: "Preparare un appartamento per gli affitti brevi a Milano", hook: "Prima di affittare, prepara la cartella del tuo appartamento",
  caption: "Prima di affittare il tuo appartamento a Milano prepara una cartella con planimetria, certificazione energetica, regolamento condominiale e foto aggiornate di ogni stanza. Indica i costi a carico della proprietà, le dotazioni presenti e le date in cui l'immobile è davvero disponibile. Con queste informazioni il confronto tra affitto breve, medio termine e contratto quattro più quattro diventa concreto e più semplice da valutare insieme.",
  cta: "Richiedi una valutazione gratuita", visualBrief: "Soggiorno luminoso", confirmedFacts: [],
};
const dir = mkdtempSync(join(tmpdir(), "avatar-reel-test-"));
try {
  // A synthetic "talking head": landscape test video with speech-like audio (tone), 40 s.
  const clipPath = join(dir, "clip.mp4");
  assert.equal((await runMediaBinary("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=40", "-f", "lavfi", "-i", "sine=frequency=180:duration=40", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", clipPath], { timeoutMs: 120_000 })).code, 0);
  const clip = new Uint8Array(readFileSync(clipPath));
  const privateFiles = new Map<string, Uint8Array>();
  const publicStores: string[] = [];
  const calls = { avatar: 0, saved: 0, cost: 0 };
  const makeDeps = (live: boolean): AvatarReelDeps => ({
    now: () => 0,
    loadContext: async () => ({ source, contentId: "00000000-0000-4000-8000-000000000001", provider: "INSTAGRAM", brandAccent: "#1B7E50" }),
    metered: async (input) => { const result = await input.run(); return { value: result.value, costUsd: 0 }; },
    generateScript: async (src, options) => ({ value: dryRunScript(src, options.policy), usage: [] }),
    generateSceneImage: async () => { throw new Error("no stills in an avatar Reel"); },
    synthesize: async () => { throw new Error("no separate TTS in an avatar Reel"); },
    store: async (_job, name): Promise<StoredArtifact> => { publicStores.push(name); throw new Error("public store must not be used"); },
    fetchArtifact: async (url) => privateFiles.get(url.replace("signed://", ""))!,
    saveStep: async (_job, patch) => { calls.saved += 1; calls.cost += patch.costDeltaUsd; },
    finalize: async (job) => ({ outputVariantId: "variant", videoAssetId: `asset:${job.artifacts.video?.url}` }),
    provider: "HEYGEN",
    avatarClip: async (job, input) => {
      calls.avatar += 1;
      const key = `identity/${job.profile_id}/renders/${job.id}/avatar.mp4`;
      privateFiles.set(key, clip);
      return { pathname: key, seconds: 40, simulated: !live, costUsd: live ? Number((input.targetSeconds * 4.83 / 60).toFixed(4)) : 0 };
    },
    privateUrl: async (key) => `signed://${key}`,
    fetchPrivate: async (key) => privateFiles.get(key)!,
    storePrivate: async (job, name, body, contentType) => {
      const key = `identity/${job.profile_id}/renders/${job.id}/${name}`;
      privateFiles.set(key, body);
      return { url: `private:${key}`, pathname: key, sizeBytes: body.byteLength, contentType };
    },
  });
  const newJob = (id: string, dryRun: boolean): RenderJob => ({ id, profile_id: P1, source_variant_id: null, step: "SCRIPT", steps_completed: 0, steps_total: 4, attempt_count: 1, max_attempts: 3, claim_token: "44444444-4444-4444-8444-444444444444", artifacts: {}, cost_usd: 0, dry_run: dryRun, duration: { minSeconds: 20, maxSeconds: 40, source: "DEFAULT" }, kind: "REEL_AVATAR" });

  const job = newJob("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", true);
  const result = await advanceAvatarReelJob(job, makeDeps(false), { deadlineAt: Number.POSITIVE_INFINITY });
  assert.equal(result.state, "READY_FOR_REVIEW");
  assert.equal(job.step, "DONE");
  assert.equal(calls.saved, 4, "SCRIPT, AVATAR, RENDER, QA each saved");
  assert.equal(job.cost_usd, 0, "simulated preview costs nothing");
  assert.equal(job.artifacts.avatar?.simulated, true);
  assert.equal(job.artifacts.privateMedia, true);
  assert.match(job.artifacts.video!.url, /^private:identity\/08d029d7-40dd-4885-b0fb-1114206923b5\/renders\//, "final MP4 stays in the private store");
  assert.match(job.artifacts.cover!.url, /^private:/);
  assert.deepEqual(publicStores, [], "nothing written to the public Reel store");
  const probe = job.artifacts.video!.probe;
  assert.equal(`${probe.width}x${probe.height} ${probe.videoCodec}/${probe.audioCodec} ${probe.fps}`, "1080x1920 h264/aac 30");
  assert.ok(probe.durationSeconds >= 19.5 && probe.durationSeconds <= 40.25, `duration ${probe.durationSeconds}`);
  assert.ok(Math.abs(job.artifacts.video!.loudness!.integratedLufs + 14) <= 2, `loudness ${job.artifacts.video!.loudness!.integratedLufs}`);
  assert.equal(job.artifacts.qa?.technical, "PASS");

  // Resume after the AVATAR step never asks the provider again.
  const resumed = newJob("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", true);
  resumed.step = "RENDER"; resumed.steps_completed = 2;
  resumed.artifacts = { script: job.artifacts.script, avatar: job.artifacts.avatar };
  const before = calls.avatar;
  await advanceAvatarReelJob(resumed, makeDeps(false), { deadlineAt: Number.POSITIVE_INFINITY });
  assert.equal(calls.avatar, before, "no second talking-head render on resume");

  // Live mode: the per-job cap is checked BEFORE the paid render.
  const capped = newJob("cccccccc-cccc-4ccc-8ccc-cccccccccccc", false);
  const callsBefore = calls.avatar;
  await assert.rejects(advanceAvatarReelJob(capped, makeDeps(true), { deadlineAt: Number.POSITIVE_INFINITY, maxCostUsd: 1 }), (error: unknown) => error instanceof ReelPipelineError && error.code === "AI_BUDGET_REEL_JOB_CAP");
  assert.equal(calls.avatar, callsBefore, "nothing paid when the reserve exceeds the cap");
  const target = avatarTargetSeconds("parola ".repeat(60), { minSeconds: 20, maxSeconds: 40 });
  assert.ok(target >= 20.5 && target <= 39.5);
  const live = newJob("dddddddd-dddd-4ddd-8ddd-dddddddddddd", false);
  await advanceAvatarReelJob(live, makeDeps(true), { deadlineAt: Number.POSITIVE_INFINITY, maxCostUsd: 5 });
  assert.ok(live.cost_usd > 0 && live.cost_usd < 5, `avatar render cost recorded on the job: ${live.cost_usd}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// ---------- 6. Static guarantees ----------
{
  const route = readFileSync(new URL("../api/avatar.ts", import.meta.url), "utf8");
  const storage = readFileSync(new URL("../api/_lib/avatar/identity-storage.ts", import.meta.url), "utf8");
  const runtime = readFileSync(new URL("../api/_lib/avatar/avatar-runtime.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../db/migrations/20261117_identity_avatar.sql", import.meta.url), "utf8");
  for (const [name, text] of [["route", route], ["storage", storage], ["runtime", runtime]] as const) {
    assert.doesNotMatch(text, /access:\s*"public"/, `${name}: never public`);
    assert.doesNotMatch(text, /process\.env\.BLOB_READ_WRITE_TOKEN/, `${name}: never the public store token`);
  }
  assert.match(storage, /IDENTITY_BLOB_READ_WRITE_TOKEN/);
  assert.match(storage, /access: "private"/);
  assert.match(runtime, /access: "private"/);
  assert.match(route, /authorizedUser\(token, profileId\)/, "every avatar call checks profile ownership");
  assert.match(route, /AVATAR_PROVIDER_NOT_ENABLED/, "provider training is behind the explicit switch");
  assert.match(migration, /identity_consents_one_active/);
  assert.match(migration, /pathname LIKE 'identity\/' \|\| profile_id::text \|\| '\/%'/, "DB refuses a file outside the profile folder");
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.%I TO authenticated/);
  assert.doesNotMatch(migration, /GRANT (INSERT|UPDATE|DELETE)/, "browser clients cannot write identity rows");
}

console.log("PASS avatar identity: consenso revocabile, file privati per profilo con URL temporanei, requisiti dei materiali, provider HeyGen dietro interruttore (nessuna spesa), Reel avatar nella pipeline esistente (SCRIPT→AVATAR→RENDER→QA, 1080x1920, -14 LUFS, file privati, tetto di spesa prima del render).");
