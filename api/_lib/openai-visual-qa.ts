import { estimateTerraCostUsd } from "./openai-text.js";
import { platformVisualStrategyPrompt } from "./social-platform-strategy.js";
import { fetchOpenAiQaWithRetry, openAiQaFailureCode } from "./openai-qa-retry.js";

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
    editorialQuality: VisualQaStatus;
    genericTemplate: VisualQaStatus;
    stockLike: VisualQaStatus;
    textDensity: VisualQaStatus;
    decorativeUsefulness: VisualQaStatus;
  };
  scores: {
    briefMatch: number;
    composition: number;
    technicalQuality: number;
    socialFormat: number;
    brandSafety: number;
    textSafety: number;
    editorialQuality: number;
    genericTemplate: number;
    stockLike: number;
    textDensity: number;
    decorativeUsefulness: number;
  };
  model: "gpt-5.6-terra";
  responseId: string;
  requestId: string | null;
  usage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number };
};

const KEYS = ["briefMatch","composition","technicalQuality","socialFormat","brandSafety","textSafety","editorialQuality","genericTemplate","stockLike","textDensity","decorativeUsefulness"] as const;

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
    editorialQuality:0.82,
    genericTemplate:0.86,
    stockLike:0.86,
    textDensity:0.82,
    decorativeUsefulness:0.8,
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
  const fetcher: typeof fetch = input.fetcher ?? ((request, init) => globalThis.fetch(request, init));
  const request:RequestInit={
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
        "textSafety: il testo deve essere supportato dal brief, leggibile e gerarchizzato. Per statiche educative con 3-5 punti sono ammesse mini-label supportate dal brief; penalizza invece claim, numeri, microcopy o pseudo-dati inventati.",
        "editorialQuality: valuta se sembra una vera composizione editoriale premium e intenzionale, non una bozza AI o una card povera. Penalizza titolo enorme con contenuto quasi vuoto, gerarchia debole e blocchi privi di significato.",
        "genericTemplate: score alto solo se il visual NON sembra un template universale. Penalizza griglie generiche, 5 card identiche, soli numeri/icone senza label, struttura intercambiabile con qualsiasi settore.",
        "stockLike: score alto solo se la scena NON dipende da cliché stock. Penalizza chiavi, laptop, tazze, skyline, scrivanie, strette di mano e props generici usati come riempitivo senza funzione narrativa.",
        "textDensity: score alto quando la quantità di testo è adatta al formato e leggibile mobile. Penalizza sia muri di testo sia eccesso di vuoto informativo quando il brief richiede più punti.",
        "decorativeUsefulness: ogni elemento decorativo deve aiutare gerarchia, significato o brand. Penalizza icone, forme, props e texture aggiunti solo per riempire spazio.",
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
  };
  const {response,raw}=await fetchOpenAiQaWithRetry({
    fetcher,
    url:"https://api.openai.com/v1/responses",
    init:request,
  });
  const requestId=response.headers.get("x-request-id");
  if(!response.ok) throw new Error(openAiQaFailureCode("OPENAI_VISUAL_QA",response,raw));
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
