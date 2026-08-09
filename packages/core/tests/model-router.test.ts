import { describe, expect, it } from 'vitest';
import { ConfigModelRouter } from '../src/model-router.js';

const router = new ConfigModelRouter([
  {
    task: 'caption',
    tier: 'medium',
    modelConfigKey: 'OPENAI_MODEL_MEDIUM',
    fallbackConfigKey: 'OPENAI_MODEL_SIMPLE',
    webSearchAllowed: false,
    imageGenerationAllowed: false,
  },
  {
    task: 'strategy',
    tier: 'complex',
    modelConfigKey: 'OPENAI_MODEL_COMPLEX',
    fallbackConfigKey: 'OPENAI_MODEL_MEDIUM',
    webSearchAllowed: true,
    imageGenerationAllowed: false,
  },
]);

describe('config model router', () => {
  it('uses configured model key rather than hardcoded model ids', () => {
    expect(router.resolve('caption', { risk: 'medium', budgetState: 'normal' }).selectedConfigKey)
      .toBe('OPENAI_MODEL_MEDIUM');
  });

  it('downgrades non-high-risk work at soft budget limit', () => {
    const result = router.resolve('caption', { risk: 'low', budgetState: 'soft_limit' });
    expect(result.selectedConfigKey).toBe('OPENAI_MODEL_SIMPLE');
    expect(result.downgradedForBudget).toBe(true);
  });

  it('does not downgrade high-risk strategy work merely for a soft limit', () => {
    expect(router.resolve('strategy', { risk: 'high', budgetState: 'soft_limit' }).selectedConfigKey)
      .toBe('OPENAI_MODEL_COMPLEX');
  });
});
