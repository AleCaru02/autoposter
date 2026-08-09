import { describe, expect, it } from 'vitest';
import { OnboardingStateMachine } from '../src/onboarding-state.js';

describe('OnboardingStateMachine', () => {
  it('requires confirmed business facts before advancing', () => {
    const machine = new OnboardingStateMachine('tenant-a');
    machine.setField({ key: 'brandName', value: 'Demo Brand', status: 'inferred', source: 'website_scan', now: '2026-08-09T10:00:00.000Z' });
    machine.setField({ key: 'industry', value: 'servizi', status: 'confirmed', source: 'user', now: '2026-08-09T10:00:00.000Z' });

    expect(machine.canAdvance()).toEqual({ allowed: false, missing: ['brandName'] });
    expect(() => machine.advance('2026-08-09T10:01:00.000Z')).toThrow('onboarding_missing_required:brandName');

    machine.confirmField('brandName', '2026-08-09T10:02:00.000Z');
    const next = machine.advance('2026-08-09T10:03:00.000Z');
    expect(next.currentStep).toBe('website');
    expect(next.completedSteps).toEqual(['business']);
  });

  it('prevents changes to locked confirmed facts until explicitly unlocked', () => {
    const machine = new OnboardingStateMachine('tenant-a');
    machine.setField({ key: 'brandName', value: 'Brand A', status: 'confirmed', source: 'user', now: '2026-08-09T11:00:00.000Z' });
    machine.lockField('brandName', '2026-08-09T11:01:00.000Z');

    expect(() => machine.setField({ key: 'brandName', value: 'Brand Changed', status: 'confirmed', source: 'ai_inferred', now: '2026-08-09T11:02:00.000Z' })).toThrow('onboarding_field_locked');
    machine.unlockField('brandName', '2026-08-09T11:03:00.000Z');
    machine.setField({ key: 'brandName', value: 'Brand Changed', status: 'confirmed', source: 'user', now: '2026-08-09T11:04:00.000Z' });
    expect(machine.snapshot().fields.brandName?.value).toBe('Brand Changed');
  });

  it('validates scan coverage consistency and cannot jump over unfinished steps', () => {
    const machine = new OnboardingStateMachine('tenant-a');
    expect(() => machine.setCoverage({ discovered: 10, analyzed: 11, relevant: 8, skipped: 0, pageLimit: 50 })).toThrow('onboarding_inconsistent_coverage');

    const coverage = machine.setCoverage({ discovered: 20, analyzed: 18, relevant: 15, skipped: 2, pageLimit: 50 });
    expect(coverage.relevant).toBe(15);
    expect(() => machine.goTo('voice')).toThrow('onboarding_cannot_skip_uncompleted_steps');
  });

  it('requires confirmation before a field can be locked', () => {
    const machine = new OnboardingStateMachine('tenant-a');
    machine.setField({ key: 'primaryAudience', value: 'PMI', status: 'inferred', source: 'ai_inferred', now: '2026-08-09T12:00:00.000Z' });
    expect(() => machine.lockField('primaryAudience', '2026-08-09T12:01:00.000Z')).toThrow('onboarding_confirm_before_lock');
  });
});
