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
