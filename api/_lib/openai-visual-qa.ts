import { estimateTerraCostUsd } from "./openai-text.js";
import { platformVisualStrategyPrompt } from "./social-platform-strategy.js";

export type VisualQaStatus = "PASS" | "FAIL";

export type OpenAIVisualQaResult = {
  verdict: VisualQaStatus;
  reason: string;
  checks: {
    briefMatch: VisualQaStatus;
    composition: VisualQaStatus;
    technicalQuality: VisualQaStatus;
    socialFormat: VisualQaStatus;
    brandSafety: VisualQaStatus;
    textSafety: VisualQaStatus;
  };
  scores: {
    briefMatch: number;
    composition: number;
    technicalQuality: number;
    socialFormat: number;
    brandSafety: number;
    textSafety: number;
  };
  model: "gpt-5.6-terra";
  responseId: string;
  requestId: string | null;
  usage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number };
};

const KEYS = ["briefMatch","composition","technicalQuality","socialFormat","brandSafety","textSafety"] as const;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    scores: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(KEYS.map((key) => [key,{ type:"number",minimum:0,maximum:1 }])),
      required: [...KEYS],
    },
    reason: { type:"string",maxLength:500 },
  },
  required: ["scores","reason"],
} as const;

function outputText(body: Record<string,unknown>) {
  if (typeof body.output_text === "string" && body.output_text.trim()) return body.output_text;
  const parts:string[]=[];
  for (const item of Array.isArray(body.output)?body.output:[]) {
    if (!item || typeof item!=="object") continue;
    for (const part of Array.isArray((item as {content?:unknown}).content)?(item as {content:unknown[]}).content:[]) {
      if (part && typeof part==="object" && (part as {type?:unknown}).type==="output_text" && typeof (part as {text?:unknown}).text==="string") parts.push((part as {text:string}).text);
    }
  }
  return parts.join("\n").trim();
}

function n(value: unknown) { return typeof value==="number" && Number.isFinite(value) ? Math.max(0,Math.min(1,value)) : 0; }

export function finalizeVisualQa(scoresRaw: Record<string,unknown>, reason="") {
  const scores = Object.fromEntries(KEYS.map((key)=>[key,n(scoresRaw[key])])) as OpenAIVisualQaResult["scores"];
  const thresholds: Record<(typeof KEYS)[number],number> = {
    briefMatch:0.74,
    composition:0.72,
    technicalQuality:0.76,
    socialFormat:0.8,
    brandSafety:0.9,
    textSafety:0.9,
  };
  const checks = Object.fromEntries(KEYS.map((key)=>[key,scores[key]>=thresholds[key]?"PASS":"FAIL"])) as OpenAIVisualQaResult["checks"];
  return { verdict:Object.values(checks).every((value)=>value==="PASS")?"PASS" as const:"FAIL" as const,checks,scores,reason };
}

export async function runOpenAIVisualQa(input:{
  apiKey:string;
  imageUrl:string;
  profileName:string;
  industry:string|null;
  provider:string;
  format:string;
  visualBrief:string;
  altText:string|null;
  brandColors?:string[];
  brandFonts?:string[];
  brandVisualStyle?:string|null;
  fetcher?:typeof fetch;
}):Promise<OpenAIVisualQaResult> {
  if (!/^data:image\/(?:jpeg|png|webp);base64,/i.test(input.imageUrl) && !/^https:\/\//i.test(input.imageUrl)) throw new Error("VISUAL_QA_IMAGE_REQUIRED");
  const response=await (input.fetcher??fetch)("https://api.openai.com/v1/responses",{
    method:"POST",
    headers:{authorization:`Bearer ${input.apiKey}`,"content-type":"application/json"},
    body:JSON.stringify({
      model:"gpt-5.6-terra",
      store:false,
      reasoning:{effort:"low"},
      instructions:[
        "Sei il Visual QA di Post Automatici.",
        "Valuta esclusivamente ciò che è visibile nell'immagine candidata e il suo rapporto con il brief.",
        "Non identificare persone e non inferire attributi sensibili.",
        "briefMatch: il visual deve comunicare davvero l'idea centrale del brief, non limitarsi a mostrare genericamente il settore, la città o un ambiente decorativo.",
        "composition: una gerarchia principale chiara, massimo pochi elementi secondari, buon uso dello spazio, nessun sovraccarico, mappa affollata o collage improvvisato.",
        "technicalQuality: artefatti, anatomia quando visibile, nitidezza, prospettiva, coerenza di luce/ombre e qualità generale.",
        "socialFormat: idoneità al formato richiesto, margini sicuri, leggibilità immediata su smartphone; per STORY penalizza elementi essenziali troppo vicini a bordi/altezze occupate dalla UI.",
        "Il visual deve inoltre essere nativo della piattaforma selezionata; usa le regole seguenti come parte del controllo socialFormat:",
        platformVisualStrategyPrompt(input.provider as "INSTAGRAM" | "FACEBOOK" | "LINKEDIN" | "GBP"),
        "brandSafety: se sono forniti colori/font/stile del profilo, il visual deve rispettarli in modo riconoscibile. Penalizza palette arbitrarie o identità visiva scollegata. Nessun logo, prezzo, recensione, certificazione, prodotto o fatto del brand inventato/non richiesto.",
        "brandSafety deve inoltre penalizzare rappresentazioni sintetiche presentate come prove reali del brand: appartamenti, uffici, viste, prodotti, persone o risultati non confermati.",
        "Per luoghi reali, penalizza mappe, linee metro, percorsi, pin, label geografiche, edifici o relazioni spaziali aggiunti senza essere richiesti dal brief: una grafica plausibile non equivale a un dato verificato.",
        "textSafety: se il brief richiede testo, deve comparire solo il testo richiesto, grande e leggibile. Penalizza microcopy, label, quartieri, numeri, pseudo-dati, didascalie o testi extra inventati, anche se graficamente credibili; se non c'è testo richiesto, testo aggiunto abbassa fortemente lo score.",
        "Non approvare per plausibilità: usa score prudente quando un requisito non è verificabile visivamente.",
        "Restituisci solo JSON conforme allo schema.",
      ].join("\n"),
      input:[{role:"user",content:[
        {type:"input_text",text:JSON.stringify({
          brand:input.profileName,
          industry:input.industry,
          provider:input.provider,
          format:input.format,
          visualBrief:input.visualBrief,
          altText:input.altText,
          brandIdentity:{
            colors:input.brandColors??[],
            fonts:input.brandFonts??[],
            visualStyle:input.brandVisualStyle??null,
          },
        })},
        {type:"input_image",image_url:input.imageUrl,detail:"high"},
      ]}],
      text:{verbosity:"low",format:{type:"json_schema",name:"post_automatici_visual_qa",strict:true,schema:SCHEMA}},
      max_output_tokens:800,
    }),
  });
  const requestId=response.headers.get("x-request-id");
  const raw=await response.text();
  if(!response.ok) throw new Error(`OPENAI_VISUAL_QA_HTTP_${response.status}`);
  const body=JSON.parse(raw) as Record<string,unknown>;
  const text=outputText(body);
  if(!text) throw new Error("OPENAI_VISUAL_QA_EMPTY_OUTPUT");
  const parsed=JSON.parse(text) as {scores?:Record<string,unknown>;reason?:unknown};
  const base=finalizeVisualQa(parsed.scores??{},typeof parsed.reason==="string"?parsed.reason:"");
  const usage=body.usage&&typeof body.usage==="object"?body.usage as Record<string,unknown>:{};
  const inputTokens=typeof usage.input_tokens==="number"?usage.input_tokens:0;
  const outputTokens=typeof usage.output_tokens==="number"?usage.output_tokens:0;
  return {
    ...base,
    model:"gpt-5.6-terra",
    responseId:typeof body.id==="string"?body.id:"",
    requestId,
    usage:{inputTokens,outputTokens,estimatedCostUsd:estimateTerraCostUsd(inputTokens,outputTokens)},
  };
}
