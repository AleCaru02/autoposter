/**
 * Post Automatici social creative direction, adapted from publicly available
 * image-prompt, design-and-templates, brand-profile and hook/caption-writing
 * skills. Guidance is expressed as application rules, not an external provider.
 *
 * Source skills (MIT where noted): https://github.com/social-media-skills/skills
 * Image generation remains exclusively OpenAI Images 2 via existing router.
 */

export type CreativeTemplate = "ECONOMICS_CONTRAST" | "PROCESS_PROOF" | "CAROUSEL_STEP" | "STORY_HERO" | "EDITORIAL_HERO";

export function selectCreativeTemplate(input: { format: string; visualBrief: string; caption?: string | null }): CreativeTemplate {
  if (input.format === "STORY") return "STORY_HERO";
  if (input.format === "CAROUSEL") return "CAROUSEL_STEP";
  const text = `${input.visualBrief} ${input.caption ?? ""}`.toLocaleLowerCase("it-IT");
  if (/tariff|prezz|cost[oi]|margine|ricav|guadagn|redditivit|fatturat|investiment|budget/.test(text)) return "ECONOMICS_CONTRAST";
  if (/gestione|processo|procedura|check.in|organizza|prenotazion|pulizi|lavoro|metodo|servizio/.test(text)) return "PROCESS_PROOF";
  return "EDITORIAL_HERO";
}

/**
 * Select one of two deterministic photographic cover layouts. The exact same
 * placement is passed into the paid image prompt and into the SVG text renderer,
 * so background focal points and typography no longer fight each other.
 */
export function editorialPlacementForContent(input: {format: string; visualBrief: string; caption?: string | null}): "TOP_GRADIENT" | "BOTTOM_GRADIENT" {
  const template = selectCreativeTemplate(input);
  return input.format === "POST" && template === "ECONOMICS_CONTRAST" ? "BOTTOM_GRADIENT" : "TOP_GRADIENT";
}

const templateDirections: Record<CreativeTemplate, string> = {
  ECONOMICS_CONTRAST:
    "Una composizione editoriale fotografica unitaria che mostri la tensione concreta tra prezzo visibile e lavoro/costi dietro il risultato. Il contrasto emerge dalla scena, dalla profondità e dalla scelta del soggetto; non creare grafici, cifre, etichette o due foto affiancate. La scena deve essere pertinente al settore descritto nel brief.",
  PROCESS_PROOF:
    "Rendi visibile un passaggio operativo concreto e pertinente, con un soggetto principale e un dettaglio che spieghi il processo. Evita la solita scrivania con laptop, quaderno e chiavi se non sono davvero necessari all'idea.",
  CAROUSEL_STEP:
    "Questa è una singola slide di una sequenza: un solo passaggio visivo chiaro, continuità di palette e stile con le altre slide, niente collage o mini-punti elenco disegnati dall'AI.",
  STORY_HERO:
    "Scena verticale immersiva e immediata con soggetto forte nel centro, attenzione alle aree sicure superiori/inferiori dell'interfaccia social. Visualizza una sola idea senza decorazioni superflue.",
  EDITORIAL_HERO:
    "Hero editorial-fotografico, un soggetto memorabile che materializzi l'idea e una precisa relazione con il contesto. Usa prospettiva, luce e texture reali per creare un messaggio non intercambiabile tra attività.",
};

export function socialCreativeDirection(input: {
  profileName: string;
  industry?: string | null;
  provider: string;
  format: string;
  visualBrief: string;
  caption?: string | null;
  placement?: "TOP_GRADIENT" | "BOTTOM_GRADIENT";
}): string {
  const template = selectCreativeTemplate(input);
  return [
    "CREATIVE DIRECTION / POST AUTOMATICI — regole esecutive obbligatorie:",
    `Deliverable: un'immagine social ${input.format} per ${input.provider}; brand ${input.profileName}; settore ${input.industry || "dal profilo"}.`,
    `Template visuale: ${template}. ${templateDirections[template]}`,
    `Idea da visualizzare, non da riscrivere: ${input.visualBrief.trim().slice(0, 1200)}.`,
    "Il brief è un messaggio, NON una richiesta di una fotografia generica del settore. Il soggetto deve rendere visibile il motivo per cui il post merita attenzione.",
    "Un'unica scena coerente, un punto focale riconoscibile, un soggetto principale e non più di due dettagli narrativi; gerarchia da copertina editoriale leggibile a 320px su smartphone.",
    "L'immagine deve essere piena di contenuto visivo significativo: vietate aree enormi sfocate, vuote, monocolore o oggetti di riempimento. La parte inferiore deve contenere un soggetto riconoscibile, non solamente texture o arredo stock.",
    input.placement === "BOTTOM_GRADIENT"
      ? "Il copy deterministico sarà nella fascia INFERIORE: inquadra il soggetto nei primi 60% superiori, lascia la fascia inferiore sufficientemente pulita e priva di elementi essenziali. Non generare tu un pannello, un gradiente, testo o falsi placeholder."
      : "Il copy deterministico sarà nella fascia SUPERIORE compatta: inquadra il soggetto principale sotto la prima porzione di immagine. Non lasciare metà foto vuota; non generare tu un pannello, un gradiente, testo o falsi placeholder.",
    "Il renderer applicherà il testo reale separatamente: nessuna lettera, cifra, parola, logo, watermark, fake UI, badge o call to action generata nei pixel di sfondo.",
    "Coerenza brand: usare le informazioni già confermate, senza inventare luoghi, persone, prodotti, risultati e altri fatti aziendali.",
    "L'immagine non deve poter essere riciclata identica per un concorrente con un altro titolo. Se il soggetto è una chiave, un laptop, un caffè o un'agenda senza un significato essenziale, cambia concept prima di generare.",
    "Priorità: idea comprensibile > scena pertinente > inquadratura di livello editoriale > leggibilità mobile > estetica decorativa.",
  ].join("\n");
}

export function socialCopySkillPrompt(): string {
  return [
    "SKILL SOCIAL COPY — Brand profile / Hook Writer / Caption Writer:",
    "Prima di scrivere, usa esclusivamente il brand e il pubblico del profilo attivo; non mescolare attività diverse.",
    "Individua un'unica idea utile e una promessa che il corpo del post mantenga. Evita titoli clickbait o generici, numeri inventati e claim senza prove.",
    "Scrivi mentalmente 3 aperture con meccanismi diversi (domanda concreta, contrasto fondato, errore riconoscibile) e seleziona quella più naturale, specifica e verificabile. Non restituire le bozze scartate.",
    "Il hook della caption deve avere senso da solo e creare interesse; deve completare il visual, non ripetere semplicemente il testo stampato sull'immagine.",
    "Per ogni variante POST o STORY, il campo visualBrief DEVE iniziare con Titolo in grafica: «testo...» (massimo 62 caratteri e 12 parole, frase naturale e autonoma). Dopo il titolo descrivi soggetto, scena, prospettiva e rapporto visivo con il messaggio. Il titolo non deve essere la caption né un paragrafo.",
    "Per post/carousel/story, genera copy con una sola CTA pertinente all'obiettivo, tono umano, niente riempitivi tipici AI, frasi tronche o struttura da brochure generica.",
    "Il visualBrief deve dire quale idea mostrare con soggetto, scena, prospettiva e relazione narrativa; vietato 'ambiente elegante/luminoso + scrivania/chiavi/laptop' come unico concept.",
    "Cambia struttura e lunghezza secondo Instagram, Facebook, LinkedIn e Google Business Profile; non copiare il medesimo testo su tutti i canali.",
    "Un contenuto che fallisce i controlli deve restare in revisione: l'AI non approva né pubblica.",
  ].join("\n");
}
