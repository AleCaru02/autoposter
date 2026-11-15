import { del, head, issueSignedToken, presignUrl } from "@vercel/blob";

/**
 * Private object storage for biometric identity materials (face photos, training video,
 * voice recordings). Separate PRIVATE Vercel Blob store (IDENTITY_BLOB_READ_WRITE_TOKEN),
 * never the public Reel store: nothing here is reachable without a short-lived signed URL
 * minted by the server after an ownership check.
 */
export type IdentityKind = "PHOTO" | "VIDEO" | "VOICE";
type StorageEnv = { IDENTITY_BLOB_READ_WRITE_TOKEN?: string };

export const IDENTITY_UPLOAD_RULES: Record<IdentityKind, { contentTypes: string[]; maxBytes: number; extensions: Record<string, string> }> = Object.freeze({
  PHOTO: { contentTypes: ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"], maxBytes: 25 * 1024 * 1024, extensions: { "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/heif": "heif", "image/webp": "webp" } },
  VIDEO: { contentTypes: ["video/mp4", "video/quicktime", "video/webm"], maxBytes: 1024 * 1024 * 1024, extensions: { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" } },
  VOICE: { contentTypes: ["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/aac", "audio/webm"], maxBytes: 300 * 1024 * 1024, extensions: { "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/wav": "wav", "audio/x-wav": "wav", "audio/aac": "aac", "audio/webm": "webm" } },
});
/** Upload URLs live 15 minutes, preview URLs 5 minutes. */
export const IDENTITY_UPLOAD_URL_TTL_MS = 15 * 60_000;
export const IDENTITY_READ_URL_TTL_MS = 5 * 60_000;
/** Default retention of identity materials without a new decision: 12 months. */
export const IDENTITY_RETENTION_DAYS = 365;

export function identityStorageConfigured(env: StorageEnv = process.env) {
  return Boolean(env.IDENTITY_BLOB_READ_WRITE_TOKEN?.trim());
}

function token(env: StorageEnv) {
  const value = env.IDENTITY_BLOB_READ_WRITE_TOKEN?.trim();
  if (!value) throw new Error("IDENTITY_STORAGE_NOT_CONFIGURED");
  return value;
}

/** Every file of a profile lives under identity/<profileId>/ (enforced again by a DB CHECK). */
export function identityPathname(profileId: string, kind: IdentityKind, contentType: string, id: string = crypto.randomUUID()) {
  const extension = IDENTITY_UPLOAD_RULES[kind].extensions[contentType];
  if (!extension) throw new Error("IDENTITY_CONTENT_TYPE_NOT_ALLOWED");
  return `identity/${profileId}/${kind.toLowerCase()}/${id}.${extension}`;
}

export function pathnameBelongsTo(pathname: string, profileId: string, kind?: IdentityKind) {
  const prefix = `identity/${profileId}/${kind ? `${kind.toLowerCase()}/` : ""}`;
  return pathname.startsWith(prefix) && !pathname.includes("..") && /^[a-z0-9/._-]+$/i.test(pathname);
}

/** Signed material for ONE pathname, PUT only, type and size enforced by the Blob API. */
export async function issueUploadToken(pathname: string, kind: IdentityKind, env: StorageEnv = process.env, now = Date.now()) {
  const rules = IDENTITY_UPLOAD_RULES[kind];
  const validUntil = now + IDENTITY_UPLOAD_URL_TTL_MS;
  const signed = await issueSignedToken({ pathname, operations: ["put"], allowedContentTypes: rules.contentTypes, maximumSizeInBytes: rules.maxBytes, validUntil, token: token(env) });
  return { token: signed, urlOptions: { allowedContentTypes: rules.contentTypes, maximumSizeInBytes: rules.maxBytes, validUntil, addRandomSuffix: false, allowOverwrite: false } };
}

/** Temporary read URL (GET) for one private file, after the caller's ownership was verified. */
export async function presignIdentityRead(pathname: string, env: StorageEnv = process.env, ttlMs = IDENTITY_READ_URL_TTL_MS, now = Date.now()) {
  const validUntil = now + Math.min(ttlMs, 60 * 60_000);
  const signed = await issueSignedToken({ pathname, operations: ["get"], validUntil, token: token(env) });
  const { presignedUrl } = await presignUrl(signed, { operation: "get", pathname, access: "private", validUntil, useCache: false });
  return { url: presignedUrl, expiresAt: new Date(validUntil).toISOString() };
}

export async function headIdentity(pathname: string, env: StorageEnv = process.env) {
  const result = await head(pathname, { token: token(env) });
  return { sizeBytes: result.size, contentType: result.contentType };
}

export async function deleteIdentityFiles(pathnames: string[], env: StorageEnv = process.env) {
  if (!pathnames.length) return 0;
  await del(pathnames, { token: token(env) });
  return pathnames.length;
}
