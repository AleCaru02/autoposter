import { describe, expect, it } from 'vitest';
import { InMemoryKnowledgeIndex } from '../src/knowledge-retrieval.js';

const documents = [
  {
    id: 'plans',
    title: 'Piani e quote',
    content: 'Ogni piano definisce il numero di post, i canali disponibili e i limiti di utilizzo.',
    category: 'billing',
    tags: ['piani', 'quote', 'limiti'],
    visibility: 'public' as const,
    version: 2,
  },
  {
    id: 'approvals',
    title: 'Approvazione dei contenuti',
    content: 'Il cliente può usare approvazione manuale oppure auto-publish quando il piano e la configurazione lo consentono.',
    category: 'publishing',
    tags: ['approvazione', 'post'],
    visibility: 'public' as const,
    version: 1,
  },
  {
    id: 'internal-token-runbook',
    title: 'Runbook token social',
    content: 'Procedura interna per rotazione e gestione operativa dei token provider.',
    category: 'security',
    tags: ['token', 'runbook'],
    visibility: 'internal' as const,
    version: 1,
  },
];

describe('InMemoryKnowledgeIndex', () => {
  it('ranks the most relevant public document deterministically', () => {
    const index = new InMemoryKnowledgeIndex(documents);
    const result = index.searchPublic('Come funzionano piani quote e limiti?');

    expect(result.confident).toBe(true);
    expect(result.hits[0]?.document.id).toBe('plans');
    expect(result.hits[0]?.matchedTerms).toEqual(expect.arrayContaining(['piani', 'quote', 'limiti']));
  });

  it('never exposes internal documents through public search', () => {
    const index = new InMemoryKnowledgeIndex(documents);
    const publicResult = index.searchPublic('token social runbook rotazione');
    expect(publicResult.hits.some((hit) => hit.document.id === 'internal-token-runbook')).toBe(false);

    const internalResult = index.searchInternal('token social runbook rotazione');
    expect(internalResult.hits[0]?.document.id).toBe('internal-token-runbook');
  });

  it('returns low confidence instead of inventing evidence for unrelated questions', () => {
    const index = new InMemoryKnowledgeIndex(documents);
    const result = index.searchPublic('Qual è la temperatura su Marte domani?');
    expect(result.confident).toBe(false);
    expect(result.hits).toEqual([]);
  });

  it('rejects version regression and keeps newer knowledge', () => {
    const index = new InMemoryKnowledgeIndex(documents);
    expect(() => index.upsert({ ...documents[0]!, version: 1, content: 'Vecchio contenuto' })).toThrow('knowledge_version_regression');
    index.upsert({ ...documents[0]!, version: 3, content: 'I piani includono quote post e canali configurabili.' });
    expect(index.searchPublic('quote post canali').hits[0]?.document.version).toBe(3);
  });

  it('validates limits and document shape', () => {
    const index = new InMemoryKnowledgeIndex();
    expect(() => index.upsert({ id: '', title: 'X', content: 'Y', category: 'test', tags: [], visibility: 'public', version: 1 })).toThrow('knowledge_invalid_document');
    expect(() => new InMemoryKnowledgeIndex(documents).searchPublic('piani', 0)).toThrow('knowledge_invalid_limit');
  });
});
