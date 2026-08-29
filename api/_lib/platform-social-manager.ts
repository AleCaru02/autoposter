import type { SocialFormat, SocialProvider } from "./openai-text.js";

export type AdaptationMode = "REUSE_CORE" | "REWRITE_PLATFORM" | "DEDICATED_CONTENT" | "INELIGIBLE";

export type PlatformDecision = {
  provider: SocialProvider;
  format: SocialFormat;
  mode: AdaptationMode;
  rationale: string;
  requirements: string[];
};

const POLICIES: Record<SocialProvider, { role: string; requirements: string[] }> = {
  INSTAGRAM: {
    role: "visual-first social manager",
    requirements: ["hook immediato", "copy scansionabile", "visuale centrale", "CTA semplice", "hashtag solo se utili e pertinenti"],
  },
  FACEBOOK: {
    role: "community social manager",
    requirements: ["contesto comprensibile anche senza carosello", "tono conversazionale coerente col brand", "spazio a discussione/condivisione", "link solo se utile all'obiettivo"],
  },
  LINKEDIN: {
    role: "professional/editorial social manager",
    requirements: ["riscrittura professionale del concetto", "insight o implicazione concreta", "struttura leggibile a paragrafi", "niente copia di caption Instagram", "CTA professionale non forzata"],
  },
  GBP: {
    role: "local business update manager",
    requirements: ["utilità diretta per cliente o ricerca locale", "testo conciso e informativo", "fatto/servizio/aggiornamento realmente collegato all'attività", "CTA operativa solo se supportata", "niente hashtag decorativi o engagement bait"],
  },
};

export function decidePlatformAdaptation(provider: SocialProvider, format: SocialFormat, input: { localBusinessRelevance?: boolean; professionalRelevance?: boolean } = {}): PlatformDecision {
  if (provider === "GBP") {
    if (format !== "POST") return { provider, format, mode: "INELIGIBLE", rationale: "Google Business Profile usa un contenuto business/local specifico e questo formato non viene trattato come pubblicabile.", requirements: POLICIES.GBP.requirements };
    if (input.localBusinessRelevance === false) return { provider, format, mode: "INELIGIBLE", rationale: "Il concept non ha utilità locale o aziendale sufficiente per GBP.", requirements: POLICIES.GBP.requirements };
    return { provider, format, mode: "DEDICATED_CONTENT", rationale: "GBP non deve ricevere automaticamente la caption degli altri social: serve una versione specifica orientata all'attività e all'azione locale.", requirements: POLICIES.GBP.requirements };
  }
  if (provider === "LINKEDIN") {
    if (format === "STORY") return { provider, format, mode: "INELIGIBLE", rationale: "La story non è un formato LinkedIn previsto dal motore.", requirements: POLICIES.LINKEDIN.requirements };
    return { provider, format, mode: "REWRITE_PLATFORM", rationale: "Il tema può essere condiviso, ma LinkedIn richiede una variante editoriale/professionale propria.", requirements: POLICIES.LINKEDIN.requirements };
  }
  if (provider === "INSTAGRAM") return { provider, format, mode: "REWRITE_PLATFORM", rationale: "Mantieni il nucleo informativo ma adattalo a consumo visuale e rapido.", requirements: POLICIES.INSTAGRAM.requirements };
  return { provider, format, mode: "REWRITE_PLATFORM", rationale: "Mantieni il nucleo informativo ma riscrivilo per conversazione e community Facebook.", requirements: POLICIES.FACEBOOK.requirements };
}

export function buildPlatformManagerInstruction(providers: SocialProvider[], formats: SocialFormat[]) {
  const lines = [
    "SOCIAL MANAGER ORCHESTRATOR: crea prima un nucleo editoriale comune (tema, fatti verificati, obiettivo), poi decidi e scrivi ogni variante per piattaforma. Non duplicare meccanicamente lo stesso copy.",
    "Il nucleo comune può essere riusato come informazione, ma hook, struttura, CTA, lunghezza, tono e visual brief devono essere adattati alla piattaforma.",
  ];
  for (const provider of providers) {
    for (const format of formats) {
      const decision = decidePlatformAdaptation(provider, format);
      lines.push(`${provider}/${format}: ${decision.mode}. ${decision.rationale} Requisiti: ${decision.requirements.join("; ")}.`);
    }
  }
  lines.push("Per GBP valuta esplicitamente la pertinenza locale/aziendale: se manca, eligible=false. Se c'è, crea contenuto dedicato GBP e non una copia abbreviata di Instagram/Facebook/LinkedIn.");
  lines.push("Per LinkedIn, quando eligible, riscrivi il concetto come contenuto professionale autonomo; non mantenere hashtag, emoji, hook o CTA solo perché presenti su Instagram.");
  return lines.join("\n");
}
