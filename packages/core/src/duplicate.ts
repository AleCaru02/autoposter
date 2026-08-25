export interface DuplicateSignals {
  exact: number;
  normalized: number;
  semantic: number;
  topic: number;
  hook: number;
  visual: number;
  sameTenant: number;
  crossTenantTemplate: number;
}

export interface DuplicatePolicy {
  regenerateAt: number;
  semanticWeight: number;
  normalizedWeight: number;
  topicWeight: number;
  hookWeight: number;
  visualWeight: number;
}

export interface DuplicateAssessment {
  risk: number;
  shouldRegenerate: boolean;
  reason: keyof DuplicateSignals | 'combined';
  signals: DuplicateSignals;
}

const DEFAULT_POLICY: DuplicatePolicy = {
  regenerateAt: 0.84,
  semanticWeight: 0.35,
  normalizedWeight: 0.22,
  topicWeight: 0.15,
  hookWeight: 0.12,
  visualWeight: 0.08,
};

export function normalizeContent(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' <url> ')
    .replace(/[@#]/g, '')
    .replace(/[^\p{Letter}\p{Number}\s<>]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(value: string): Set<string> {
  const compact = ` ${normalizeContent(value)} `;
  const result = new Set<string>();
  for (let index = 0; index < compact.length - 1; index += 1) {
    result.add(compact.slice(index, index + 2));
  }
  return result;
}

export function diceSimilarity(left: string, right: string): number {
  const a = bigrams(left);
  const b = bigrams(right);
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const gram of a) if (b.has(gram)) intersection += 1;
  return (2 * intersection) / (a.size + b.size);
}

export function tokenJaccard(left: string, right: string): number {
  const a = new Set(normalizeContent(left).split(' ').filter(Boolean));
  const b = new Set(normalizeContent(right).split(' ').filter(Boolean));
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface CandidateFingerprintInput {
  candidateText: string;
  referenceText: string;
  candidateTopic?: string;
  referenceTopic?: string;
  candidateHook?: string;
  referenceHook?: string;
  semanticSimilarity?: number;
  visualSimilarity?: number;
  sameTenantRecentSimilarity?: number;
  crossTenantTemplateSimilarity?: number;
}

function clamp(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function assessDuplicate(
  input: CandidateFingerprintInput,
  policy: DuplicatePolicy = DEFAULT_POLICY,
): DuplicateAssessment {
  const normalizedCandidate = normalizeContent(input.candidateText);
  const normalizedReference = normalizeContent(input.referenceText);

  const signals: DuplicateSignals = {
    exact: normalizedCandidate !== '' && normalizedCandidate === normalizedReference ? 1 : 0,
    normalized: diceSimilarity(input.candidateText, input.referenceText),
    semantic: clamp(input.semanticSimilarity),
    topic: input.candidateTopic && input.referenceTopic ? tokenJaccard(input.candidateTopic, input.referenceTopic) : 0,
    hook: input.candidateHook && input.referenceHook ? diceSimilarity(input.candidateHook, input.referenceHook) : 0,
    visual: clamp(input.visualSimilarity),
    sameTenant: clamp(input.sameTenantRecentSimilarity),
    crossTenantTemplate: clamp(input.crossTenantTemplateSimilarity),
  };

  const combined = Math.min(
    1,
    signals.semantic * policy.semanticWeight
      + signals.normalized * policy.normalizedWeight
      + signals.topic * policy.topicWeight
      + signals.hook * policy.hookWeight
      + signals.visual * policy.visualWeight
      + signals.sameTenant * 0.05
      + signals.crossTenantTemplate * 0.03,
  );

  const ranked = Object.entries(signals) as Array<[keyof DuplicateSignals, number]>;
  ranked.sort((a, b) => b[1] - a[1]);
  const strongest = ranked[0] ?? ['normalized', 0];

  const hardRisk = Math.max(
    signals.exact,
    signals.semantic >= 0.92 ? signals.semantic : 0,
    signals.normalized >= 0.94 ? signals.normalized : 0,
    signals.crossTenantTemplate >= 0.95 ? signals.crossTenantTemplate : 0,
  );
  const risk = Math.max(hardRisk, combined);

  return {
    risk,
    shouldRegenerate: risk >= policy.regenerateAt,
    reason: hardRisk >= policy.regenerateAt ? strongest[0] : 'combined',
    signals,
  };
}
