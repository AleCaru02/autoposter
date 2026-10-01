export type SocialPlatform = "INSTAGRAM" | "FACEBOOK" | "LINKEDIN" | "GBP";

export type SocialPlatformStrategy = {
  label: string;
  copy: string[];
  visual: string[];
  format: string[];
};

const STRATEGIES: Record<SocialPlatform, SocialPlatformStrategy> = {
  INSTAGRAM: {
    label: "Instagram",
    copy: [
      "Visual-first: il testo deve sostenere un contenuto che ferma lo scroll, non sembrare un articolo.",
      "Apri con un hook forte e immediato; rendi la caption facile da scorrere con paragrafi brevi e struttura chiara.",
      "Mantieni la caption relativamente compatta: elimina spiegazioni ridondanti e porta subito il valore pratico.",
      "CTA coerenti con Instagram: commentare, salvare, condividere oppure contattare il brand quando pertinente.",
      "Usa solo hashtag realmente pertinenti al tema, settore, pubblico o area; niente riempimento o liste generiche.",
    ],
    visual: [
      "Il visual è parte primaria del contenuto: forte punto focale, impatto immediato e leggibilità mobile.",
      "Evita il look da brochure o comunicato; privilegia una composizione social nativa, riconoscibile e capace di fermare lo scroll.",
      "Nei caroselli costruisci una progressione educativa; nelle Stories riduci drasticamente testo ed elementi.",
    ],
    format: [
      "POST: messaggio centrale leggibile in pochi secondi.",
      "CAROUSEL: prima slide hook forte, una sola idea per slide, sviluppo progressivo e CTA finale.",
      "STORY: copy e visual molto brevi, gerarchia verticale netta e comprensione quasi immediata.",
    ],
  },
  FACEBOOK: {
    label: "Facebook",
    copy: [
      "Tono più discorsivo e umano rispetto a Instagram, con contesto sufficiente a capire il tema senza dipendere dal visual.",
      "Quando pertinente valorizza dimensione locale, relazione con la community, casi pratici e utilità concreta.",
      "Non costruire il post attorno agli hashtag: usali con moderazione e solo quando aggiungono reale utilità.",
      "CTA più dirette verso sito, WhatsApp, messaggio, richiesta informazioni o altra azione concreta disponibile nel contesto.",
      "Evita di copiare la struttura Instagram: Facebook può spiegare un po' di più e deve sembrare naturale nel feed.",
    ],
    visual: [
      "Il visual deve supportare il racconto e risultare umano e chiaro, senza dipendere da effetti grafici eccessivi.",
      "Quando il contenuto è locale, rendi visibile il contesto territoriale solo con elementi supportati e non inventati.",
      "Evita grafiche eccessivamente dense o pensate come caroselli Instagram se il formato richiesto è un singolo post.",
    ],
    format: [
      "POST: più contesto e narrazione rispetto a Instagram, senza diventare prolisso.",
      "CAROUSEL: sequenza chiara e utile, con meno enfasi su gimmick visuali e più continuità narrativa.",
      "STORY: breve e diretta, con CTA semplice e comprensibile.",
    ],
  },
  LINKEDIN: {
    label: "LinkedIn",
    copy: [
      "Taglio professionale e business: insight, esperienza, analisi, processo, decisioni e implicazioni pratiche.",
      "Apri con una tesi o osservazione professionale, non con formule da engagement tipiche di Instagram.",
      "Usa paragrafi strutturati e leggibili; sviluppa il ragionamento con concretezza senza tono accademico o burocratico.",
      "Usa pochissimi hashtag, strettamente pertinenti; non usare liste di hashtag da social consumer.",
      "CTA orientate a discussione professionale, confronto, approfondimento o contatto business.",
      "Evita slang, urgenza artificiale, emoji decorative e formule tipo 'salva questo post' salvo reale coerenza con il contenuto.",
    ],
    visual: [
      "Estetica editoriale e professionale: pulita, credibile, strutturata, con meno elementi decorativi rispetto a Instagram.",
      "Rendi visibile l'insight o il concetto business, non semplicemente il settore.",
      "Evita visual consumer, meme-like o eccessivamente promozionali se non richiesti dal brand.",
    ],
    format: [
      "POST: struttura professionale con apertura forte, sviluppo ragionato e chiusura utile.",
      "CAROUSEL: documento educativo/business con una tesi per slide e progressione logica.",
      "STORY: se il formato non è realmente coerente con il canale o con il supporto API, segnala non idoneità invece di fingere equivalenza con Instagram.",
    ],
  },
  GBP: {
    label: "Google Business Profile",
    copy: [
      "Contenuto concreto e direttamente collegato all'attività: servizio, novità, evento, aggiornamento, offerta informativa o utilità locale verificabile.",
      "Sii breve e orientato all'azione: cosa offre o comunica l'attività, perché è utile e quale prossimo passo può fare l'utente.",
      "Evita post generici di thought leadership, frasi motivazionali, engagement bait e riempitivi social.",
      "Quando pertinente usa contesto locale reale e verificato, senza inventare quartieri, sedi, distanze o disponibilità.",
      "CTA orientate a chiamare, visitare il sito, richiedere informazioni, prenotare o raggiungere l'attività solo se l'azione è realmente disponibile.",
      "Se il concept non ha utilità aziendale o locale coerente con Google Business Profile, imposta eligible=false.",
    ],
    visual: [
      "Visual concreto, credibile e immediatamente collegato al servizio/novità/attività; niente lifestyle generico scollegato dal contenuto.",
      "Priorità a chiarezza e fiducia rispetto a effetti creativi; evita grafiche affollate o troppo editoriali.",
      "Non inventare sede, facciata, mappa, recensioni, badge, prezzi, disponibilità o elementi locali non verificati.",
    ],
    format: [
      "POST: breve, concreto, orientato a utilità locale/aziendale e conversione.",
      "CAROUSEL o STORY: se il formato non è supportato dalla pubblicazione reale del canale, non trattarlo come disponibile solo perché esiste internamente; eligibility deve riflettere il supporto reale.",
    ],
  },
};

export function socialPlatformStrategy(provider: SocialPlatform) {
  return STRATEGIES[provider];
}

export function selectedPlatformStrategies(providers: SocialPlatform[]) {
  return providers.map((provider) => ({ provider, ...STRATEGIES[provider] }));
}

export function platformCopyStrategyPrompt(provider: SocialPlatform) {
  const strategy = STRATEGIES[provider];
  return [
    `STRATEGIA COPY ${strategy.label}:`,
    ...strategy.copy.map((rule) => `- ${rule}`),
    ...strategy.format.map((rule) => `- ${rule}`),
  ].join("\n");
}

export function platformVisualStrategyPrompt(provider: SocialPlatform) {
  const strategy = STRATEGIES[provider];
  return [
    `STRATEGIA VISUAL ${strategy.label}:`,
    ...strategy.visual.map((rule) => `- ${rule}`),
    ...strategy.format.map((rule) => `- ${rule}`),
  ].join("\n");
}

export function platformStrategyPrompt(provider: SocialPlatform) {
  return [platformCopyStrategyPrompt(provider), platformVisualStrategyPrompt(provider)].join("\n");
}


function copyTokens(value: string) {
  return new Set(
    value.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3)
  );
}

export function crossPlatformCopySimilarity(a: string, b: string) {
  const left = copyTokens(a);
  const right = copyTokens(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

export function platformDiversityIssues(
  variants: Array<{ provider: SocialPlatform; format: string; hook: string; caption: string; cta?: string | null }>,
) {
  const issues: string[] = [];
  for (let i = 0; i < variants.length; i += 1) {
    for (let j = i + 1; j < variants.length; j += 1) {
      const a = variants[i];
      const b = variants[j];
      if (a.provider === b.provider || a.format !== b.format) continue;
      const hookSimilarity = crossPlatformCopySimilarity(a.hook, b.hook);
      const bodySimilarity = crossPlatformCopySimilarity(a.caption, b.caption);
      const combinedSimilarity = crossPlatformCopySimilarity(
        `${a.hook}\n${a.caption}`,
        `${b.hook}\n${b.caption}`,
      );
      if (combinedSimilarity >= 0.82 || (hookSimilarity >= 0.9 && bodySimilarity >= 0.74)) {
        issues.push(`CROSS_PLATFORM_TOO_SIMILAR:${a.provider}:${b.provider}:${combinedSimilarity.toFixed(2)}`);
      }
    }
  }
  return [...new Set(issues)];
}
