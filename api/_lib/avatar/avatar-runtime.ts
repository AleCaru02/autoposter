import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { put } from "@vercel/blob";
import { probeReel } from "../reel/reel-probe.js";
import { ReelPipelineError, type ReelDeps, type RenderJob } from "../reel/reel-pipeline.js";
import { trimVideo } from "../reel/reel-render.js";
import { AVATAR_PROVIDERS, createLiveAvatarProvider, estimateAvatarRenderUsd, type AvatarProviderId } from "./avatar-provider.js";
import type { AvatarReelDeps } from "./avatar-reel.js";
import { pathnameBelongsTo, presignIdentityRead } from "./identity-storage.js";

type Env = { DATABASE_URL?: string; IDENTITY_BLOB_READ_WRITE_TOKEN?: string } & Record<string, string | undefined>;

export function avatarRenderPathname(profileId: string, jobId: string, name: string) {
  return `identity/${profileId}/renders/${jobId}/${name}`;
}

/**
 * Avatar runtime on top of the regular Reel runtime (script generation, metering, saving,
 * finalisation are the same objects). Adds private storage and the talking-head step.
 */
export function createAvatarReelRuntime(env: Env, base: ReelDeps, options: { dryRun: boolean; provider: AvatarProviderId }): AvatarReelDeps {
  const token = env.IDENTITY_BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) throw new ReelPipelineError("IDENTITY_STORAGE_NOT_CONFIGURED", false);
  if (!env.DATABASE_URL) throw new ReelPipelineError("DATABASE_URL_REQUIRED", false);
  const sql = neon(env.DATABASE_URL);

  const storePrivate: AvatarReelDeps["storePrivate"] = async (job, name, body, contentType) => {
    const pathname = avatarRenderPathname(job.profile_id, job.id, name);
    if (!pathnameBelongsTo(pathname, job.profile_id)) throw new ReelPipelineError("IDENTITY_PATHNAME_SCOPE_INVALID", false);
    const stored = await put(pathname, Buffer.from(body), { access: "private", token, addRandomSuffix: true, contentType });
    return { url: `private:${stored.pathname}`, pathname: stored.pathname, sizeBytes: body.byteLength, contentType };
  };
  const privateUrl = async (pathname: string) => (await presignIdentityRead(pathname, { IDENTITY_BLOB_READ_WRITE_TOKEN: token })).url;

  async function simulatedClip(job: RenderJob, targetSeconds: number) {
    const rows = await sql`
      select pathname, duration_seconds::float8 as duration_seconds from public.identity_assets
      where profile_id=${job.profile_id}::uuid and kind='VIDEO' and status='READY' order by created_at desc limit 1` as unknown as Array<{ pathname: string; duration_seconds: number | null }>;
    const video = rows[0];
    if (!video) throw new ReelPipelineError("AVATAR_TRAINING_VIDEO_MISSING", false);
    const seconds = Math.min(targetSeconds, video.duration_seconds ?? targetSeconds);
    const dir = mkdtempSync(join(tmpdir(), "avatar-sim-"));
    try {
      const out = join(dir, "avatar.mp4");
      await trimVideo(await privateUrl(video.pathname), seconds, out);
      const probe = await probeReel(out);
      const stored = await storePrivate(job, "avatar-simulated.mp4", readFileSync(out), "video/mp4");
      return { pathname: stored.pathname, seconds: probe.durationSeconds, simulated: true, costUsd: 0 };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async function liveClip(job: RenderJob, script: string, targetSeconds: number) {
    const setup = await sql`select provider_avatar_id, provider_voice_id, face_status from public.avatar_setups where profile_id=${job.profile_id}::uuid` as unknown as Array<{ provider_avatar_id: string | null; provider_voice_id: string | null; face_status: string }>;
    if (setup[0]?.face_status !== "READY" || !setup[0].provider_avatar_id) throw new ReelPipelineError("AVATAR_NOT_READY", false);
    const provider = createLiveAvatarProvider(options.provider, env);
    const estimate = estimateAvatarRenderUsd(options.provider, targetSeconds) ?? 0;
    const result = await base.metered({
      capability: "video.avatar.render",
      idempotencyKey: `avatar-render:v1:${job.id}`,
      estimatedUsd: estimate,
      run: async () => {
        const { renderId } = await provider.renderTalkingVideo({ avatarId: setup[0].provider_avatar_id!, voiceId: setup[0].provider_voice_id, script });
        for (let attempt = 0; attempt < 120; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 5_000));
          const status = await provider.renderStatus(renderId);
          if (status.status === "FAILED") throw new ReelPipelineError("AVATAR_RENDER_FAILED", false, status.error ?? undefined);
          if (status.status === "COMPLETED" && status.videoUrl) {
            const response = await fetch(status.videoUrl, { signal: AbortSignal.timeout(120_000) });
            if (!response.ok) throw new ReelPipelineError("AVATAR_DOWNLOAD_FAILED", true);
            const bytes = new Uint8Array(await response.arrayBuffer());
            const stored = await storePrivate(job, "avatar.mp4", bytes, "video/mp4");
            const seconds = status.durationSeconds ?? targetSeconds;
            const rate = AVATAR_PROVIDERS[options.provider].usdPerSecond ?? 0;
            return { value: { pathname: stored.pathname, seconds, renderId }, usage: [{ operation: "AVATAR_RENDER", model: options.provider, inputTokens: null, outputTokens: null, costUsd: Number((seconds * rate).toFixed(4)), metadata: { render_id: renderId, seconds, cost_basis: "OFFICIAL_LIST_PRICE_PER_SECOND" } }] };
          }
        }
        throw new ReelPipelineError("AVATAR_RENDER_TIMEOUT", true);
      },
      encode: (value) => ({ clip: value }),
      decode: (cached) => cached.clip as { pathname: string; seconds: number; renderId: string },
    });
    return { ...result.value, simulated: false, costUsd: result.costUsd };
  }

  return {
    ...base,
    provider: options.provider,
    storePrivate,
    privateUrl,
    avatarClip: (job, input) => (options.dryRun ? simulatedClip(job, input.targetSeconds) : liveClip(job, input.script, input.targetSeconds)),
  };
}
