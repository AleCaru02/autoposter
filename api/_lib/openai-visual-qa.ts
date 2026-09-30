import { estimateTerraCostUsd } from "./openai-text.js";

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
        "briefMatch: coerenza concreta con il brief visivo.",
        "composition: gerarchia, leggibilità, ritaglio e composizione professionale.",
        "technicalQuality: artefatti, anatomia quando visibile, nitidezza e qualità generale.",
        "socialFormat: idoneità al formato social richiesto e leggibilità mobile.",
        "brandSafety: nessun logo, prezzo, recensione, certificazione, prodotto o fatto del brand inventato/non richiesto.",
        "textSafety: nessun testo grafico illeggibile, falso o non richiesto; se non c'è testo, assegna score alto.",
        "Non approvare per plausibilità: usa score prudente quando un requisito non è verificabile visivamente.",
        "Restituisci solo JSON conforme allo schema.",
      ].join("\n"),
      input:[{role:"user",content:[
        {type:"input_text",text:JSON.stringify({brand:input.profileName,industry:input.industry,provider:input.provider,format:input.format,visualBrief:input.visualBrief,altText:input.altText})},
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
