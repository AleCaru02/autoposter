import type { AvatarProviderId } from "./avatar-provider.js";
import type { IdentityKind } from "./identity-storage.js";

/**
 * Material checks per provider, from the providers' official requirements (15/11/2026):
 * HeyGen digital twin: 15–600 s of footage, about 2 min recommended, 1080p recommended,
 * long edge 640–4096 px, one person facing the camera, clear speech. The voice is cloned from
 * the same footage. Higgsfield Intone: a front photo with a readable face + 2–30 s of voice.
 */
export type IdentityAssetSummary = {
  id: string;
  kind: IdentityKind;
  status: "PENDING_UPLOAD" | "READY" | "REJECTED" | "DELETED";
  duration_seconds: number | null;
  width?: number | null;
  height?: number | null;
  has_audio?: boolean | null;
};
export type MaterialCheck = { code: string; ok: boolean; blocking: boolean; message: string };
export type SetupState = "NOT_STARTED" | "MATERIALS_READY" | "SUBMITTED" | "TRAINING" | "READY" | "FAILED" | "REVOKED";

export const VIDEO_LIMITS = Object.freeze({ minSeconds: 15, recommendedSeconds: 120, maxSeconds: 600, minLongEdge: 640, maxLongEdge: 4096, recommendedShortEdge: 1080 });

export function videoChecks(video: { durationSeconds: number | null; width: number | null; height: number | null; hasAudio: boolean | null }): MaterialCheck[] {
  const checks: MaterialCheck[] = [];
  const duration = video.durationSeconds ?? 0;
  checks.push({ code: "VIDEO_DURATION_MIN", ok: duration >= VIDEO_LIMITS.minSeconds && duration <= VIDEO_LIMITS.maxSeconds, blocking: true, message: `Durata tra ${VIDEO_LIMITS.minSeconds} e ${VIDEO_LIMITS.maxSeconds} s (ora ${duration.toFixed(0)} s)` });
  checks.push({ code: "VIDEO_DURATION_RECOMMENDED", ok: duration >= VIDEO_LIMITS.recommendedSeconds, blocking: false, message: "Consigliati almeno 2 minuti di parlato naturale" });
  const long = Math.max(video.width ?? 0, video.height ?? 0);
  const short = Math.min(video.width ?? 0, video.height ?? 0);
  checks.push({ code: "VIDEO_RESOLUTION_RANGE", ok: long >= VIDEO_LIMITS.minLongEdge && long <= VIDEO_LIMITS.maxLongEdge, blocking: true, message: `Lato lungo tra ${VIDEO_LIMITS.minLongEdge} e ${VIDEO_LIMITS.maxLongEdge} px (ora ${long || "?"} px)` });
  checks.push({ code: "VIDEO_RESOLUTION_RECOMMENDED", ok: short >= VIDEO_LIMITS.recommendedShortEdge, blocking: false, message: "Consigliato 1080p o superiore" });
  checks.push({ code: "VIDEO_AUDIO", ok: video.hasAudio === true, blocking: true, message: "Il video deve contenere la tua voce (serve anche per clonarla)" });
  return checks;
}

/** Face and voice configuration state derived from consent + materials (before any provider step). */
export function deriveSetupStates(input: {
  provider: AvatarProviderId;
  consentScopes: Array<"FACE" | "VOICE"> | null;
  assets: IdentityAssetSummary[];
}): { face: SetupState; voice: SetupState; missing: string[] } {
  const ready = input.assets.filter((asset) => asset.status === "READY");
  const missing: string[] = [];
  if (!input.consentScopes) return { face: "NOT_STARTED", voice: "NOT_STARTED", missing: ["CONSENT"] };
  const hasFace = input.consentScopes.includes("FACE");
  const hasVoice = input.consentScopes.includes("VOICE");
  let face: SetupState = "NOT_STARTED";
  let voice: SetupState = "NOT_STARTED";
  if (input.provider === "HEYGEN") {
    const video = ready.find((asset) => asset.kind === "VIDEO");
    if (!hasFace) missing.push("CONSENT_FACE");
    if (!video) missing.push("VIDEO");
    if (hasFace && video) face = "MATERIALS_READY";
    // HeyGen clones the voice from the same footage: allowed only with the VOICE scope.
    if (!hasVoice) missing.push("CONSENT_VOICE");
    if (hasVoice && video) voice = "MATERIALS_READY";
  } else {
    const photo = ready.find((asset) => asset.kind === "PHOTO");
    const voiceSample = ready.find((asset) => asset.kind === "VOICE");
    if (!hasFace) missing.push("CONSENT_FACE");
    if (!photo) missing.push("PHOTO");
    if (hasFace && photo) face = "MATERIALS_READY";
    if (!hasVoice) missing.push("CONSENT_VOICE");
    if (!voiceSample) missing.push("VOICE");
    if (hasVoice && voiceSample) voice = "MATERIALS_READY";
  }
  return { face, voice, missing };
}

/** Consent scope needed to upload a kind (a video needs FACE; its voice is used only with VOICE). */
export function scopesForKind(kind: IdentityKind): Array<"FACE" | "VOICE"> {
  return kind === "VOICE" ? ["VOICE"] : ["FACE"];
}
