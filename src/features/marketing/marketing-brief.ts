export const marketingChannels = ["META_ADS", "EMAIL", "SEO", "GEO"] as const;
export type MarketingChannel = typeof marketingChannels[number];
export const marketingLabels: Record<MarketingChannel,string> = { META_ADS: "Meta Ads", EMAIL: "Email marketing", SEO: "SEO", GEO: "GEO" };
export type MarketingBriefInput = { channel: MarketingChannel; brand: string; industry?: string | null; website?: string | null; objective: string; audience: string; offer: string; evidence: string; budgetEur?: string };
const clean = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").slice(0, 1600);
export function buildMarketingBrief(input: MarketingBriefInput): string {
  if (!marketingChannels.includes(input.channel)) throw new Error("Canale non supportato.");
  const brand = clean(input.brand), objective = clean(input.objective), audience = clean(input.audience), offer = clean(input.offer);
  if (!brand || !objective || !audience || !offer) throw new Error("Compila obiettivo, pubblico e offerta.");
  const budget = clean(input.budgetEur);
  if (input.channel === "META_ADS" && (!/^\d+(?:[.,]\d{1,2})?$/.test(budget) || !Number.isFinite(Number(budget.replace(",", "."))) || Number(budget.replace(",", ".")) <= 0)) throw new Error("Inserisci un budget di test positivo in euro.");
  const evidence = clean(input.evidence);
  const sections: Record<MarketingChannel,string[]> = {
    META_ADS: ["Proporre 3 angoli creativi distinti, headline, testo principale, CTA e brief visuale per 1:1 e 9:16.", "Definire obiettivo, evento di conversione, posizionamenti, tracciamento UTM e piano A/B a parità di budget.", "Budget totale proposto: EUR " + budget + ". Nessun importo è autorizzato alla spesa.", "Misurare CPA, CTR e conversioni solo con dati reali; non promettere risultati."],
    EMAIL: ["Proporre oggetto, preheader, corpo e una CTA; creare una variante A/B.", "Inviare solo a destinatari con base giuridica verificata, esclusione disiscritti e link di disiscrizione.", "Misurare consegne, click, conversioni e disiscrizioni. Nessun invio automatico."],
    SEO: ["Proporre intento di ricerca, keyword da verificare, title, meta description, H1, outline e link interni pertinenti.", "Verificare fonti, cannibalizzazione e dati Search Console prima della pubblicazione.", "Misurare impression, click e conversioni. Non garantire posizioni."],
    GEO: ["Proporre risposte a domande concrete, entità, fonti primarie, FAQ pertinenti e contenuti verificabili.", "Controllare dati strutturati e citabilità senza inventare fonti, citazioni o recensioni.", "Misurare menzioni e citazioni osservate su query definite. Non garantire visibilità nelle AI."],
  };
  return [marketingLabels[input.channel] + " — brief di lavoro", "Attività: " + brand, "Settore: " + (clean(input.industry)||"Da confermare"), "Sito: " + (clean(input.website)||"Non configurato"), "Obiettivo: " + objective, "Pubblico: " + audience, "Offerta: " + offer, "Prove fornite: " + (evidence || "Nessuna: verificare ogni affermazione prima di usarla."), "", "Attività da svolgere:", ...sections[input.channel].map(s=>"- "+s), "", "Stato: brief manuale da revisionare. Nessuna campagna, invio, pubblicazione, scansione o chiamata AI è stata eseguita."].join("\n");
}
