export const onboardingSteps = [
  'business',
  'website',
  'brand_review',
  'audience',
  'voice',
  'visual',
  'assets',
  'connections',
  'approval',
  'summary',
] as const;

export type OnboardingStep = (typeof onboardingSteps)[number];
export type FieldStatus = 'inferred' | 'confirmed';
export type FieldSource = 'user' | 'website_scan' | 'ai_inferred' | 'upload' | 'integration';

export interface OnboardingField<T = unknown> {
  value: T;
  status: FieldStatus;
  source: FieldSource;
  locked: boolean;
  updatedAt: string;
}

export interface OnboardingCoverage {
  discovered: number;
  analyzed: number;
  relevant: number;
  skipped: number;
  pageLimit: number;
}

export interface OnboardingState {
  tenantId: string;
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  fields: Record<string, OnboardingField>;
  coverage?: OnboardingCoverage;
  completedAt?: string;
}

const requiredFields: Partial<Record<OnboardingStep, string[]>> = {
  business: ['brandName', 'industry'],
  website: ['websiteUrl'],
  brand_review: ['brandName', 'industry'],
  audience: ['primaryAudience'],
  voice: ['toneOfVoice'],
  visual: ['visualStyle'],
  approval: ['approvalMode'],
};

const isPresent = (value: unknown): boolean => {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined;
};

export class OnboardingStateMachine {
  private state: OnboardingState;

  constructor(tenantId: string, initial?: Partial<OnboardingState>) {
    if (!tenantId.trim()) throw new Error('onboarding_tenant_required');
    this.state = {
      tenantId,
      currentStep: initial?.currentStep ?? 'business',
      completedSteps: [...(initial?.completedSteps ?? [])],
      fields: { ...(initial?.fields ?? {}) },
    };
    if (initial?.coverage) this.state.coverage = { ...initial.coverage };
    if (initial?.completedAt) this.state.completedAt = initial.completedAt;
  }

  snapshot(): OnboardingState {
    return {
      ...this.state,
      completedSteps: [...this.state.completedSteps],
      fields: Object.fromEntries(Object.entries(this.state.fields).map(([key, field]) => [key, { ...field }])),
      ...(this.state.coverage ? { coverage: { ...this.state.coverage } } : {}),
    };
  }

  setField<T>(input: {
    key: string;
    value: T;
    status: FieldStatus;
    source: FieldSource;
    now: string;
  }): OnboardingField<T> {
    if (!input.key.trim()) throw new Error('onboarding_field_key_required');
    if (!Number.isFinite(Date.parse(input.now))) throw new Error('onboarding_invalid_time');
    const existing = this.state.fields[input.key];
    if (existing?.locked) throw new Error('onboarding_field_locked');

    const next: OnboardingField<T> = {
      value: input.value,
      status: input.status,
      source: input.source,
      locked: false,
      updatedAt: input.now,
    };
    this.state.fields[input.key] = next;
    return { ...next };
  }

  confirmField(key: string, now: string): OnboardingField {
    const field = this.requireField(key);
    if (!Number.isFinite(Date.parse(now))) throw new Error('onboarding_invalid_time');
    field.status = 'confirmed';
    field.updatedAt = now;
    return { ...field };
  }

  lockField(key: string, now: string): OnboardingField {
    const field = this.requireField(key);
    if (field.status !== 'confirmed') throw new Error('onboarding_confirm_before_lock');
    if (!Number.isFinite(Date.parse(now))) throw new Error('onboarding_invalid_time');
    field.locked = true;
    field.updatedAt = now;
    return { ...field };
  }

  unlockField(key: string, now: string): OnboardingField {
    const field = this.requireField(key);
    if (!Number.isFinite(Date.parse(now))) throw new Error('onboarding_invalid_time');
    field.locked = false;
    field.updatedAt = now;
    return { ...field };
  }

  setCoverage(coverage: OnboardingCoverage): OnboardingCoverage {
    const values = [coverage.discovered, coverage.analyzed, coverage.relevant, coverage.skipped, coverage.pageLimit];
    if (values.some((value) => !Number.isInteger(value) || value < 0) || coverage.pageLimit < 1) {
      throw new Error('onboarding_invalid_coverage');
    }
    if (coverage.analyzed > coverage.discovered || coverage.relevant > coverage.analyzed) {
      throw new Error('onboarding_inconsistent_coverage');
    }
    this.state.coverage = { ...coverage };
    return { ...coverage };
  }

  canAdvance(step: OnboardingStep = this.state.currentStep): { allowed: boolean; missing: string[] } {
    const missing = (requiredFields[step] ?? []).filter((key) => {
      const field = this.state.fields[key];
      return !field || !isPresent(field.value) || field.status !== 'confirmed';
    });
    return { allowed: missing.length === 0, missing };
  }

  advance(now: string): OnboardingState {
    if (!Number.isFinite(Date.parse(now))) throw new Error('onboarding_invalid_time');
    const gate = this.canAdvance();
    if (!gate.allowed) throw new Error(`onboarding_missing_required:${gate.missing.join(',')}`);

    if (!this.state.completedSteps.includes(this.state.currentStep)) {
      this.state.completedSteps.push(this.state.currentStep);
    }

    const index = onboardingSteps.indexOf(this.state.currentStep);
    if (index === onboardingSteps.length - 1) {
      this.state.completedAt = now;
      return this.snapshot();
    }

    this.state.currentStep = onboardingSteps[index + 1]!;
    return this.snapshot();
  }

  goTo(step: OnboardingStep): OnboardingState {
    const targetIndex = onboardingSteps.indexOf(step);
    const currentIndex = onboardingSteps.indexOf(this.state.currentStep);
    const furthestCompletedIndex = Math.max(-1, ...this.state.completedSteps.map((item) => onboardingSteps.indexOf(item)));
    if (targetIndex > Math.max(currentIndex, furthestCompletedIndex + 1)) throw new Error('onboarding_cannot_skip_uncompleted_steps');
    this.state.currentStep = step;
    return this.snapshot();
  }

  private requireField(key: string): OnboardingField {
    const field = this.state.fields[key];
    if (!field) throw new Error('onboarding_field_not_found');
    return field;
  }
}
