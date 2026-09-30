export type ProfileVisualKind = "BUSINESS" | "PERSONAL_BRAND";

export function personalBrandVisualSystem(profileType: ProfileVisualKind | undefined) {
  if (profileType !== "PERSONAL_BRAND") return "";
  return [
    "SISTEMA VISIVO PERSONAL BRAND:",
    "Tratta il singolo contenuto come parte di un feed editoriale coerente e riconoscibile, non come una card isolata o un template social generico.",
    "Mantieni una grammatica visiva ricorrente: palette del profilo, personalità tipografica, margini generosi, gerarchia pulita, accenti grafici coerenti e qualità fotografica/editoriale premium.",
    "Non copiare una palette standard per tutti i Personal Brand: colori, font e stile devono provenire dal profilo attivo. Un riferimento estetico esterno serve solo per livello qualitativo, struttura e varietà, non per imporre rosa, beige, viola o altri colori.",
    "Alterna in modo naturale archetipi diversi in base al contenuto: ritratto/editoriale personale, card educativa o carosello, prodotto/servizio, dietro le quinte, community/evento, CTA o scelta guidata. Non usare sempre la stessa composizione.",
    "Per i visual tipografici: look da magazine moderno, headline dominante, eventuale sottotitolo breve, molto spazio negativo, elementi decorativi minimi e funzionali, icone lineari semplici quando servono.",
    "Per i visual fotografici: composizione curata, luce credibile, profondità reale, posa naturale e spazio negativo progettato per il testo; evita fotografie stock, pose plastiche e fondali artificialmente vuoti.",
    "Per CAROUSEL: ogni slide deve sembrare parte dello stesso sistema editoriale, con griglia, palette e gerarchia coerenti ma variazioni reali di composizione; niente collage unico o sette slide tutte identiche.",
    "Non inventare il volto del titolare del Personal Brand. Se non viene fornito o riutilizzato un asset reale approvato della persona, non creare un volto sintetico fingendo che sia lei/lui: preferisci visual tipografici, dettagli, mani non identificabili, ambienti, oggetti, prodotto confermato o scene editoriali senza identità personale falsa.",
    "Non inventare confezioni, loghi o prodotti di marca. Un prodotto specifico può essere mostrato come reale solo se il brief o un asset confermato lo supporta.",
  ].join("\n");
}
