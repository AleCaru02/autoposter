/**
 * Opt-in editorial pilot for an Italian web-design subscription.
 * This is profile-scoped via content_strategies.platform_strategy and never enabled by default.
 * Facts about clients, portfolio, guarantees and inclusions must still come from verified brand sources.
 */
export const INSTAGRAM_WEBSITE_PILOT_TOPICS = [
  "Tre errori di un sito aziendale che scoraggiano i contatti",
  "Come potrebbe essere la homepage di un centro estetico",
  "Prima e dopo di un sito datato: esempio dimostrativo",
  "Perché una piccola attività ha bisogno di una pagina contatti chiara",
  "Esempio di homepage per un'impresa di ristrutturazioni",
  "Come funziona la richiesta di una bozza gratuita",
  "Cinque elementi essenziali di un sito per un professionista",
  "Come presentare un servizio con un sito leggibile da smartphone",
] as const;

export function instagramWebsitePilotEnabled(platformStrategy: unknown): boolean {
  return Boolean(platformStrategy && typeof platformStrategy === "object"
    && !Array.isArray(platformStrategy)
    && (platformStrategy as Record<string, unknown>).instagramWebsitePilot === true);
}

export function instagramWebsitePilotTopic(sequence: number): string {
  const safeSequence = Number.isFinite(sequence) ? Math.max(0, Math.floor(sequence)) : 0;
  return INSTAGRAM_WEBSITE_PILOT_TOPICS[safeSequence % INSTAGRAM_WEBSITE_PILOT_TOPICS.length];
}

export function instagramWebsitePilotBrief(sequence: number): string {
  return [
    "PILOTA INSTAGRAM - servizi di realizzazione siti web per il mercato italiano.",
    "Argomento specifico di questo post: " + instagramWebsitePilotTopic(sequence) + ".",
    "Target: titolari di centri estetici, parrucchieri, artigiani, imprese locali e piccoli professionisti italiani.",
    "Offerta confermata dal titolare per questo pilota: servizio siti web a 99 euro al mese e bozza iniziale gratuita.",
    "Obiettivo: ottenere richieste qualificate di bozza gratuita, non follower generici.",
    "Lingua: italiano naturale. Formato: POST Instagram singolo, NON Reel e NON carosello.",
    "Visual: stile professionale premium, gerarchia tipografica leggibile su smartphone, poche parole nell'immagine, nessuna grafica banale.",
    "Varia l'angolo rispetto ai post precedenti. Evita la ripetizione ossessiva del prezzo: offerta e bozza gratuita devono essere chiare soprattutto nella caption e nella CTA.",
    "CTA concreta: invita a richiedere una bozza gratuita tramite il canale di contatto verificato del brand; non inventare URL, numeri o account.",
    "Non inventare testimonianze, risultati, statistiche, clienti, esempi reali, inclusioni contrattuali o garanzie di guadagno.",
    "I siti dimostrativi e i prima/dopo ricostruiti devono essere dichiarati esempi, mai presentati come lavori commissionati o risultati di clienti reali.",
    "I fatti specifici dell'attività e gli esempi di portfolio devono essere confermati dalle pagine del sito e dal brand.",
  ].join("\n");
}
