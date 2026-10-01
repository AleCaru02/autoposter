import type { SocialFormat, SocialProvider } from "./openai-text.js";
import type { EditorialMemorySnapshot, ProfileType } from "./editorial-memory.js";

export type ContentSubject =
  | "CANONICAL_PERSON"
  | "PRODUCT"
  | "SERVICE"
  | "ENVIRONMENT"
  | "TEAM"
  | "GENERIC_PERSON"
  | "OBJECT"
  | "TYPOGRAPHIC"
  | "INFOGRAPHIC"
  | "REAL_ASSET";

export type SubjectDecision = {
  subject: ContentSubject;
  visualArchetype: string;
  reason: string;
  canonicalIdentityRequired: boolean;
  preferRealAsset: boolean;
  prohibitSyntheticPerson: boolean;
};

function recentCount(memory: EditorialMemorySnapshot | null, subject: ContentSubject) {
  return memory?.recent.subjects.find((item) => item.value === subject)?.count ?? 0;
}

function textSignals(text: string) {
  const value = text.normalize("NFKC").toLowerCase();
  return {
    product: /\b(prodotto|product|profumo|bottiglia|packaging|articolo|catalogo|sku)\b/i.test(value),
    service: /\b(servizio|service|consulenza|gestione|offerta|soluzione)\b/i.test(value),
    person: /\b(persona|volto|ritratto|portrait|founder|titolare|professionista|consulente|io|mia storia|mio percorso|personal brand)\b/i.test(value),
    team: /\b(team|squadra|collaborator|community|gruppo)\b/i.test(value),
    environment: /\b(ambiente|location|ufficio|studio|città|evento|casa|immobile|outdoor|indoor)\b/i.test(value),
    infographic: /\b(infografica|grafico|schema|diagramma|checklist|confronto|differenze|step|passi|numeri|dati)\b/i.test(value),
    typographic: /\b(quote|citazione|headline|tipograf|manifesto|testo centrale)\b/i.test(value),
  };
}

function archetype(subject: ContentSubject, format: SocialFormat) {
  if (format === "CAROUSEL") return subject === "CANONICAL_PERSON" ? "EDITORIAL_PERSON_CAROUSEL" : `${subject}_CAROUSEL`;
  if (format === "STORY") return subject === "CANONICAL_PERSON" ? "PERSON_STORY" : `${subject}_STORY`;
  const map: Record<ContentSubject,string> = {
    CANONICAL_PERSON:"EDITORIAL_PORTRAIT",
    PRODUCT:"PRODUCT_EDITORIAL",
    SERVICE:"SERVICE_EXPLAINER",
    ENVIRONMENT:"ENVIRONMENT_EDITORIAL",
    TEAM:"TEAM_COMMUNITY",
    GENERIC_PERSON:"LIFESTYLE_GENERIC_PERSON",
    OBJECT:"OBJECT_STILL_LIFE",
    TYPOGRAPHIC:"EDITORIAL_TYPOGRAPHIC",
    INFOGRAPHIC:"INFOGRAPHIC",
    REAL_ASSET:"REAL_ASSET_FEATURE",
  };
  return map[subject];
}

export function profileTypeStrategyInstruction(input: {
  profileType: ProfileType;
  industry?: string | null;
  businessModel?: string | null;
  offer?: string | null;
  audience?: string | null;
  objective?: string | null;
  provider: SocialProvider;
}) {
  const base = [
    `PROFILE TYPE STRATEGY: ${input.profileType}.`,
    `Settore: ${input.industry?.trim() || "non specificato"}.`,
    `Business model: ${input.businessModel?.trim() || "non specificato"}.`,
    `Offer/servizi: ${input.offer?.trim() || "deriva dal contesto verificato"}.`,
    `Audience: ${input.audience?.trim() || "deriva dal profilo"}.`,
    `Obiettivo: ${input.objective?.trim() || "deriva dal piano"}.`,
    `Piattaforma: ${input.provider}.`,
  ];
  if (input.profileType === "PERSONAL_BRAND") {
    base.push(
      "Costruisci il profilo attorno alla persona canonica: storia, esperienza, opinioni, competenze, backstage, community e offerta devono sembrare capitoli dello stesso percorso, non comunicati aziendali scollegati.",
      "Quando la persona compare deve essere la CANONICAL_PERSON certificata; non sostituirla con una persona simile.",
      "Bilancia presenza personale, authority, educational, backstage, community, prodotto/servizio e CTA in base a memoria, obiettivi e performance; non applicare percentuali universali.",
    );
  } else {
    base.push(
      "Il BUSINESS non richiede una persona canonica. Scegli liberamente fra prodotto, servizio, ambiente, team, oggetto, lifestyle, grafica, infografica o persone generiche in funzione del messaggio.",
      "La coerenza principale è brand, palette, tono, offerta, audience, qualità e messaggio; evita di trasformare l'attività in un falso Personal Brand.",
      "Bilancia commerciale/editoriale e varietà dei subject in base a memoria, calendario e performance; non applicare percentuali universali.",
    );
  }
  return base.join("\n");
}

export function chooseSubjectStrategy(input: {
  profileType: ProfileType;
  provider: SocialProvider;
  format: SocialFormat;
  topic: string;
  angle?: string | null;
  visualBrief: string;
  memory?: EditorialMemorySnapshot | null;
  suitableRealAssetAvailable: boolean;
  canonicalIdentityReady: boolean;
}): SubjectDecision {
  const signals = textSignals(`${input.topic} ${input.angle ?? ""} ${input.visualBrief}`);
  if (input.suitableRealAssetAvailable && (signals.product || input.profileType === "PERSONAL_BRAND" && signals.person)) {
    return {
      subject:"REAL_ASSET",
      visualArchetype:archetype("REAL_ASSET",input.format),
      reason:"Esiste un asset reale adatto: viene preferito per fedeltà e costo.",
      canonicalIdentityRequired:false,
      preferRealAsset:true,
      prohibitSyntheticPerson:false,
    };
  }

  if (input.profileType === "PERSONAL_BRAND" && signals.person) {
    if (input.canonicalIdentityReady) {
      return {
        subject:"CANONICAL_PERSON",
        visualArchetype:archetype("CANONICAL_PERSON",input.format),
        reason:"Il contenuto richiede la persona titolare e l'identità canonica è certificata.",
        canonicalIdentityRequired:true,
        preferRealAsset:false,
        prohibitSyntheticPerson:false,
      };
    }
    const fallback: ContentSubject = signals.infographic ? "INFOGRAPHIC" : signals.typographic ? "TYPOGRAPHIC" : signals.product ? "PRODUCT" : "OBJECT";
    return {
      subject:fallback,
      visualArchetype:archetype(fallback,input.format),
      reason:"Il contenuto è Personal Brand ma l'identità canonica non è pronta: uso un visual senza sostituto sintetico.",
      canonicalIdentityRequired:false,
      preferRealAsset:false,
      prohibitSyntheticPerson:true,
    };
  }

  const ranked: ContentSubject[] = [];
  if (signals.product) ranked.push("PRODUCT");
  if (signals.service) ranked.push("SERVICE");
  if (signals.team) ranked.push(input.profileType === "BUSINESS" ? "TEAM" : "ENVIRONMENT");
  if (signals.infographic) ranked.push("INFOGRAPHIC");
  if (signals.typographic) ranked.push("TYPOGRAPHIC");
  if (signals.environment) ranked.push("ENVIRONMENT");
  if (input.profileType === "BUSINESS" && signals.person) ranked.push("GENERIC_PERSON");

  // The fallback pool is intentionally broader than four templates: a real SMM must
  // preserve semantic fit while preventing the feed from collapsing into the same
  // subject/composition every few posts.
  if (input.profileType === "BUSINESS") {
    ranked.push("INFOGRAPHIC","TYPOGRAPHIC","ENVIRONMENT","OBJECT","GENERIC_PERSON","TEAM","SERVICE");
  } else {
    ranked.push("INFOGRAPHIC","TYPOGRAPHIC","ENVIRONMENT","OBJECT","SERVICE");
    // A Personal Brand may use the canonical person often, but only when the
    // content actually asks for the person. Identity is not a generic filler
    // used merely to balance the feed.
  }

  const subject = [...new Set(ranked)]
    .sort((a,b) => recentCount(input.memory ?? null,a)-recentCount(input.memory ?? null,b))[0] ?? "OBJECT";
  return {
    subject,
    visualArchetype:archetype(subject,input.format),
    reason:`Subject scelto per fit semantico e varietà rispetto alla memoria recente: ${subject}.`,
    canonicalIdentityRequired:false,
    preferRealAsset:subject==="PRODUCT",
    prohibitSyntheticPerson:input.profileType==="PERSONAL_BRAND",
  };
}
