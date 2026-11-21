import type { BrandContext } from "./openai-text.js";

/** This scope is passed only by the owner's dedicated GBP draft cron.
 * Do not apply these site-specific rules to other profiles or platforms. */
export function isMilanPropertyDailyGbpProfile(profileId: string, scopedProfileId: string | undefined, provider: string): boolean {
  return provider === "GBP" && Boolean(scopedProfileId) && scopedProfileId === profileId;
}

export const MILAN_PROPERTY_GBP_EDITORIAL_GUIDE = [
  "IDENTITA' DEL BRAND VERIFICATA DAL SITO: Il Tuo Property Manager a Milano, referente diretto Alessandro Caruso.",
  "Il servizio comincia da una valutazione realistica dell'immobile: microzona, caratteristiche, costi, sostenibilita', strategia di locazione.",
  "Servizi effettivamente comunicati: annunci, prezzi, ospiti, check-in, pulizie, manutenzioni, pratiche concordate e report mensile.",
  "Tono: professionale, diretto, competente, sobrio. Comunicare in prima persona come referente diretto, non come agenzia impersonale.",
  "Call to action preferita: 'Valuta il tuo immobile' sul sito https://iltuopropertymanager.it.",
  "Non promettere rendimenti, occupazione, guadagni, risultati garantiti o immobili specifici non verificati.",
  "Non usare claim aggressivi o linguaggio da agenzia anonima. Contenuti utili ai proprietari di immobili a Milano.",
].join(" ");

export function milanPropertyGbpBrandContext(brand: BrandContext): BrandContext {
  return {
    ...brand,
    profileName: "Il Tuo Property Manager a Milano – Alessandro Caruso",
    websiteUrl: brand.websiteUrl || "https://iltuopropertymanager.it",
    tone: "Professionale, diretto, pragmatico, personale, preciso; niente iperboli commerciali.",
    userContext: [brand.userContext, MILAN_PROPERTY_GBP_EDITORIAL_GUIDE].filter(Boolean).join("\n\n"),
  };
}

/** Colors and typography traced to the user's public website source.
 * Preserve any already approved real logo asset; never fabricate one. */
export function milanPropertyGbpVisualIdentity(value: unknown): Record<string, unknown> {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    ...source,
    observedColors: ["#1B7E50", "#15171A", "#FFFFFF", "#F8FAFC"],
    observedFonts: ["Plus Jakarta Sans"],
    summary: [
      "Use the actual identity of iltuopropertymanager.it: bright white background,",
      "anthracite black #15171A typography, deep green #1B7E50 CTAs and accents.",
      "Modern minimal editorial composition, generous white space, clean rounded cards.",
      "No navy-and-gold luxury template, no arbitrary blue palette, no fictitious crest or logo.",
      "If the actual approved logo is unavailable, use plain text branding only.",
      "Align messages to Alessandro Caruso as the direct property manager in Milan.",
    ].join(" "),
  };
}
