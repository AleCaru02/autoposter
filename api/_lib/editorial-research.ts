import { buildPlatformManagerInstruction } from "./platform-social-manager.js";
import type { SocialFormat, SocialProvider } from "./openai-text.js";

export type EditorialResearchMode = "BALANCED" | "EVERGREEN" | "TIPS" | "NEWS" | "WEBSITE_ONLY";

export type EditorialResearchPolicy = {
  mode: EditorialResearchMode;
  useWebSearch: boolean;
  freshnessDays: number | null;
  instruction: string;
};

export function normalizeEditorialResearchMode(value: unknown): EditorialResearchMode {
  return value === "EVERGREEN" || value === "TIPS" || value === "NEWS" || value === "WEBSITE_ONLY" ? value : "BALANCED";
}

export function buildEditorialResearchPolicy(modeValue: unknown): EditorialResearchPolicy {
  const mode = normalizeEditorialResearchMode(modeValue);
  if (mode === "WEBSITE_ONLY") return { mode, useWebSearch: false, freshnessDays: null, instruction: "Usa il sito come unica fonte fattuale. Non introdurre informazioni esterne." };
  if (mode === "NEWS") return { mode, useWebSearch: true, freshnessDays: 14, instruction: "Cerca aggiornamenti e notizie recenti realmente pertinenti al settore. Preferisci fonti primarie, istituzionali o editoriali affidabili; evita trend generici senza utilità per il pubblico del brand." };
  if (mode === "TIPS") return { mode, useWebSearch: true, freshnessDays: null, instruction: "Cerca informazioni affidabili utili per creare consigli pratici, spiegazioni, errori da evitare, checklist e contenuti educativi pertinenti al settore." };
  if (mode === "EVERGREEN") return { mode, useWebSearch: true, freshnessDays: null, instruction: "Cerca conoscenze affidabili e durature del settore. Evita di forzare notizie o trend; privilegia contenuti evergreen utili anche tra mesi." };
  return { mode, useWebSearch: true, freshnessDays: 30, instruction: "Bilancia contenuti evergreen, consigli pratici e aggiornamenti recenti pertinenti. Usa le news solo quando hanno una relazione concreta con il settore, il pubblico o i servizi del brand." };
}

export function buildSectorResearchInstruction(input: { industry: string | null; description: string | null; businessModel: string | null; target: string | null; mode?: unknown; providers?: SocialProvider[]; formats?: SocialFormat[] }) {
  const policy = buildEditorialResearchPolicy(input.mode);
  const sector = [input.industry, input.description, input.businessModel].filter(Boolean).join(" · ") || "settore dell'attività";
  const target = input.target ? ` Pubblico di riferimento: ${input.target}.` : "";
  const providers: SocialProvider[] = input.providers?.length ? input.providers : ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "GBP"];
  const formats: SocialFormat[] = input.formats?.length ? input.formats : ["POST", "CAROUSEL", "STORY"];
  return {
    ...policy,
    instruction: [
      `Perimetro editoriale: ${sector}.${target}`,
      policy.instruction,
      "Il sito serve soprattutto a capire identità del brand, servizi realmente offerti, tono, posizionamento e segnali visivi; non è l'unico universo di argomenti.",
      "Qualunque informazione esterna deve essere direttamente pertinente al perimetro editoriale. Non trasformare una notizia generica in contenuto solo perché è popolare.",
      "Distingui sempre fatti del brand da fatti esterni: non attribuire al brand dati, risultati, prezzi o dichiarazioni trovati altrove.",
      buildPlatformManagerInstruction(providers, formats),
    ].join(" "),
  };
}
