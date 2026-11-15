import { openAiErrorDetail } from "./openai-access.js";
/**
 * Generic (non-cloned) Italian narration through OpenAI TTS. Voice cloning of the owner is a
 * separate, consent-gated provider track and is never simulated here.
 */
export const REEL_TTS_MODEL = process.env.OPENAI_TTS_MODEL?.trim() || "gpt-4o-mini-tts";
export const REEL_TTS_VOICE = process.env.OPENAI_TTS_VOICE?.trim() || "alloy";
/**
 * Official gpt-4o-mini-tts rates (developers.openai.com/api/docs/models/gpt-4o-mini-tts, verified
 * 2026-11-15): text input $0.60 / 1M tokens, audio output $12 / 1M tokens. The speech endpoint
 * does not return usage, so audio tokens are estimated from the measured duration
 * (about 1,250 audio tokens per minute = $0.015/min) and text tokens from characters / 4.
 */
export const TTS_RATES = Object.freeze({ textInputPerMillion: 0.6, audioOutputPerMillion: 12, audioTokensPerMinute: 1250, verifiedAt: "2026-11-15" });
export const TTS_ESTIMATED_USD_PER_MINUTE = (TTS_RATES.audioTokensPerMinute * TTS_RATES.audioOutputPerMillion) / 1_000_000;
export const TTS_COST_BASIS = "OFFICIAL_RATES_ESTIMATED_TOKENS_FROM_DURATION";

export function estimateTtsCostUsd(seconds: number, characters = 0) {
  const audio = (Math.max(seconds, 0) / 60) * TTS_ESTIMATED_USD_PER_MINUTE;
  const text = (Math.ceil(Math.max(characters, 0) / 4) * TTS_RATES.textInputPerMillion) / 1_000_000;
  return Number((audio + text).toFixed(6));
}

export async function synthesizeNarration(input: { apiKey: string; text: string; tone?: string | null; fetcher?: typeof fetch }) {
  const text = input.text.replace(/\s+/g, " ").trim();
  if (text.length < 20 || text.length > 4000) throw new Error("REEL_TTS_INPUT_INVALID");
  const response = await (input.fetcher ?? fetch)("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: REEL_TTS_MODEL,
      voice: REEL_TTS_VOICE,
      input: text,
      instructions: `Parla in italiano naturale con pronuncia italiana corretta, ritmo da Reel social: chiaro, energico ma credibile, pause brevi tra le frasi.${input.tone ? ` Tono del brand: ${input.tone}.` : ""}`,
      response_format: "mp3",
    }),
  });
  if (!response.ok) throw new Error(`OPENAI_TTS_HTTP_${response.status}: ${await openAiErrorDetail(response)}`);
  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.byteLength < 2_000) throw new Error("OPENAI_TTS_EMPTY_AUDIO");
  return { audio, mimeType: "audio/mpeg" as const, model: REEL_TTS_MODEL, voice: REEL_TTS_VOICE, requestId: response.headers.get("x-request-id") };
}
