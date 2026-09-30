import { estimateTerraCostUsd } from "./openai-text.js";
import type { ImageSocialFormat, ImageSocialProvider } from "./openai-image.js";
import { personalBrandVisualSystem } from "./personal-brand-visual-system.js";
import { platformVisualStrategyPrompt, socialPlatformStrategy } from "./social-platform-strategy.js";

export type MediaManagerResult = {
  visualIntent: string;
  composition: string;
  subject: string;
  environment: string;
  style: string;
  imagePrompt: string;
  altText: string;
  avoid: string[];
  responseId: string;
  requestId: string | null;
  model: "gpt-5.6-terra";
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
};

const MEDIA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    visualIntent: { type: "string", minLength: 3, maxLength: 300 },
    composition: { type: "string", minLength: 3, maxLength: 500 },
    subject: { type: "string", minLength: 3, maxLength: 500 },
    environment: { type: "string", minLength: 3, maxLength: 500 },
    style: { type: "string", minLength: 3, maxLength: 500 },
    imagePrompt: { type: "string", minLength: 20, maxLength: 2500 },
    altText: { type: "string", minLength: 3, maxLength: 500 },
    avoid: { type: "array", maxItems: 12, items: { type: "string", maxLength: 200 } },
  },
  required: ["visualIntent", "composition", "subject", "environment", "style", "imagePrompt", "altText", "avoid"],
} as const;

function outputText(body: Record<string, unknown>) {
  if (typeof body.output_text === "string" && body.output_text.trim()) return body.output_text;
  const pieces: string[] = [];
  for (const item of Array.isArray(body.output) ? body.output : []) {
    if (!item || typeof item !== "object") continue;
    for (const part of Array.isArray((item as { content?: unknown }).content) ? (item as { content: unknown[] }).content : []) {
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "output_text" && typeof (part as { text?: unknown }).text === "string") pieces.push((part as { text: string }).text);
    }
  }
  return pieces.join("\n").trim();
}

function n(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : 0; }

export async function runOpenAIMediaManager(input: {
  apiKey: string;
  profileName: string;
  profileType?: "BUSINESS" | "PERSONAL_BRAND";
  industry: string | null;
  tone: string | null;
  brandColors?: string[];
  brandFonts?: string[];
  brandVisualStyle?: string | null;
  provider: ImageSocialProvider;
  format: ImageSocialFormat;
  visualBrief: string;
  caption?: string | null;
  additionalDirection?: string | null;
  fetcher?: typeof fetch;
}): Promise<MediaManagerResult> {
  const fetcher: typeof fetch = input.fetcher ?? ((request, init) => globalThis.fetch(request, init));
  const response = await fetcher("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-terra",
      store: false,
      reasoning: { effort: "low" },
      instructions: [
        "Sei il Media Manager e Visual Director senior di Post Automatici.",
        "Trasforma il brief editoriale già approvato in una vera art direction pronta per OpenAI Immagini 2: non limitarti a riscrivere o allungare il brief.",
        "Ogni imagePrompt deve descrivere una scena ricca, intenzionale e visivamente memorabile, evitando immagini corporate generiche, piatte, vuote o da stock.",
        "Definisci sempre: soggetto principale e dettagli secondari utili; primo piano, piano intermedio e sfondo; punto focale e gerarchia visiva; prospettiva o inquadratura; profondità; illuminazione, ombre e atmosfera; palette, materiali e texture; livello di realismo; uso intenzionale dello spazio negativo.",
        "Il visual deve comunicare prima di tutto l'IDEA CENTRALE del contenuto. Non limitarti a mostrare il luogo o il settore come decorazione: scegli una scena o metafora che renda visibile il messaggio.",
        "Mantieni una sola gerarchia principale e al massimo tre elementi secondari. Evita sovraccarico, infografiche improvvisate, collage, mappe affollate e troppi punti focali.",
        "La brand identity fornita nel campo brand è un vincolo reale del profilo: usa i colori osservati/confermati come palette dominante e di accento, scegliendo 2-4 colori coerenti invece di usarli tutti. Non sostituirli con una palette arbitraria; bianco, nero e neutri sono ammessi per contrasto.",
        personalBrandVisualSystem(input.profileType),
        "Se sono forniti font o indicazioni di stile visivo, rispettane il carattere tipografico e l'estetica generale. Non inventare un'identità editoriale diversa solo perché sembra più elegante.",
        "Quando il contenuto è concettuale o informativo, traduci il concetto in una metafora visuale concreta e pertinente al settore invece di produrre una semplice icona, mappa o sfondo decorativo.",
        "Per luoghi reali, quartieri, mappe, metropolitane, strade, landmark o percorsi: NON inventare cartografia, posizioni, linee, fermate, collegamenti, distanze, edifici o etichette fattuali. Se non sono forniti dati geografici verificati o un asset reale, usa una rappresentazione editoriale non cartografica o uno schema chiaramente concettuale senza pretendere accuratezza geografica.",
        "Non mostrare un appartamento, ufficio, vista panoramica, prodotto, persona o risultato sintetico come se fosse realmente appartenente al brand, salvo che il brief lo confermi esplicitamente. Una scena sintetica deve restare illustrativa, non una falsa prova dell'attività.",
        "Se il brief richiede esplicitamente testo nell'immagine, usa SOLO il testo richiesto: massimo un headline e un eventuale sottotitolo breve. Non aggiungere microcopy, nomi di quartieri, label, numeri, pseudo-dati, didascalie o altri testi inventati.",
        "Il testo richiesto deve avere forte contrasto, margini generosi e leggibilità immediata su smartphone; niente testo piccolo su sfondi complessi. Per POST/CAROUSEL mantieni gli elementi essenziali lontani almeno circa l'8% dai bordi.",
        "Per STORY costruisci una gerarchia verticale forte e lascia ampie zone sicure sopra e sotto per l'interfaccia social; concentra testo e soggetto nella parte centrale e mantieni gli elementi essenziali nella zona centrale anche in caso di ritaglio 9:16.",
        "Adatta composizione e densità alla piattaforma e al formato; la strategia visuale della piattaforma è un vincolo, non un suggerimento.",
        platformVisualStrategyPrompt(input.provider),
        "Per POST/CAROUSEL usa una composizione quadrata coerente con la piattaforma; per STORY una composizione verticale semplice da leggere in meno di due secondi.",
        "Non inventare sedi, persone reali, prodotti, risultati, certificazioni, prezzi, loghi o caratteristiche specifiche del brand che non siano presenti nel contesto.",
        "Non usare ricerca web. Non scrivere copy social: occupati soltanto del visual.",
        "Evita watermark, marchi di terzi, claim visivi non verificati, collage casuali, elementi decorativi senza funzione, fondi eccessivamente vuoti e look da template generico.",
        "imagePrompt deve essere autosufficiente, concreto e production-ready per gpt-image-2; normalmente 700-1800 caratteri, con dettagli sufficienti su composizione, luce, profondità, texture e atmosfera senza riempitivo.",
        "Restituisci esclusivamente JSON conforme allo schema.",
      ].join("\n"),
      input: JSON.stringify({
        brand: {
          name: input.profileName,
          profileType: input.profileType ?? "BUSINESS",
          industry: input.industry,
          tone: input.tone,
          colors: input.brandColors ?? [],
          fonts: input.brandFonts ?? [],
          visualStyle: input.brandVisualStyle ?? null,
        },
        placement: { provider: input.provider, format: input.format },
        platformStrategy: socialPlatformStrategy(input.provider),
        visualBrief: input.visualBrief,
        captionContext: input.caption ?? null,
        additionalDirection: input.additionalDirection ?? null,
      }),
      text: { verbosity: "low", format: { type: "json_schema", name: "post_automatici_media_manager", strict: true, schema: MEDIA_SCHEMA } },
      max_output_tokens: 1400,
    }),
  });
  const requestId = response.headers.get("x-request-id");
  const raw = await response.text();
  if (!response.ok) throw new Error(`OPENAI_MEDIA_MANAGER_HTTP_${response.status}`);
  const body = JSON.parse(raw) as Record<string, unknown>;
  const text = outputText(body);
  if (!text) throw new Error("OPENAI_MEDIA_MANAGER_EMPTY_OUTPUT");
  const parsed = JSON.parse(text) as Omit<MediaManagerResult, "responseId" | "requestId" | "model" | "usage">;
  const rawUsage = body.usage && typeof body.usage === "object" ? body.usage as Record<string, unknown> : {};
  const inputTokens = n(rawUsage.input_tokens);
  const outputTokens = n(rawUsage.output_tokens);
  return {
    ...parsed,
    responseId: typeof body.id === "string" ? body.id : "",
    requestId,
    model: "gpt-5.6-terra",
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: n(rawUsage.total_tokens) || inputTokens + outputTokens,
      estimatedCostUsd: estimateTerraCostUsd(inputTokens, outputTokens),
    },
  };
}
