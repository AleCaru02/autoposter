export type KnowledgeVisibility = 'public' | 'internal';

export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  visibility: KnowledgeVisibility;
  version: number;
}

export interface KnowledgeHit {
  document: KnowledgeDocument;
  score: number;
  matchedTerms: string[];
}

export interface KnowledgeSearchResult {
  query: string;
  hits: KnowledgeHit[];
  confident: boolean;
}

const normalize = (value: string): string => value
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const stopWords = new Set([
  'che', 'chi', 'come', 'cosa', 'con', 'del', 'della', 'delle', 'dei', 'degli', 'per', 'una', 'uno', 'gli', 'le',
  'the', 'and', 'for', 'from', 'with', 'this', 'that', 'what', 'how',
]);

const termsFor = (value: string): string[] => normalize(value)
  .split(' ')
  .filter((term) => term.length >= 3 && !stopWords.has(term));

const unique = <T>(items: T[]): T[] => [...new Set(items)];

const scoreDocument = (document: KnowledgeDocument, query: string): KnowledgeHit => {
  const normalizedQuery = normalize(query);
  const queryTerms = unique(termsFor(query));
  const title = normalize(document.title);
  const content = normalize(document.content);
  const category = normalize(document.category);
  const tags = document.tags.map(normalize);
  const matchedTerms: string[] = [];
  let score = 0;

  if (normalizedQuery && title.includes(normalizedQuery)) score += 10;
  if (normalizedQuery && content.includes(normalizedQuery)) score += 6;

  for (const term of queryTerms) {
    let matched = false;
    if (title.split(' ').includes(term)) { score += 5; matched = true; }
    if (category.split(' ').includes(term)) { score += 3; matched = true; }
    if (tags.some((tag) => tag.split(' ').includes(term))) { score += 3; matched = true; }
    const occurrences = content.split(' ').filter((token) => token === term).length;
    if (occurrences > 0) { score += Math.min(4, occurrences); matched = true; }
    if (matched) matchedTerms.push(term);
  }

  const coverage = queryTerms.length === 0 ? 0 : matchedTerms.length / queryTerms.length;
  score += coverage * 4;

  return { document, score: Number(score.toFixed(3)), matchedTerms: unique(matchedTerms) };
};

export class InMemoryKnowledgeIndex {
  private readonly documents = new Map<string, KnowledgeDocument>();

  constructor(documents: KnowledgeDocument[] = []) {
    for (const document of documents) this.upsert(document);
  }

  upsert(document: KnowledgeDocument): void {
    if (!document.id.trim() || !document.title.trim() || !document.content.trim()) throw new Error('knowledge_invalid_document');
    if (!Number.isInteger(document.version) || document.version < 1) throw new Error('knowledge_invalid_version');
    const current = this.documents.get(document.id);
    if (current && document.version < current.version) throw new Error('knowledge_version_regression');
    this.documents.set(document.id, structuredClone({ ...document, tags: unique(document.tags.map((tag) => tag.trim()).filter(Boolean)) }));
  }

  searchPublic(query: string, limit = 3): KnowledgeSearchResult {
    return this.search(query, 'public', limit);
  }

  searchInternal(query: string, limit = 3): KnowledgeSearchResult {
    return this.search(query, 'internal', limit);
  }

  private search(query: string, scope: 'public' | 'internal', limit: number): KnowledgeSearchResult {
    if (!query.trim()) return { query, hits: [], confident: false };
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('knowledge_invalid_limit');

    const candidates: KnowledgeHit[] = [...this.documents.values()]
      .filter((document) => scope === 'internal' || document.visibility === 'public')
      .map((document) => scoreDocument(document, query))
      .filter((hit) => hit.score > 0)
      .sort((left, right) => right.score - left.score || right.document.version - left.document.version || left.document.id.localeCompare(right.document.id))
      .slice(0, limit)
      .map((hit) => structuredClone(hit));

    const top = candidates[0];
    return {
      query,
      hits: candidates,
      confident: Boolean(top && top.score >= 6 && top.matchedTerms.length >= 1),
    };
  }
}
