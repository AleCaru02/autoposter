import { estimateTerraCostUsd } from "../openai-text.js";
import { openAiErrorDetail } from "./openai-access.js";

/**
 * Reel scene planner. It does NOT invent a new message: it adapts an existing, already
 * written content variant (hook, caption, CTA) into a 20-40 s vertical video script.
 * A deterministic guard rejects numbers and social proof not present in the source.
 */
export const REEL_SCRIPT_MODEL = "gpt-5.6-terra";
export const ITALIAN_WORDS_PER_SECOND = 2.5;

export type ReelScene = { voiceover: string; visualBrief: string };
export type ReelScript = {
  title: string;
  hook: string;
  scenes: ReelScene[];
  cta: string;
  caption: string;
  hashtags: string[];
  coverText: string;
};
export type ReelSource = {
  profileName: string;
  industry: string | null;
  tone: string | null;
  topic: string;
  hook: string | null;
  caption: string | null;
  cta: string | null;
  visualBrief: string | null;
  confirmedFacts?: string[];
};

const SCRIPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "hook", "scenes", "cta", "caption", "hashtags", "coverText"],
  properties: {
    title: { type: "string" },
    hook: { type: "string" },
    scenes: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["voiceover", "visualBrief"],
        properties: { voiceover: { type: "string" }, visualBrief: { type: "string" } },
      },
    },
    cta: { type: "string" },
    caption: { type: "string" },
    hashtags: { type: "array", maxItems: 5, items: { type: "string" } },
    coverText: { type: "string" },
  },
} as const;

function outputText(body: Record<string, unknown>) {
  if (typeof body.output_text === "string") return body.output_text;
  const output = Array.isArray(body.output) ? body.output : [];
  for (const item of output) {
    const content = item && typeof item === "object" && Array.isArray((item as Record<string, unknown>).content) ? (item as Record<string, unknown>).content as Array<Record<string, unknown>> : [];
    for (const part of content) if (part.type === "output_text" && typeof part.text === "string") return part.text;
  }
  return "";
}

export function narrationText(script: Pick<ReelScript, "scenes">) {
  return script.scenes.map((scene) => scene.voiceover.trim()).join(" ");
}

export function estimatedNarrationSeconds(script: Pick<ReelScript, "scenes">) {
  const words = narrationText(script).split(/\s+/).filter(Boolean).length;
  return words / ITALIAN_WORDS_PER_SECOND;
}

const SOCIAL_PROOF = /\b(?:recension[ei]|testimonian(?:za|ze)|caso studio|casi studio|case study|\d\s*stelle|un(?:a)? (?:nostr[oa]|mi[oa]) client[ei]|i nostri clienti|abbiamo aiutato|ci ha scritto|mi ha scritto|clienti soddisfatti)\b/gi;

/** Deterministic anti-fabrication guard: every number and social-proof reference must exist in the source. */
export function unsupportedScriptClaims(script: ReelScript, source: ReelSource) {
  const sourceText = [source.topic, source.hook, source.caption, source.cta, ...(source.confirmedFacts ?? [])].filter(Boolean).join(" ").toLowerCase();
  const scriptText = [script.hook, narrationText(script), script.cta, script.caption, script.coverText].join(" ");
  const issues: string[] = [];
  for (const number of scriptText.match(/\d+(?:[.,]\d+)?/g) ?? []) {
    if (!sourceText.includes(number.toLowerCase())) issues.push(`NUMBER_NOT_IN_SOURCE:${number}`);
  }
  for (const proof of scriptText.match(SOCIAL_PROOF) ?? []) {
    if (!sourceText.includes(proof.toLowerCase())) issues.push(`SOCIAL_PROOF_NOT_IN_SOURCE:${proof}`);
  }
  return [...new Set(issues)];
}

export function validateReelScript(script: ReelScript, source: ReelSource) {
  const errors: string[] = [];
  if (script.scenes.length < 3 || script.scenes.length > 6) errors.push("REEL_SCRIPT_SCENES_INVALID");
  if (script.scenes.some((scene) => scene.voiceover.trim().length < 12 || scene.voiceover.length > 260)) errors.push("REEL_SCRIPT_VOICEOVER_LENGTH");
  if (script.scenes.some((scene) => scene.visualBrief.trim().length < 30)) errors.push("REEL_SCRIPT_VISUAL_BRIEF_WEAK");
  const seconds = estimatedNarrationSeconds(script);
  if (seconds < 12 || seconds > 50) errors.push("REEL_SCRIPT_DURATION_OUT_OF_RANGE");
  if (!script.hook.trim() || script.hook.length > 90) errors.push("REEL_SCRIPT_HOOK_INVALID");
  if (script.caption.length > 2200) errors.push("REEL_SCRIPT_CAPTION_TOO_LONG");
  errors.push(...unsupportedScriptClaims(script, source));
  return errors;
}

export async function generateReelScript(input: { apiKey: string; source: ReelSource; fetcher?: typeof fetch }) {
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: REEL_SCRIPT_MODEL,
      store: false,
      reasoning: { effort: "low" },
      instructions: [
        "Sei un social media manager e video editor senior italiano. Trasformi un contenuto social GIÀ SCRITTO in uno script per un Reel verticale di 20-40 secondi.",
        "Struttura: hook nei primi 2 secondi (prima scena), 2-4 scene di valore concreto, ultima scena con call to action. 3-6 scene totali; ogni voiceover è 1-2 frasi brevi, parlate, naturali.",
        "Lingua: italiano naturale, professionale e parlato, frasi brevi da leggere ad alta voce, niente elenchi puntati, niente emoji nel voiceover, niente hashtag nel voiceover.",
        "Regola critica: usa SOLO informazioni presenti nel contenuto sorgente. Non aggiungere numeri, prezzi, percentuali, risultati, recensioni, testimonianze, casi studio, nomi di clienti, esperienze personali o promesse non presenti nella fonte.",
        "visualBrief: descrivi per ogni scena una singola immagine verticale 9:16 senza testo, coerente con il messaggio della scena e con il brand; nessuna persona reale riconoscibile, nessun logo di terzi, nessuna scritta nell'immagine.",
        "caption: caption Instagram per il Reel (max 1200 caratteri) coerente con lo script; hashtags: massimo 5, pertinenti, senza #. coverText: titolo di copertina di massimo 6 parole.",
        "Restituisci solo JSON conforme allo schema.",
      ].join("\n"),
      input: JSON.stringify({ brand: { name: input.source.profileName, industry: input.source.industry, tone: input.source.tone }, source: input.source }),
      text: { verbosity: "low", format: { type: "json_schema", name: "post_automatici_reel_script", strict: true, schema: SCRIPT_SCHEMA } },
      max_output_tokens: 2200,
    }),
  });
  if (!response.ok) throw new Error(`OPENAI_REEL_SCRIPT_HTTP_${response.status}: ${await openAiErrorDetail(response)}`);
  const raw = await response.text();
  const body = JSON.parse(raw) as Record<string, unknown>;
  const text = outputText(body);
  if (!text) throw new Error("OPENAI_REEL_SCRIPT_EMPTY");
  const script = JSON.parse(text) as ReelScript;
  script.hashtags = script.hashtags.map((tag) => tag.replace(/^#/, "").trim()).filter(Boolean).slice(0, 5);
  const usage = body.usage && typeof body.usage === "object" ? body.usage as Record<string, unknown> : {};
  const inputTokens = Number(usage.input_tokens ?? 0) || 0;
  const outputTokens = Number(usage.output_tokens ?? 0) || 0;
  return { script, model: REEL_SCRIPT_MODEL, inputTokens, outputTokens, costUsd: estimateTerraCostUsd(inputTokens, outputTokens), responseId: typeof body.id === "string" ? body.id : null };
}
