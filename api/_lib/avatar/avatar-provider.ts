/**
 * Abstract talking-avatar provider. One real adapter (HeyGen Digital Twin, first choice);
 * Higgsfield Intone is described as the alternative but deliberately NOT integrated until an
 * A/B test justifies it. Every paid call is gated: the adapter is constructed only when
 * AVATAR_PROVIDER_LIVE_ENABLED=true and a key exists; otherwise callers get a typed refusal.
 */
export type AvatarProviderId = "HEYGEN" | "HIGGSFIELD_INTONE";
export type IdentityStatus = "TRAINING" | "READY" | "FAILED";
export type AvatarRenderStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

export type AvatarProviderInfo = {
  id: AvatarProviderId;
  label: string;
  integrated: boolean;
  role: "PRIMARY" | "ALTERNATIVE";
  /** Official list price used for the spending reserve (USD per generated second). */
  usdPerSecond: number | null;
  priceSource: string;
  materials: string[];
  maxSecondsPerRender: number | null;
  clonesVoiceFromVideo: boolean;
};

export const AVATAR_PROVIDERS: Record<AvatarProviderId, AvatarProviderInfo> = Object.freeze({
  HEYGEN: {
    id: "HEYGEN", label: "HeyGen Digital Twin (Avatar IV)", integrated: true, role: "PRIMARY",
    usdPerSecond: 4.83 / 60,
    priceSource: "help.heygen.com API pricing, Avatar IV Digital Twin 4,83 $/min (letto il 15/11/2026, da riconfermare alla ricarica)",
    materials: ["Video 2–5 min (min 15 s), 1080p, volto frontale sempre in quadro, audio pulito", "Consenso registrato tramite link HeyGen (valido 24 h)"],
    maxSecondsPerRender: null, clonesVoiceFromVideo: true,
  },
  HIGGSFIELD_INTONE: {
    id: "HIGGSFIELD_INTONE", label: "Higgsfield Intone (alternativa, non integrata)", integrated: false, role: "ALTERNATIVE",
    usdPerSecond: null,
    priceSource: "Crediti Higgsfield: prezzo per generazione non pubblicato, visibile solo in interfaccia (saldo attuale 36 crediti)",
    materials: ["1–2 foto frontali con volto leggibile", "Registrazioni vocali 2–30 s in totale"],
    maxSecondsPerRender: 30, clonesVoiceFromVideo: false,
  },
});

/** Worst-case reserve for a render of `seconds`, plus 10% margin (charged per second). */
export function estimateAvatarRenderUsd(provider: AvatarProviderId, seconds: number) {
  const rate = AVATAR_PROVIDERS[provider].usdPerSecond;
  if (rate === null) return null;
  return Number((Math.max(seconds, 0) * rate * 1.1).toFixed(4));
}

export interface AvatarVideoProvider {
  readonly id: AvatarProviderId;
  /** Creates the identity from a training video reachable at a short-lived URL. */
  createIdentity(input: { name: string; trainingVideoUrl: string }): Promise<{ avatarId: string; groupId: string; voiceId: string | null }>;
  /** Starts the provider's own consent capture; returns the link the subject must open. */
  startConsent(groupId: string): Promise<{ consentUrl: string | null }>;
  identityStatus(avatarId: string): Promise<{ status: IdentityStatus; error: string | null }>;
  renderTalkingVideo(input: { avatarId: string; voiceId: string | null; script: string }): Promise<{ renderId: string }>;
  renderStatus(renderId: string): Promise<{ status: AvatarRenderStatus; videoUrl: string | null; durationSeconds: number | null; error: string | null }>;
}

export class AvatarProviderError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean, message?: string) {
    super(message ?? code);
  }
}

type Fetcher = typeof fetch;
const HEYGEN_API = "https://api.heygen.com";

async function heygenJson(fetcher: Fetcher, apiKey: string, path: string, init: RequestInit = {}) {
  const response = await fetcher(`${HEYGEN_API}${path}`, {
    ...init,
    headers: { "x-api-key": apiKey, accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch { body = {}; }
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw new AvatarProviderError(`HEYGEN_HTTP_${response.status}`, retryable, String((body.error as Record<string, unknown> | undefined)?.message ?? body.message ?? text).slice(0, 300));
  }
  return (body.data && typeof body.data === "object" ? body.data : body) as Record<string, unknown>;
}

const str = (value: unknown) => (typeof value === "string" && value ? value : null);

/**
 * HeyGen v3 adapter. Request shapes follow developers.heygen.com "avatar-from-video"
 * (read 15/11/2026): POST /v3/avatars {type:"digital_twin", name, file:{type:"url", url}},
 * POST /v3/avatars/{group}/consent, GET /v3/avatars/looks/{id}, POST /v3/videos
 * {type:"avatar", avatar_id, voice_id, script}. The render status path is configurable:
 * it was not on that page and must be confirmed before the first authorised run.
 */
export function createHeyGenProvider(input: { apiKey: string; fetcher?: Fetcher; engine?: string; renderStatusPath?: (id: string) => string }): AvatarVideoProvider {
  const fetcher = input.fetcher ?? fetch;
  const engine = input.engine ?? "heygen-avatar-6";
  const statusPath = input.renderStatusPath ?? ((id: string) => `/v3/videos/${encodeURIComponent(id)}`);
  return {
    id: "HEYGEN",
    async createIdentity({ name, trainingVideoUrl }) {
      const data = await heygenJson(fetcher, input.apiKey, "/v3/avatars", { method: "POST", body: JSON.stringify({ type: "digital_twin", name, file: { type: "url", url: trainingVideoUrl } }) });
      const item = (data.avatar_item ?? {}) as Record<string, unknown>;
      const group = (data.avatar_group ?? {}) as Record<string, unknown>;
      const avatarId = str(item.id);
      const groupId = str(group.id);
      if (!avatarId || !groupId) throw new AvatarProviderError("HEYGEN_RESPONSE_INVALID", false);
      return { avatarId, groupId, voiceId: str(item.default_voice_id) };
    },
    async startConsent(groupId) {
      const data = await heygenJson(fetcher, input.apiKey, `/v3/avatars/${encodeURIComponent(groupId)}/consent`, { method: "POST", body: "{}" });
      return { consentUrl: str(data.url) ?? str(data.consent_url) };
    },
    async identityStatus(avatarId) {
      const data = await heygenJson(fetcher, input.apiKey, `/v3/avatars/looks/${encodeURIComponent(avatarId)}`);
      const status = String(data.status ?? "");
      if (status === "processing" || status === "pending") return { status: "TRAINING", error: null };
      if (status === "failed") return { status: "FAILED", error: str((data.error as Record<string, unknown> | undefined)?.message) ?? "training_failed" };
      return { status: "READY", error: null };
    },
    async renderTalkingVideo({ avatarId, voiceId, script }) {
      const data = await heygenJson(fetcher, input.apiKey, "/v3/videos", { method: "POST", body: JSON.stringify({ type: "avatar", avatar_id: avatarId, engine: { type: engine }, ...(voiceId ? { voice_id: voiceId } : {}), script }) });
      const renderId = str(data.video_id) ?? str(data.id);
      if (!renderId) throw new AvatarProviderError("HEYGEN_RESPONSE_INVALID", false);
      return { renderId };
    },
    async renderStatus(renderId) {
      const data = await heygenJson(fetcher, input.apiKey, statusPath(renderId));
      const raw = String(data.status ?? "");
      const status: AvatarRenderStatus = raw === "completed" ? "COMPLETED" : raw === "failed" ? "FAILED" : raw === "pending" || raw === "waiting" ? "QUEUED" : "PROCESSING";
      return { status, videoUrl: str(data.video_url) ?? str(data.url), durationSeconds: typeof data.duration === "number" ? data.duration : null, error: str((data.error as Record<string, unknown> | undefined)?.message) };
    },
  };
}

/** Live provider only behind an explicit switch; the switch is OFF everywhere today. */
export function avatarProviderReadiness(provider: AvatarProviderId, env: Record<string, string | undefined> = process.env) {
  const missing: string[] = [];
  if (!AVATAR_PROVIDERS[provider].integrated) missing.push("PROVIDER_NOT_INTEGRATED");
  if (env.AVATAR_PROVIDER_LIVE_ENABLED?.trim().toLowerCase() !== "true") missing.push("AVATAR_PROVIDER_LIVE_ENABLED");
  if (provider === "HEYGEN" && !env.HEYGEN_API_KEY?.trim()) missing.push("HEYGEN_API_KEY");
  return { live: missing.length === 0, missing };
}

export function createLiveAvatarProvider(provider: AvatarProviderId, env: Record<string, string | undefined> = process.env): AvatarVideoProvider {
  const readiness = avatarProviderReadiness(provider, env);
  if (!readiness.live) throw new AvatarProviderError("AVATAR_PROVIDER_NOT_ENABLED", false, readiness.missing.join(","));
  return createHeyGenProvider({ apiKey: env.HEYGEN_API_KEY!.trim() });
}
