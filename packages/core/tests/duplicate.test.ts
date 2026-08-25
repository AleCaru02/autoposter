import { describe, expect, it } from 'vitest';
import { assessDuplicate, normalizeContent } from '../src/duplicate.js';

describe('anti duplicate', () => {
  it('normalizes cosmetic differences', () => {
    expect(normalizeContent('Caffè!  #Milano')).toBe(normalizeContent('CAFFE milano'));
  });

  it('blocks exact/near-clone text', () => {
    const result = assessDuplicate({
      candidateText: 'Scopri la nostra pizza artigianale a Milano!',
      referenceText: 'Scopri la nostra pizza artigianale a Milano',
    });
    expect(result.shouldRegenerate).toBe(true);
    expect(result.signals.exact).toBe(1);
  });

  it('can block a semantic paraphrase supplied by the embedding layer', () => {
    const result = assessDuplicate({
      candidateText: 'Tre errori che abbassano il rendimento del tuo affitto breve',
      referenceText: 'Come evitare gli sbagli che riducono i guadagni della casa vacanze',
      semanticSimilarity: 0.95,
      candidateTopic: 'errori gestione affitti brevi',
      referenceTopic: 'sbagli gestione casa vacanze',
    });
    expect(result.shouldRegenerate).toBe(true);
    expect(result.risk).toBeGreaterThanOrEqual(0.92);
  });

  it('does not reject merely because two posts share a broad niche', () => {
    const result = assessDuplicate({
      candidateText: 'Dietro le quinte: prepariamo il forno prima del servizio serale',
      referenceText: 'Come scegliamo i pomodori per la salsa della nostra Margherita',
      candidateTopic: 'backstage pizzeria',
      referenceTopic: 'ingredienti pizzeria',
      semanticSimilarity: 0.35,
      visualSimilarity: 0.2,
    });
    expect(result.shouldRegenerate).toBe(false);
  });
});
