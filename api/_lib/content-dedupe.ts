export type ContentDedupeCandidate = {
  id?: string | null;
  topic: string;
  angle?: string | null;
  hook?: string | null;
  caption?: string | null;
  cta?: string | null;
  pillar?: string | null;
  visualArchetype?: string | null;
  subjectStrategy?: string | null;
  narrativeStructure?: string | null;
};

export type ContentDuplicateMatch = {
  candidate: ContentDedupeCandidate;
  score: number;
  topicScore: number;
  bodyScore: number;
};

const ITALIAN_STOPWORDS = new Set([
  "che", "chi", "con", "come", "cosa", "dai", "dal", "dalla", "dalle", "dallo", "dei", "del", "della", "delle", "dello", "di", "e", "ed", "gli", "ha", "hai", "hanno", "il", "in", "io", "la", "le", "lo", "ma", "nel", "nella", "nelle", "nello", "non", "o", "per", "piu", "quale", "quali", "se", "sei", "si", "sono", "su", "sul", "sulla", "tra", "un", "una", "uno", "via", "al", "alla", "alle", "allo", "ai", "agli", "da", "a", "è",
]);

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stem(token: string) {
  if (token.length <= 4) return token;
  return token
    .replace(/(azioni|azione|zioni|zione)$/u, "zion")
    .replace(/(mente)$/u, "")
    .replace(/(ando|endo)$/u, "")
    .replace(/(are|ere|ire)$/u, "")
    .replace(/(ati|ate|ato|ita|iti|ito)$/u, "")
    .replace(/[aeio]$/u, "");
}

function tokens(value: string) {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized
    .split(" ")
    .filter((token) => token.length >= 3 && !ITALIAN_STOPWORDS.has(token))
    .map(stem)
    .filter((token) => token.length >= 3);
}

function setOf(value: string) {
  return new Set(tokens(value));
}

function intersectionSize(a: Set<string>, b: Set<string>) {
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection;
}

function lexicalScore(a: string, b: string) {
  const left = setOf(a);
  const right = setOf(b);
  if (!left.size || !right.size) return 0;
  const intersection = intersectionSize(left, right);
  const union = left.size + right.size - intersection;
  const jaccard = union ? intersection / union : 0;
  const containment = intersection / Math.min(left.size, right.size);
  return Math.max(jaccard, containment * 0.94);
}

function trigrams(value: string) {
  const normalized = normalizeText(value).replace(/\s+/g, " ");
  const result = new Set<string>();
  if (normalized.length < 3) return result;
  for (let index = 0; index <= normalized.length - 3; index += 1) result.add(normalized.slice(index, index + 3));
  return result;
}

function trigramDice(a: string, b: string) {
  const left = trigrams(a);
  const right = trigrams(b);
  if (!left.size || !right.size) return 0;
  const intersection = intersectionSize(left, right);
  return (2 * intersection) / (left.size + right.size);
}

function legacyInstructionTopic(value: string) {
  const normalized = normalizeText(value);
  return normalized.includes("scegli autonomamente") || normalized.includes("evita di ripetere") || normalized.includes("contenuto e destinato");
}

function topicText(candidate: ContentDedupeCandidate) {
  const topic = legacyInstructionTopic(candidate.topic) ? "" : candidate.topic;
  return [topic, candidate.angle ?? ""].filter(Boolean).join(" ");
}

function bodyText(candidate: ContentDedupeCandidate) {
  return [topicText(candidate), candidate.hook ?? "", candidate.caption ?? ""].filter(Boolean).join(" ");
}

export function semanticContentSimilarity(a: ContentDedupeCandidate, b: ContentDedupeCandidate) {
  const topicScore = lexicalScore(topicText(a), topicText(b));
  const bodyLexical = lexicalScore(bodyText(a), bodyText(b));
  const bodyPhrase = trigramDice(bodyText(a), bodyText(b));
  const bodyScore = Math.max(bodyLexical, bodyLexical * 0.72 + bodyPhrase * 0.28);
  const score = topicScore > 0
    ? Math.max(topicScore * 0.68 + bodyScore * 0.32, bodyScore)
    : bodyScore;
  return {
    score: Math.min(Math.max(score, 0), 1),
    topicScore: Math.min(Math.max(topicScore, 0), 1),
    bodyScore: Math.min(Math.max(bodyScore, 0), 1),
  };
}

export function findNearDuplicate(
  candidate: ContentDedupeCandidate,
  recent: ContentDedupeCandidate[],
): ContentDuplicateMatch | null {
  let best: ContentDuplicateMatch | null = null;
  for (const existing of recent) {
    const similarity = semanticContentSimilarity(candidate, existing);
    const topicLedDuplicate = similarity.score >= 0.55 && similarity.topicScore >= 0.55;
    const copyLedDuplicate = similarity.bodyScore >= 0.78;
    if (!topicLedDuplicate && !copyLedDuplicate) continue;
    const match = { candidate: existing, ...similarity };
    if (!best || match.score > best.score) best = match;
  }
  return best;
}


export type EditorialRepetitionMatch = {
  blocked: boolean;
  reasons: string[];
  signals: {
    maxHookSimilarity: number;
    maxAngleSimilarity: number;
    repeatedCtaCount: number;
    repeatedPillarCount: number;
    repeatedVisualArchetypeCount: number;
    repeatedSubjectCount: number;
    repeatedNarrativeStructureCount: number;
  };
};

function sameNormalized(a?: string | null, b?: string | null) {
  const left = normalizeText(a ?? "");
  const right = normalizeText(b ?? "");
  return Boolean(left && right && left === right);
}

export function findEditorialRepetition(
  candidate: ContentDedupeCandidate,
  recent: ContentDedupeCandidate[],
): EditorialRepetitionMatch {
  const window = recent.slice(0, 12);
  let maxHookSimilarity = 0;
  let maxAngleSimilarity = 0;
  for (const row of window) {
    if (candidate.hook && row.hook) maxHookSimilarity = Math.max(maxHookSimilarity, lexicalScore(candidate.hook, row.hook));
    if (candidate.angle && row.angle) maxAngleSimilarity = Math.max(maxAngleSimilarity, lexicalScore(candidate.angle, row.angle));
  }
  const repeatedCtaCount = window.filter((row) => sameNormalized(candidate.cta, row.cta)).length;
  const repeatedPillarCount = window.filter((row) => sameNormalized(candidate.pillar, row.pillar)).length;
  const repeatedVisualArchetypeCount = window.filter((row) => sameNormalized(candidate.visualArchetype, row.visualArchetype)).length;
  const repeatedSubjectCount = window.filter((row) => sameNormalized(candidate.subjectStrategy, row.subjectStrategy)).length;
  const repeatedNarrativeStructureCount = window.filter((row) => sameNormalized(candidate.narrativeStructure, row.narrativeStructure)).length;

  const reasons: string[] = [];
  if (maxHookSimilarity >= 0.82) reasons.push("HOOK_TOO_SIMILAR");
  if (maxAngleSimilarity >= 0.82) reasons.push("ANGLE_TOO_SIMILAR");
  if (candidate.cta && repeatedCtaCount >= 3) reasons.push("CTA_OVERUSED");
  if (candidate.pillar && repeatedPillarCount >= 5) reasons.push("PILLAR_OVERUSED");
  if (candidate.visualArchetype && repeatedVisualArchetypeCount >= 3) reasons.push("VISUAL_ARCHETYPE_OVERUSED");
  if (candidate.subjectStrategy && repeatedSubjectCount >= 4) reasons.push("SUBJECT_OVERUSED");
  if (candidate.narrativeStructure && repeatedNarrativeStructureCount >= 3) reasons.push("NARRATIVE_STRUCTURE_OVERUSED");

  return {
    blocked: reasons.length > 0,
    reasons,
    signals: {
      maxHookSimilarity,
      maxAngleSimilarity,
      repeatedCtaCount,
      repeatedPillarCount,
      repeatedVisualArchetypeCount,
      repeatedSubjectCount,
      repeatedNarrativeStructureCount,
    },
  };
}
