export const LANGUAGE_QUALITY_VERSION = "2026-10-01";

export function languageQualityPrompt() {
  return [
    "REGOLA LINGUISTICA GLOBALE — vale per ogni profilo, settore, piattaforma e formato.",
    "Mantieni la lingua richiesta dall'utente o coerente con il profilo. Se l'input e il brand sono in italiano e non viene richiesta un'altra lingua, scrivi in italiano.",
    "Quando scrivi in italiano, il testo deve suonare come scritto da un copywriter madrelingua italiano: naturale, idiomatico, fluido e credibile, non come una traduzione letterale o una frase generata meccanicamente.",
    "Una frase può essere grammaticalmente corretta ma comunque innaturale: in quel caso va riscritta. Evita calchi dall'inglese, ordine delle parole artificiale, catene nominali rigide, ripetizioni, anglicismi inutili e formule che un professionista italiano difficilmente userebbe.",
    "Titoli, hook e headline devono funzionare letti ad alta voce al primo colpo: soggetto e significato immediati, ritmo naturale, nessuna costruzione contorta. Preferisci verbi attivi e formulazioni idiomatiche.",
    "Prima di restituire l'output, rileggi silenziosamente editorialTopic, editorialAngle, hook, caption, CTA, headline e body delle slide, alt text e qualsiasi testo destinato a comparire in grafica. Se qualcosa suona legnoso, ambiguo o poco italiano, riscrivilo senza alterare il significato.",
    "Esempio di principio, non template fisso: meglio «5 cose che ho imparato in 20 anni di network marketing» rispetto a «5 cose che 20 anni di network mi hanno insegnato».",
  ].join("\n");
}

export function visualTextLanguageQualityPrompt() {
  return [
    "Qualsiasi testo destinato a essere visibile nell'immagine deve essere linguisticamente naturale e già coerente con il copy approvato.",
    "Se il testo è in italiano, deve suonare idiomatico e professionale, non letterale o meccanico. Mantieni esattamente il significato approvato e non inventare nuovi claim.",
  ].join("\n");
}


const DANGLING_ITALIAN_ENDING = /(?:\b(?:e|ed|o|oppure|ma|però|che|di|a|da|in|con|su|per|tra|fra|il|lo|la|i|gli|le|un|uno|una|del|della|dei|degli|delle|al|alla|ai|agli|alle|nel|nella|nei|negli|nelle)\s*)$/i;

export function italianNativeQualityIssues(value: string, field = "copy") {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const issues: string[] = [];

  if (DANGLING_ITALIAN_ENDING.test(text)) issues.push(`ITALIAN_DANGLING_ENDING:${field}`);
  if (/\b\d+\s+cose\s+che\s+\d+\s+anni\s+di\s+[^,.!?]{2,60}\s+mi\s+hanno\s+insegnato\b/i.test(text)) {
    issues.push(`ITALIAN_UNNATURAL_EXPERIENCE_FORMULA:${field}`);
  }
  if (/\b(?:andare a creare|andare a vedere|andare a fare)\b/i.test(text)) {
    issues.push(`ITALIAN_UNNECESSARY_PERIPHRASE:${field}`);
  }
  if (/\b(?:in merito a quello che|quello che è il|quella che è la|quelli che sono i|quelle che sono le)\b/i.test(text)) {
    issues.push(`ITALIAN_BUREAUCRATIC_FILLER:${field}`);
  }
  if (/\b(?:fondamentalmente|sostanzialmente|praticamente)\b(?:[^.!?]{0,25})\b(?:fondamentalmente|sostanzialmente|praticamente)\b/i.test(text)) {
    issues.push(`ITALIAN_FILLER_REPETITION:${field}`);
  }
  return issues;
}

export function titleQualityIssues(title: string) {
  const value = title.replace(/\s+/g, " ").trim();
  const issues = italianNativeQualityIssues(value, "title");
  if (!value) return [...issues, "TITLE_EMPTY"];

  if (/^\d+\s+(?:differenze|consigli|errori|cose|idee|strategie|motivi|aspetti)\s+(?:principali|utili|comuni|importanti|fondamentali)$/i.test(value)
      || /:\s*\d+\s+(?:differenze|consigli|errori|cose|idee|strategie|motivi|aspetti)\s+(?:principali|utili|comuni|importanti|fondamentali)$/i.test(value)) {
    issues.push("TITLE_GENERIC_LISTICLE");
  }
  if (/\b(?:tutto quello che devi sapere|la guida definitiva|scopri tutto|imperdibile|da non perdere)\b/i.test(value)) {
    issues.push("TITLE_AI_GENERIC_FORMULA");
  }
  if (value.length > 110) issues.push("TITLE_TOO_LONG");
  return [...new Set(issues)];
}

export function languageQualityIssues(input: {
  editorialTopic: string;
  editorialAngle: string;
  variants: Array<{
    provider: string;
    hook: string;
    caption: string;
    cta?: string | null;
    carouselSlides?: Array<{ headline: string; body: string }>;
  }>;
}) {
  const issues = [
    ...titleQualityIssues(input.editorialTopic),
    ...italianNativeQualityIssues(input.editorialAngle, "editorialAngle"),
  ];
  for (const variant of input.variants) {
    issues.push(...italianNativeQualityIssues(variant.hook, `hook:${variant.provider}`));
    issues.push(...italianNativeQualityIssues(variant.caption, `caption:${variant.provider}`));
    if (variant.cta) issues.push(...italianNativeQualityIssues(variant.cta, `cta:${variant.provider}`));
    for (const [index, slide] of (variant.carouselSlides ?? []).entries()) {
      issues.push(...italianNativeQualityIssues(slide.headline, `slideHeadline:${variant.provider}:${index + 1}`));
      issues.push(...italianNativeQualityIssues(slide.body, `slideBody:${variant.provider}:${index + 1}`));
    }
  }
  return [...new Set(issues)];
}
