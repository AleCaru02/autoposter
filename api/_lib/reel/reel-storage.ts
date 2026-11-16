import { put } from "@vercel/blob";

/**
 * Durable media storage for Reel artifacts (scene stills, narration, MP4, cover) on Vercel Blob.
 * Public objects use an unguessable random suffix so Meta can fetch the final MP4 by URL.
 * Fail-closed: without BLOB_READ_WRITE_TOKEN no render can start.
 */
export function reelStorageConfigured(env: { BLOB_READ_WRITE_TOKEN?: string } = process.env) {
  return Boolean(env.BLOB_READ_WRITE_TOKEN?.trim());
}

export async function storeReelArtifact(input: { profileId: string; jobId: string; name: string; body: Uint8Array; contentType: string; token?: string }) {
  const token = input.token ?? process.env.BLOB_READ_WRITE_TOKEN;
  if (!token?.trim()) throw new Error("REEL_STORAGE_NOT_CONFIGURED");
  if (!/^[0-9a-f-]{36}$/i.test(input.profileId) || !/^[0-9a-f-]{36}$/i.test(input.jobId) || !/^[a-z0-9._-]{1,80}$/i.test(input.name)) throw new Error("REEL_STORAGE_PATH_INVALID");
  const blob = await put(`reels/${input.profileId}/${input.jobId}/${input.name}`, Buffer.from(input.body), {
    access: "public",
    addRandomSuffix: true,
    contentType: input.contentType,
    token,
  });
  return { url: blob.url, pathname: blob.pathname, sizeBytes: input.body.byteLength, contentType: input.contentType };
}

export async function fetchArtifact(url: string, maxBytes = 120_000_000) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".public.blob.vercel-storage.com")) throw new Error("REEL_ARTIFACT_URL_UNTRUSTED");
  const response = await fetch(parsed, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`REEL_ARTIFACT_HTTP_${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error("REEL_ARTIFACT_TOO_LARGE");
  return bytes;
}
