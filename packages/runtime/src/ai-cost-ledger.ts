export interface ModelPriceConfig {
  modelKey: string;
  currency: 'USD' | 'EUR';
  inputPerMillionTokens: number;
  outputPerMillionTokens: number;
  imageUnitCost?: number;
}

export interface AiUsageCostInput {
  tenantId: string;
  task: string;
  modelKey: string;
  inputTokens: number;
  outputTokens: number;
  imageUnits?: number;
  occurredAt: string;
  correlationId: string;
}

export interface AiUsageCostRecord extends AiUsageCostInput {
  id: string;
  currency: 'USD' | 'EUR';
  cost: number;
}

export interface TenantBudget {
  tenantId: string;
  monthlyLimit: number;
  currency: 'USD' | 'EUR';
}

const monthKey = (value: string): string => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('ai_cost_invalid_time');
  return date.toISOString().slice(0, 7);
};

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;

export class InMemoryAiCostLedger {
  private readonly prices = new Map<string, ModelPriceConfig>();
  private readonly budgets = new Map<string, TenantBudget>();
  private readonly records: AiUsageCostRecord[] = [];
  private readonly idempotency = new Map<string, string>();
  private sequence = 0;

  setModelPrice(config: ModelPriceConfig): void {
    const numeric = [config.inputPerMillionTokens, config.outputPerMillionTokens, config.imageUnitCost ?? 0];
    if (!config.modelKey.trim() || numeric.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('ai_cost_invalid_price');
    this.prices.set(config.modelKey, structuredClone(config));
  }

  setTenantBudget(budget: TenantBudget): void {
    if (!budget.tenantId.trim() || !Number.isFinite(budget.monthlyLimit) || budget.monthlyLimit < 0) throw new Error('ai_cost_invalid_budget');
    this.budgets.set(budget.tenantId, structuredClone(budget));
  }

  estimate(input: Omit<AiUsageCostInput, 'tenantId' | 'task' | 'occurredAt' | 'correlationId'>): { currency: 'USD' | 'EUR'; cost: number } {
    const price = this.requirePrice(input.modelKey);
    this.validateUsage(input);
    const cost = (input.inputTokens / 1_000_000) * price.inputPerMillionTokens
      + (input.outputTokens / 1_000_000) * price.outputPerMillionTokens
      + (input.imageUnits ?? 0) * (price.imageUnitCost ?? 0);
    return { currency: price.currency, cost: roundMoney(cost) };
  }

  canSpend(input: { tenantId: string; modelKey: string; inputTokens: number; outputTokens: number; imageUnits?: number; occurredAt: string }): { allowed: boolean; remaining: number; estimatedCost: number; currency: 'USD' | 'EUR' } {
    const budget = this.requireBudget(input.tenantId);
    const estimate = this.estimate({ modelKey: input.modelKey, inputTokens: input.inputTokens, outputTokens: input.outputTokens, ...(input.imageUnits !== undefined ? { imageUnits: input.imageUnits } : {}) });
    if (budget.currency !== estimate.currency) throw new Error('ai_cost_currency_mismatch');
    const spent = this.spentInMonth(input.tenantId, input.occurredAt);
    const remaining = roundMoney(Math.max(0, budget.monthlyLimit - spent));
    return { allowed: estimate.cost <= remaining, remaining, estimatedCost: estimate.cost, currency: budget.currency };
  }

  record(input: AiUsageCostInput): AiUsageCostRecord {
    if (!input.tenantId.trim() || !input.task.trim() || !input.correlationId.trim()) throw new Error('ai_cost_invalid_usage_metadata');
    monthKey(input.occurredAt);
    const replayId = this.idempotency.get(`${input.tenantId}:${input.correlationId}`);
    if (replayId) return structuredClone(this.records.find((record) => record.id === replayId)!);

    const budgetCheck = this.canSpend(input);
    if (!budgetCheck.allowed) throw new Error('ai_cost_budget_exceeded');

    this.sequence += 1;
    const record: AiUsageCostRecord = {
      ...structuredClone(input),
      id: `ai-cost-${this.sequence}`,
      currency: budgetCheck.currency,
      cost: budgetCheck.estimatedCost,
    };
    this.records.push(record);
    this.idempotency.set(`${input.tenantId}:${input.correlationId}`, record.id);
    return structuredClone(record);
  }

  spentInMonth(tenantId: string, at: string): number {
    const month = monthKey(at);
    return roundMoney(this.records
      .filter((record) => record.tenantId === tenantId && monthKey(record.occurredAt) === month)
      .reduce((sum, record) => sum + record.cost, 0));
  }

  listTenant(tenantId: string): AiUsageCostRecord[] {
    return this.records.filter((record) => record.tenantId === tenantId).map((record) => structuredClone(record));
  }

  private validateUsage(input: { inputTokens: number; outputTokens: number; imageUnits?: number }): void {
    const values = [input.inputTokens, input.outputTokens, input.imageUnits ?? 0];
    if (values.some((value) => !Number.isInteger(value) || value < 0)) throw new Error('ai_cost_invalid_usage');
  }

  private requirePrice(modelKey: string): ModelPriceConfig {
    const price = this.prices.get(modelKey);
    if (!price) throw new Error('ai_cost_model_price_missing');
    return price;
  }

  private requireBudget(tenantId: string): TenantBudget {
    const budget = this.budgets.get(tenantId);
    if (!budget) throw new Error('ai_cost_budget_missing');
    return budget;
  }
}
