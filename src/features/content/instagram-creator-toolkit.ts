import type { GeneratedVariant, SocialFormat } from "../../../api/_lib/openai-text";

/**
 * Lightweight Instagram creator workflow inspired by the reusable, template-first
 * ideas in instagram-skill (MIT) and ii-content-engine (MIT). No third-party
 * runtime, cookies, browser automation or external publishing endpoint is used.
 */
export type InstagramRecipeId = "guide" | "comparison" | "faq" | "behind_scenes" | "question";

export type InstagramRecipe = {
  id: InstagramRecipeId;
  label: string;
  description: string;
  format: SocialFormat;
  objective: string;
};

export const INSTAGRAM_RECIPES: readonly InstagramRecipe[] = [
  {
    id: "guide",
    label: "Guida pratica",
    description: "Un carosello educativo con passaggi concreti e CTA finale.",
    format: "CAROUSEL",
    objective: "Crea un carosello di 5 slide: problema reale, tre indicazioni pratiche, conclusione con una sola CTA. Ogni slide deve avere un titolo chiaro.",
  },
  {
    id: "comparison",
    label: "Confronto",
    description: "Spiega differenze documentate senza inventare dati.",
    format: "CAROUSEL",
    objective: "Crea un carosello di 5 slide che confronti due opzioni pertinenti al tema. Indica solo differenze documentabili e concludi con un criterio di scelta.",
  },
  {
    id: "faq",
    label: "Domande frequenti",
    description: "Rispondi alle obiezioni più utili per i potenziali clienti.",
    format: "CAROUSEL",
    objective: "Crea 5 slide: una domanda iniziale, tre domande concrete con risposte basate sulle fonti, una CTA per chiedere informazioni. Non inventare FAQ dei clienti.",
  },
  {
    id: "behind_scenes",
    label: "Dietro le quinte",
    description: "Racconta un processo verificato del brand in un post.",
    format: "POST",
    objective: "Mostra come funziona un processo realmente documentato dell'attività. Se non ci sono informazioni confermate, spiega il metodo generale senza attribuirlo al brand.",
  },
  {
    id: "question",
    label: "Storia interattiva",
    description: "Una domanda breve per stimolare interesse e conversazioni.",
    format: "STORY",
    objective: "Crea una storia breve con una sola domanda pertinente, parole leggibili a schermo e una CTA non ingannevole. Non promettere sticker o funzioni non disponibili tramite API.",
  },
];

export function applyInstagramRecipe(id: InstagramRecipeId, profileName: string, currentTopic = "") {
  const recipe = INSTAGRAM_RECIPES.find((item) => item.id === id);
  if (!recipe) throw new Error("INSTAGRAM_RECIPE_UNKNOWN");
  const name = profileName.trim() || "questa attività";
  return {
    providers: ["INSTAGRAM"] as const,
    format: recipe.format,
    topic: currentTopic.trim() || "Cosa sapere prima di scegliere i servizi di " + name,
    objective: recipe.objective + " Usa soltanto fatti verificati del brand, senza inventare risultati, testimonianze o offerte.",
  };
}

type InstagramDraft = Pick<GeneratedVariant, "provider" | "format" | "hook" | "caption" | "cta" | "hashtags" | "carouselSlides">;

export type InstagramDraftPreflight = {
  caption: string;
  captionLength: number;
  preview: string;
  warnings: string[];
  blockingIssues: string[];
};

/** Editorial/format preflight: does NOT certify image pixels, JPEG codec or API permissions. */
export function instagramDraftPreflight(variant: InstagramDraft): InstagramDraftPreflight {
  if (variant.provider !== "INSTAGRAM") {
    return { caption: "", captionLength: 0, preview: "", warnings: [], blockingIssues: [] };
  }
  const hashtags = (Array.isArray(variant.hashtags) ? variant.hashtags : [])
    .filter((tag): tag is string => typeof tag === "string" && Boolean(tag.trim()))
    .map((tag) => "#" + tag.trim().replace(/^#+/, ""));
  const caption = [variant.hook?.trim(), variant.caption?.trim(), variant.cta?.trim(), hashtags.join(" ")]
    .filter(Boolean).join("\n\n");
  const captionLength = Array.from(caption).length;
  const warnings: string[] = [];
  const blockingIssues: string[] = [];
  if (!variant.caption?.trim()) blockingIssues.push("Manca il testo del post.");
  if (captionLength > 2200) blockingIssues.push("Il testo complessivo supera i 2.200 caratteri previsti da Instagram.");
  if (hashtags.length > 5) warnings.push("Per leggibilità, valuta di usare al massimo 5 hashtag pertinenti.");
  if (new Set(hashtags.map((tag) => tag.toLocaleLowerCase())).size !== hashtags.length) warnings.push("Alcuni hashtag sono ripetuti.");
  if (!variant.hook?.trim()) warnings.push("Manca un'apertura forte: controlla le prime righe visibili nel feed.");
  if (variant.format === "CAROUSEL") {
    const slides = variant.carouselSlides ?? [];
    if (slides.length < 4 || slides.length > 10) blockingIssues.push("Il carosello richiede da 4 a 10 slide nel flusso attuale.");
    if (slides.some((slide) => !slide.headline?.trim() || !slide.altText?.trim())) blockingIssues.push("Ogni slide deve avere titolo e descrizione accessibile.");
  }
  const snippet = Array.from(caption.replace(/\s+/g, " ").trim());
  const preview = snippet.length > 125 ? snippet.slice(0, 125).join("") + "…" : snippet.join("");
  return { caption, captionLength, preview, warnings, blockingIssues };
}
