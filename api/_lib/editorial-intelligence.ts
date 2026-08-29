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

function normalizedTerms(value: string) {
  return new Set(value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter((term) => term.length >= 4));
}

function overlapScore(a: string, b: string) {
  const left = normalizedTerms(a);
  const right = normalizedTerms(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const term of left) if (right.has(term)) intersection += 1;
  return intersection / Math.min(left.size, right.size);
}

function recentTopicMatchesPillar(pillar: EditorialPillar, topic: string) {
  const nameScore = overlapScore(pillar.name, topic);
  if (nameScore >= 0.5) return true;
  if (!pillar.description) return false;
  const combinedScore = overlapScore(`${pillar.name} ${pillar.description}`, topic);
  return combinedScore >= 0.35;
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

export function selectAutopilotPillar(visualIdentity: unknown, recentTopics: string[], rotationIndex = 0) {
  const pillars = contentPillarsFromVisualIdentity(visualIdentity);
  if (!pillars.length) return { pillar: null as EditorialPillar | null, pillarCount: 0, recentUsage: 0 };

  const scored = pillars.map((pillar) => {
    const recentUsage = recentTopics.reduce((count, topic) => count + (recentTopicMatchesPillar(pillar, topic) ? 1 : 0), 0);
    return { pillar, recentUsage };
  });
  const minimumUsage = Math.min(...scored.map((item) => item.recentUsage));
  const leastUsed = scored.filter((item) => item.recentUsage === minimumUsage);
  const normalizedIndex = Math.abs(Math.trunc(rotationIndex)) % leastUsed.length;
  const selected = leastUsed[normalizedIndex];
  return { pillar: selected.pillar, pillarCount: pillars.length, recentUsage: selected.recentUsage };
}

export function buildAutopilotPillarInstruction(visualIdentity: unknown, recentTopics: string[], rotationIndex = 0) {
  const selected = selectAutopilotPillar(visualIdentity, recentTopics, rotationIndex);
  if (!selected.pillar) return { instruction: "", pillar: null as EditorialPillar | null, pillarCount: 0, recentUsage: 0 };
  const sources = selected.pillar.sourceUrls.length ? ` Fonti del pilastro: ${selected.pillar.sourceUrls.join(", ")}.` : "";
  return {
    instruction: `Pilastro editoriale prioritario: ${selected.pillar.name}.${selected.pillar.description ? ` ${selected.pillar.description}.` : ""}${sources} Scegli un sotto-tema specifico e un angolo nuovo all'interno di questo pilastro, usando solo fatti confermati dalle fonti disponibili.`,
    pillar: selected.pillar,
    pillarCount: selected.pillarCount,
    recentUsage: selected.recentUsage,
  };
}
