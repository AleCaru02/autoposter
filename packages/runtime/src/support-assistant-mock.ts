export interface KnowledgeArticle {
  id: string;
  title: string;
  content: string;
  category: string;
  isPublic: boolean;
}

export interface TenantSupportFact {
  key: string;
  value: string;
}

export interface TenantSupportResolver {
  resolve(input: { tenantId: string; question: string }): Promise<TenantSupportFact[]>;
}

export interface SupportAnswer {
  answer: string;
  sourceArticleIds: string[];
  tenantFactKeys: string[];
  scope: 'public' | 'tenant';
}

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2);

const scoreArticle = (article: KnowledgeArticle, questionTokens: Set<string>): number => {
  const articleTokens = new Set(tokenize(`${article.title} ${article.category} ${article.content}`));
  let score = 0;
  for (const token of questionTokens) if (articleTokens.has(token)) score += 1;
  return score;
};

const relevantArticles = (articles: KnowledgeArticle[], question: string, publicOnly: boolean): KnowledgeArticle[] => {
  const tokens = new Set(tokenize(question));
  return articles
    .filter((article) => !publicOnly || article.isPublic)
    .map((article) => ({ article, score: scoreArticle(article, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.article.id.localeCompare(right.article.id))
    .slice(0, 3)
    .map((entry) => entry.article);
};

export class SupportAssistantMock {
  constructor(
    private readonly articles: KnowledgeArticle[],
    private readonly tenantResolver?: TenantSupportResolver,
  ) {}

  async answerPublic(question: string): Promise<SupportAnswer> {
    const matches = relevantArticles(this.articles, question, true);
    const content = matches.length > 0
      ? matches.map((article) => article.content).join(' ')
      : 'Non ho trovato una risposta specifica nella knowledge base pubblica.';

    return {
      answer: content,
      sourceArticleIds: matches.map((article) => article.id),
      tenantFactKeys: [],
      scope: 'public',
    };
  }

  async answerTenant(input: { tenantId: string; question: string }): Promise<SupportAnswer> {
    if (!input.tenantId.trim()) throw new Error('support_tenant_required');
    const matches = relevantArticles(this.articles, input.question, false);
    const facts = this.tenantResolver
      ? await this.tenantResolver.resolve({ tenantId: input.tenantId, question: input.question })
      : [];

    const knowledge = matches.map((article) => article.content).join(' ');
    const tenantContext = facts.map((fact) => `${fact.key}: ${fact.value}`).join(' ');
    const answer = [knowledge, tenantContext].filter(Boolean).join(' ') || 'Nessuna informazione disponibile per questa richiesta.';

    return {
      answer,
      sourceArticleIds: matches.map((article) => article.id),
      tenantFactKeys: facts.map((fact) => fact.key),
      scope: 'tenant',
    };
  }
}

export class InMemoryTenantSupportResolver implements TenantSupportResolver {
  constructor(private readonly factsByTenant: Record<string, TenantSupportFact[]>) {}

  async resolve(input: { tenantId: string; question: string }): Promise<TenantSupportFact[]> {
    const questionTokens = new Set(tokenize(input.question));
    return (this.factsByTenant[input.tenantId] ?? []).filter((fact) => {
      const factTokens = tokenize(`${fact.key} ${fact.value}`);
      return factTokens.some((token) => questionTokens.has(token));
    });
  }
}
