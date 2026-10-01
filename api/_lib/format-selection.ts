import type { EditorialMemorySnapshot } from "./editorial-memory.js";
import type { SocialFormat, SocialProvider } from "./openai-text.js";

export type InformationDensity = "LOW" | "MEDIUM" | "HIGH";

export type FormatSelectionInput = {
  provider: SocialProvider;
  topic: string;
  objective?: string | null;
  goal?: string | null;
  supportedFormats: SocialFormat[];
  requestedFormat?: SocialFormat | null;
  learnedFormat?: SocialFormat | null;
  memory?: EditorialMemorySnapshot | null;
  reusableAssetCount?: number;
  budgetBand?: string | null;
};

export type FormatSelectionDecision = {
  selectedFormat: SocialFormat;
  preferredFormat: SocialFormat;
  informationDensity: InformationDensity;
  reasons: string[];
  capabilityConstrained: boolean;
};

function text(input: FormatSelectionInput) {
  return `${input.topic} ${input.objective ?? ""} ${input.goal ?? ""}`.normalize("NFKC").toLowerCase();
}

export function estimateInformationDensity(input: Pick<FormatSelectionInput, "topic" | "objective" | "goal">): InformationDensity {
  const value = `${input.topic} ${input.objective ?? ""} ${input.goal ?? ""}`.normalize("NFKC").toLowerCase();
  const numbered = /\b(?:[4-9]|1\d)\s+(?:punti|differenze|consigli|errori|passi|idee|motivi|regole|strategie|cose|domande)\b/i.test(value);
  const denseIntent = /\b(?:guida|checklist|confront|compar|differenz|spiega|come funziona|errori|passi|vantaggi|svantaggi|faq|analisi)\b/i.test(value);
  if (numbered || denseIntent) return "HIGH";
  if (/\b(?:annuncio|dietro le quinte|momento|evento|opinione|domanda|sondaggio|novità breve|promemoria)\b/i.test(value)) return "LOW";
  return "MEDIUM";
}

function recentFormatCount(memory: EditorialMemorySnapshot | null | undefined, format: SocialFormat) {
  return memory?.recent.formats.find((item) => item.value === format)?.count ?? 0;
}

function scheduledFormatCount(memory: EditorialMemorySnapshot | null | undefined, format: SocialFormat) {
  return memory?.calendar.formats.find((item) => item.value === format)?.count ?? 0;
}

export function selectAutonomousFormat(input: FormatSelectionInput): FormatSelectionDecision {
  const supported = [...new Set(input.supportedFormats)];
  if (!supported.length) return { selectedFormat: "POST", preferredFormat: "POST", informationDensity: "MEDIUM", reasons: ["Nessun formato provider dichiarato: fallback sicuro POST."], capabilityConstrained: true };

  const density = estimateInformationDensity(input);
  const value = text(input);
  const scores: Record<SocialFormat, number> = { POST: 0, STORY: 0, CAROUSEL: 0 };
  const reasons: string[] = [];

  if (density === "HIGH") { scores.CAROUSEL += 7; scores.POST += 2; reasons.push("Alta densità informativa: il carosello è preferibile quando pubblicabile realmente."); }
  if (density === "MEDIUM") { scores.POST += 4; scores.CAROUSEL += 2; reasons.push("Densità media: post o carosello in base a memoria e capability."); }
  if (density === "LOW") { scores.STORY += 5; scores.POST += 3; reasons.push("Bassa densità: contenuto rapido compatibile con Story quando supportata."); }

  if (/\b(?:educa|educational|guida|checklist|differenz|confront|passi|errori|consigli|faq)\b/i.test(value)) scores.CAROUSEL += 4;
  if (/\b(?:conversion|contatt|prenota|richied|servizio|offerta)\b/i.test(value)) scores.POST += 3;
  if (/\b(?:evento|backstage|dietro le quinte|momento|sondaggio)\b/i.test(value)) scores.STORY += 3;

  if (input.provider === "LINKEDIN") { scores.POST += 2; scores.STORY -= 20; }
  if (input.provider === "GBP") { scores.POST += 20; scores.STORY -= 20; scores.CAROUSEL -= 20; }
  if (input.provider === "FACEBOOK") scores.POST += 2;
  if (input.provider === "INSTAGRAM" && density === "HIGH") scores.CAROUSEL += 2;

  if (input.requestedFormat) {
    scores[input.requestedFormat] += 3;
    reasons.push(`Il Planner aveva suggerito ${input.requestedFormat}, considerato ma non imposto.`);
  }
  if (input.learnedFormat) {
    scores[input.learnedFormat] += 5;
    reasons.push(`Learning reale con confidenza sufficiente favorisce ${input.learnedFormat}.`);
  }

  for (const format of ["POST","STORY","CAROUSEL"] as SocialFormat[]) {
    const recent = recentFormatCount(input.memory, format);
    const future = scheduledFormatCount(input.memory, format);
    scores[format] -= Math.min(4, recent * 0.55 + future * 0.8);
  }
  if (input.memory?.recent.formats.length) reasons.push("La memoria editoriale penalizza formati sovrautilizzati nel feed e nel calendario.");

  if ((input.reusableAssetCount ?? 0) > 0) {
    scores.POST += 1;
    scores.STORY += 0.5;
    reasons.push("Sono disponibili asset riutilizzabili: lieve preferenza ai formati compatibili senza nuova produzione pesante.");
  }
  if (input.budgetBand === "CAUTION" || input.budgetBand === "HARD_STOP") {
    scores.POST += 2;
    scores.CAROUSEL -= 2;
    reasons.push("Budget AI sotto pressione: evita complessità visuale non necessaria.");
  }

  const order: SocialFormat[] = ["CAROUSEL","POST","STORY"];
  const preferredFormat = [...order].sort((a,b)=>scores[b]-scores[a] || order.indexOf(a)-order.indexOf(b))[0] ?? "POST";
  const publishable = order.filter((format)=>supported.includes(format)).sort((a,b)=>scores[b]-scores[a] || order.indexOf(a)-order.indexOf(b));
  const selectedFormat = publishable[0] ?? supported[0] ?? "POST";
  const capabilityConstrained = selectedFormat !== preferredFormat;
  if (capabilityConstrained) reasons.push(`${preferredFormat} sarebbe editorialmente preferibile, ma il runtime provider non lo supporta per pubblicazione reale; selezionato ${selectedFormat} senza fingere capability.`);
  else reasons.push(`Formato selezionato autonomamente: ${selectedFormat}.`);

  return { selectedFormat, preferredFormat, informationDensity: density, reasons, capabilityConstrained };
}
