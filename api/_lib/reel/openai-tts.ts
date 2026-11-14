import { openAiErrorDetail } from "./openai-access.js";
/**
 * Generic (non-cloned) Italian narration through OpenAI TTS. Voice cloning of the owner is a
 * separate, consent-gated provider track and is never simulated here.
 */
export const REEL_TTS_MODEL = process.env.OPENAI_TTS_MODEL?.trim() || "gpt-4o-mini-tts";
export const REEL_TTS_VOICE = process.env.OPENAI_TTS_VOICE?.trim() || "alloy";
/** Community-estimated audio output cost; replaced by real usage when the API reports it. */
export const TTS_ESTIMATED_USD_PER_MINUTE = 0.015;

export function estimateTtsCostUsd(seconds: number) {
  return Number(((Math.max(seconds, 0) / 60) * TTS_ESTIMATED_USD_PER_MINUTE).toFixed(5));
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
