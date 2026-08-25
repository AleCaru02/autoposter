import { describe, expect, it } from 'vitest';
import { InMemoryAiCostLedger } from '../src/ai-cost-ledger.js';

const configured = () => {
  const ledger = new InMemoryAiCostLedger();
  ledger.setModelPrice({
    modelKey: 'text-complex',
    currency: 'USD',
    inputPerMillionTokens: 2,
    outputPerMillionTokens: 8,
    imageUnitCost: 0.04,
  });
  ledger.setTenantBudget({ tenantId: 'tenant-a', monthlyLimit: 1, currency: 'USD' });
  ledger.setTenantBudget({ tenantId: 'tenant-b', monthlyLimit: 0.25, currency: 'USD' });
  return ledger;
};

describe('InMemoryAiCostLedger', () => {
  it('uses injected prices instead of hardcoded provider pricing', () => {
    const ledger = configured();
    const estimate = ledger.estimate({ modelKey: 'text-complex', inputTokens: 100_000, outputTokens: 50_000, imageUnits: 2 });
    expect(estimate).toEqual({ currency: 'USD', cost: 0.68 });
  });

  it('enforces tenant monthly budgets before recording usage', () => {
    const ledger = configured();
    const allowed = ledger.canSpend({ tenantId: 'tenant-a', modelKey: 'text-complex', inputTokens: 10_000, outputTokens: 10_000, occurredAt: '2026-08-09T10:00:00.000Z' });
    const blocked = ledger.canSpend({ tenantId: 'tenant-b', modelKey: 'text-complex', inputTokens: 100_000, outputTokens: 50_000, occurredAt: '2026-08-09T10:00:00.000Z' });
    expect(allowed.allowed).toBe(true);
    expect(blocked.allowed).toBe(false);
    expect(() => ledger.record({ tenantId: 'tenant-b', task: 'generate', modelKey: 'text-complex', inputTokens: 100_000, outputTokens: 50_000, occurredAt: '2026-08-09T10:00:00.000Z', correlationId: 'b-1' })).toThrow('ai_cost_budget_exceeded');
  });

  it('records correlation IDs idempotently without double charging', () => {
    const ledger = configured();
    const input = { tenantId: 'tenant-a', task: 'caption', modelKey: 'text-complex', inputTokens: 10_000, outputTokens: 10_000, occurredAt: '2026-08-09T10:00:00.000Z', correlationId: 'same-operation' };
    const first = ledger.record(input);
    const replay = ledger.record(input);
    expect(replay.id).toBe(first.id);
    expect(ledger.listTenant('tenant-a')).toHaveLength(1);
    expect(ledger.spentInMonth('tenant-a', '2026-08-31T23:00:00.000Z')).toBe(first.cost);
  });

  it('keeps costs isolated between tenants and months', () => {
    const ledger = configured();
    ledger.record({ tenantId: 'tenant-a', task: 'caption', modelKey: 'text-complex', inputTokens: 10_000, outputTokens: 5_000, occurredAt: '2026-08-09T10:00:00.000Z', correlationId: 'a-aug' });
    ledger.record({ tenantId: 'tenant-a', task: 'caption', modelKey: 'text-complex', inputTokens: 10_000, outputTokens: 5_000, occurredAt: '2026-09-01T10:00:00.000Z', correlationId: 'a-sep' });
    ledger.record({ tenantId: 'tenant-b', task: 'caption', modelKey: 'text-complex', inputTokens: 5_000, outputTokens: 2_000, occurredAt: '2026-08-09T10:00:00.000Z', correlationId: 'b-aug' });

    expect(ledger.listTenant('tenant-a')).toHaveLength(2);
    expect(ledger.listTenant('tenant-b')).toHaveLength(1);
    expect(ledger.spentInMonth('tenant-a', '2026-08-20T10:00:00.000Z')).toBeGreaterThan(0);
    expect(ledger.spentInMonth('tenant-a', '2026-09-20T10:00:00.000Z')).toBeGreaterThan(0);
  });

  it('rejects missing model prices, invalid usage and currency mismatches', () => {
    const ledger = configured();
    expect(() => ledger.estimate({ modelKey: 'missing', inputTokens: 1, outputTokens: 1 })).toThrow('ai_cost_model_price_missing');
    expect(() => ledger.estimate({ modelKey: 'text-complex', inputTokens: -1, outputTokens: 1 })).toThrow('ai_cost_invalid_usage');

    ledger.setModelPrice({ modelKey: 'eur-model', currency: 'EUR', inputPerMillionTokens: 1, outputPerMillionTokens: 1 });
    expect(() => ledger.canSpend({ tenantId: 'tenant-a', modelKey: 'eur-model', inputTokens: 1, outputTokens: 1, occurredAt: '2026-08-09T10:00:00.000Z' })).toThrow('ai_cost_currency_mismatch');
  });
});
