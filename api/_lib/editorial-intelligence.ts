export type EditorialPillar = {
  name: string;
  description: string;
  sourceUrls: string[];
};

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function safeUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch { return null; }
}

export function contentPillarsFromVisualIdentity(value: unknown): EditorialPillar[] {
  if (!value || typeof value !== "object") return [];
  const raw = (value as Record<string, unknown>).contentPillars;
  if (!Array.isArray(raw)) return [];
  const pillars: EditorialPillar[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, 12)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = text(record.name, 120);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const description = text(record.description, 320);
    const sourceUrls = Array.isArray(record.sourceUrls)
      ? record.sourceUrls.map(safeUrl).filter((url): url is string => Boolean(url)).slice(0, 8)
      : [];
    pillars.push({ name, description, sourceUrls });
  }
  return pillars;
}

export function enrichRequestedTopicWithPillars(topic: string, visualIdentity: unknown) {
  const pillars = contentPillarsFromVisualIdentity(visualIdentity);
  if (!pillars.length) return { topic, pillarCount: 0 };
  const context = pillars.map((pillar) => {
    const sources = pillar.sourceUrls.length ? ` Fonti: ${pillar.sourceUrls.join(", ")}.` : "";
    return `- ${pillar.name}${pillar.description ? `: ${pillar.description}` : ""}.${sources}`;
  }).join("\n");
  return {
    topic: `${topic}\n\nCONTESTO EDITORIALE CONFERMATO DAL SITO:\n${context}\nUsa questi pilastri solo come mappa editoriale e fonti di orientamento. Il tema richiesto dall'utente resta prioritario. Non copiare queste istruzioni in editorialTopic o editorialAngle.`,
    pillarCount: pillars.length,
  };
}
