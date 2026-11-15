import type { VercelRequest, VercelResponse } from "@vercel/node";
import { neon } from "@neondatabase/serverless";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { authorizedUser, bearerToken } from "./_lib/profile-access.js";
import { AVATAR_PROVIDERS, avatarProviderReadiness, estimateAvatarRenderUsd, type AvatarProviderId } from "./_lib/avatar/avatar-provider.js";
import { videoChecks, VIDEO_LIMITS } from "./_lib/avatar/avatar-requirements.js";
import { IDENTITY_CONSENT_VERSION, identityConsentText } from "./_lib/avatar/consent-text.js";
import { activeConsent, assetById, completeAsset, getSetup, grantConsent, listAssets, markAssetsDeleted, prepareAsset, refreshSetup, revokeConsent, type Scope } from "./_lib/avatar/identity-store.js";
import { deleteIdentityFiles, deleteProfileIdentityFolder, headIdentity, IDENTITY_UPLOAD_RULES, identityStorageConfigured, issueUploadToken, pathnameBelongsTo, presignIdentityRead, type IdentityKind } from "./_lib/avatar/identity-storage.js";
import { runMediaBinary } from "./_lib/reel/media-binaries.js";

/**
 * Personal-brand avatar: consent, private materials, provider choice, configuration state.
 * Every call needs the caller's session token and ownership of the profile (Data API + RLS).
 * Biometric files are never public: uploads use presigned PUT URLs for one pathname, reads use
 * 5-minute signed URLs, deletes remove the file from the private store.
 * No paid provider call is possible here: provider training stays behind AVATAR_PROVIDER_LIVE_ENABLED.
 */
export const config = { maxDuration: 60 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: IdentityKind[] = ["PHOTO", "VIDEO", "VOICE"];

function routePath(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value.join("/") : value || "").split("/").filter(Boolean).join("/");
}

/** Reads codec/size facts of a private file through a short-lived URL (header reads only). */
async function probeRemote(url: string) {
  const result = await runMediaBinary("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", url], { timeoutMs: 45_000 });
  if (result.code !== 0) return null;
  try {
    const data = JSON.parse(result.stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number; avg_frame_rate?: string; tags?: { rotate?: string }; side_data_list?: Array<{ rotation?: number }> }> };
    const video = data.streams?.find((stream) => stream.codec_type === "video");
    const rotation = Math.abs(Number(video?.tags?.rotate ?? video?.side_data_list?.find((item) => typeof item.rotation === "number")?.rotation ?? 0));
    const swap = rotation === 90 || rotation === 270;
    const [num, den] = String(video?.avg_frame_rate ?? "0/1").split("/").map(Number);
    return {
      durationSeconds: Number(data.format?.duration) || null,
      width: (swap ? video?.height : video?.width) ?? null,
      height: (swap ? video?.width : video?.height) ?? null,
      fps: den ? Number((num / den).toFixed(2)) : null,
      hasAudio: Boolean(data.streams?.some((stream) => stream.codec_type === "audio")),
    };
  } catch {
    return null;
  }
}

async function statusPayload(sql: ReturnType<typeof neon>, profileId: string) {
  const [consent, assets, setup] = await Promise.all([activeConsent(sql, profileId), listAssets(sql, profileId), getSetup(sql, profileId)]);
  const refreshed = await refreshSetup(sql, profileId, setup.provider);
  return {
    storage: { configured: identityStorageConfigured(), private: true, readUrlTtlSeconds: 300 },
    consent: consent ? { id: consent.id, subjectName: consent.subject_name, scopes: consent.scopes, version: consent.consent_version, grantedAt: consent.granted_at } : null,
    consentVersion: IDENTITY_CONSENT_VERSION,
    assets: assets.map(({ pathname: _pathname, ...asset }) => asset),
    setup: { ...refreshed, live: avatarProviderReadiness(refreshed.provider) },
    providers: Object.values(AVATAR_PROVIDERS).map((provider) => ({ ...provider, estimate30sUsd: estimateAvatarRenderUsd(provider.id, 30) })),
    limits: { video: VIDEO_LIMITS, upload: Object.fromEntries(KINDS.map((kind) => [kind, { maxBytes: IDENTITY_UPLOAD_RULES[kind].maxBytes, contentTypes: IDENTITY_UPLOAD_RULES[kind].contentTypes }])) },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  const path = routePath(req.query.path);
  const token = bearerToken(req.headers.authorization);
  if (!token) return res.status(401).json({ error: "AUTH_REQUIRED" });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: "DATABASE_NOT_CONFIGURED" });

  // The presigned-upload helper posts its own body shape; the profile travels in clientPayload.
  const uploadBody = path === "upload" ? (req.body ?? {}) as HandleUploadPresignedBody : null;
  const uploadPayload = uploadBody && "payload" in uploadBody ? JSON.parse(String((uploadBody.payload as { clientPayload?: string })?.clientPayload ?? "{}")) as { profileId?: string; assetId?: string } : null;
  const profileId = String(uploadPayload?.profileId ?? (req.method === "GET" ? req.query.profileId : req.body?.profileId) ?? "");
  if (!UUID.test(profileId)) return res.status(400).json({ error: "PROFILE_ID_REQUIRED" });

  try {
    const access = await authorizedUser(token, profileId);
    if (!access) return res.status(404).json({ error: "PROFILE_NOT_FOUND" });
    const sql = neon(process.env.DATABASE_URL);
    const actor = access.ownerId ?? "unknown";

    if (path === "status" && req.method === "GET") return res.status(200).json(await statusPayload(sql, profileId));

    if (path === "consent-text" && req.method === "GET") {
      const scopes = String(req.query.scopes ?? "FACE,VOICE").split(",").filter((scope): scope is Scope => scope === "FACE" || scope === "VOICE");
      return res.status(200).json({ version: IDENTITY_CONSENT_VERSION, text: identityConsentText(String(req.query.subjectName ?? ""), scopes.length ? scopes : ["FACE", "VOICE"]) });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "METHOD_NOT_ALLOWED" });

    if (path === "consent") {
      if (req.body?.accepted !== true || req.body?.version !== IDENTITY_CONSENT_VERSION) return res.status(400).json({ error: "IDENTITY_CONSENT_NOT_ACCEPTED" });
      const scopes = (Array.isArray(req.body?.scopes) ? req.body.scopes : []) as Scope[];
      const granted = await grantConsent(sql, {
        profileId, subjectName: String(req.body?.subjectName ?? ""), scopes, grantedBy: actor,
        evidence: { userAgent: String(req.headers["user-agent"] ?? "").slice(0, 200), acceptedAt: new Date().toISOString(), channel: "APP_CHECKBOX" },
      });
      return res.status(201).json({ consent: granted, status: await statusPayload(sql, profileId) });
    }

    if (path === "consent/revoke") {
      const revoked = await revokeConsent(sql, profileId, actor);
      let deletedFiles = 0;
      if (req.body?.deleteMaterials === true) { await markAssetsDeleted(sql, profileId, "ALL"); deletedFiles = await deleteProfileIdentityFolder(profileId); }
      return res.status(200).json({ ...revoked, deletedFiles, status: await statusPayload(sql, profileId) });
    }

    if (path === "provider") {
      const provider = req.body?.provider as AvatarProviderId;
      if (!(provider in AVATAR_PROVIDERS)) return res.status(400).json({ error: "AVATAR_PROVIDER_INVALID" });
      await refreshSetup(sql, profileId, provider);
      return res.status(200).json(await statusPayload(sql, profileId));
    }

    if (!identityStorageConfigured()) return res.status(409).json({ error: "IDENTITY_STORAGE_NOT_CONFIGURED" });

    if (path === "assets/prepare") {
      const kind = String(req.body?.kind ?? "") as IdentityKind;
      const contentType = String(req.body?.contentType ?? "").toLowerCase();
      if (!KINDS.includes(kind)) return res.status(400).json({ error: "IDENTITY_KIND_INVALID" });
      if (!IDENTITY_UPLOAD_RULES[kind].contentTypes.includes(contentType)) return res.status(400).json({ error: "IDENTITY_CONTENT_TYPE_NOT_ALLOWED" });
      const size = Number(req.body?.sizeBytes);
      if (!(size > 0) || size > IDENTITY_UPLOAD_RULES[kind].maxBytes) return res.status(400).json({ error: "IDENTITY_FILE_TOO_LARGE" });
      return res.status(201).json(await prepareAsset(sql, { profileId, kind, contentType, createdBy: actor }));
    }

    if (path === "upload" && uploadBody) {
      // Only URL issuance is used: completion is confirmed by assets/complete (server-side head()),
      // so upload-completed callbacks are never requested and are refused here.
      if (uploadBody.type !== "blob.generate-presigned-url") return res.status(400).json({ error: "IDENTITY_UPLOAD_EVENT_NOT_SUPPORTED" });
      const assetId = String(uploadPayload?.assetId ?? "");
      const request = new Request(`https://${req.headers.host ?? "localhost"}${req.url ?? "/api/avatar/upload"}`, { method: "POST", headers: new Headers(Object.entries(req.headers).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])) as Array<[string, string]>) });
      const response = await handleUploadPresigned({
        body: uploadBody,
        request,
        // The SDK insists on a key even without callbacks; no callbackUrl is ever issued, so it is never used.
        webhookPublicKey: process.env.BLOB_WEBHOOK_PUBLIC_KEY || "callbacks-disabled",
        getSignedToken: async (pathname) => {
          if (!UUID.test(assetId)) throw new Error("IDENTITY_ASSET_REQUIRED");
          const asset = await assetById(sql, profileId, assetId);
          if (!asset || asset.status !== "PENDING_UPLOAD" || asset.pathname !== pathname || !pathnameBelongsTo(pathname, profileId, asset.kind)) throw new Error("IDENTITY_UPLOAD_NOT_ALLOWED");
          return issueUploadToken(pathname, asset.kind);
        },
      });
      return res.status(200).json(response);
    }

    if (path === "assets/complete") {
      const assetId = String(req.body?.assetId ?? "");
      if (!UUID.test(assetId)) return res.status(400).json({ error: "IDENTITY_ASSET_REQUIRED" });
      const asset = await assetById(sql, profileId, assetId);
      if (!asset || asset.status !== "PENDING_UPLOAD") return res.status(404).json({ error: "IDENTITY_ASSET_NOT_FOUND" });
      const stored = await headIdentity(asset.pathname).catch(() => null);
      if (!stored) return res.status(409).json({ error: "IDENTITY_UPLOAD_NOT_FOUND" });
      const facts = asset.kind === "PHOTO" ? null : await probeRemote((await presignIdentityRead(asset.pathname)).url);
      const checks = asset.kind === "VIDEO" ? videoChecks({ durationSeconds: facts?.durationSeconds ?? null, width: facts?.width ?? null, height: facts?.height ?? null, hasAudio: facts?.hasAudio ?? null }) : [];
      const failed = checks.filter((check) => check.blocking && !check.ok);
      const voiceInvalid = asset.kind === "VOICE" && !(facts?.durationSeconds && facts.durationSeconds >= 2);
      const rejection = failed.length ? failed.map((check) => check.message).join("; ") : voiceInvalid ? "Audio non leggibile o più corto di 2 s" : null;
      const setup = await completeAsset(sql, {
        profileId, assetId, status: rejection ? "REJECTED" : "READY", sizeBytes: stored.sizeBytes, durationSeconds: facts?.durationSeconds ?? null,
        media: { ...(facts ?? {}), contentType: stored.contentType, checks }, rejection,
      });
      return res.status(200).json({ assetId, status: rejection ? "REJECTED" : "READY", rejection, checks, setup });
    }

    if (path === "assets/url") {
      const asset = await assetById(sql, profileId, String(req.body?.assetId ?? ""));
      if (!asset || asset.status === "PENDING_UPLOAD") return res.status(404).json({ error: "IDENTITY_ASSET_NOT_FOUND" });
      return res.status(200).json(await presignIdentityRead(asset.pathname));
    }

    if (path === "media/url") {
      // Signed URL for an avatar Reel output (MP4/cover) stored privately: "private:<pathname>".
      const raw = String(req.body?.storageUrl ?? "");
      const pathname = raw.startsWith("private:") ? raw.slice("private:".length) : "";
      if (!pathnameBelongsTo(pathname, profileId)) return res.status(404).json({ error: "IDENTITY_MEDIA_NOT_FOUND" });
      return res.status(200).json(await presignIdentityRead(pathname));
    }

    if (path === "assets/delete") {
      const assetId = String(req.body?.assetId ?? "");
      if (!UUID.test(assetId)) return res.status(400).json({ error: "IDENTITY_ASSET_REQUIRED" });
      const pathnames = await markAssetsDeleted(sql, profileId, [assetId]);
      const deletedFiles = await deleteIdentityFiles(pathnames);
      return res.status(200).json({ deletedFiles, status: await statusPayload(sql, profileId) });
    }

    if (path === "erase") {
      await markAssetsDeleted(sql, profileId, "ALL");
      const deletedFiles = await deleteProfileIdentityFolder(profileId);
      return res.status(200).json({ deletedFiles, status: await statusPayload(sql, profileId) });
    }

    if (path === "submit") {
      // Provider training (paid / credit-consuming) is off until explicitly authorised.
      const setup = await getSetup(sql, profileId);
      const readiness = avatarProviderReadiness(setup.provider);
      if (!readiness.live) return res.status(409).json({ error: "AVATAR_PROVIDER_NOT_ENABLED", missing: readiness.missing });
      return res.status(501).json({ error: "AVATAR_SUBMIT_REQUIRES_AUTHORISED_RUN" });
    }

    return res.status(404).json({ error: "AVATAR_ROUTE_NOT_FOUND" });
  } catch (reason) {
    const code = reason instanceof Error ? reason.message.split(":")[0] : "UNKNOWN";
    if (code === "SESSION_INVALID") return res.status(401).json({ error: code });
    if (/^IDENTITY_/.test(code)) return res.status(409).json({ error: code });
    // Blob SDK errors carry no credentials; the first 300 characters identify the failing step.
    console.error("avatar-route-failed", { path, code, detail: reason instanceof Error ? reason.message.replace(/vercel_blob_rw_[A-Za-z0-9_]+/g, "[redacted]").slice(0, 300) : null });
    return res.status(500).json({ error: "AVATAR_ROUTE_FAILED" });
  }
}
