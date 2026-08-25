import { describe, expect, it } from 'vitest';
import { DeterministicAIOrchestratorMock } from '../src/ai-orchestrator-mock.js';
import { EditorialPipelineMock } from '../src/editorial-pipeline-mock.js';

const context = (correlationId: string, tenantId = 'tenant-a') => ({
  tenantId,
  brand: {
    brandName: 'Demo Studio Milano', description: 'Servizi professionali con sede locale', industry: 'servizi professionali', locations: ['Milano'], audiences: ['PMI locali'], services: ['consulenza'], products: [], differentiators: ['processo trasparente'], valuePropositions: ['piano operativo misurabile'], toneRules: ['chiaro', 'specifico'], bannedWords: ['migliore'], allowedClaims: ['Sede a Milano'], forbiddenClaims: ['risultato garantito'], ctaPreferences: ['Prenota una consulenza'], palette: ['#0F766E'], contentThemes: ['metodo', 'consulenza locale'], lockedFacts: { sede: 'Milano' }, sourceVersion: 1,
  },
  strategyVersion: 1,
  recentFingerprintIds: [],
  correlationId,
});

const destinations = {
  facebook: { connectionId: 'fb-conn', accountId: 'fb-page' },
  instagram: { connectionId: 'ig-conn', accountId: 'ig-account' },
  linkedin: { connectionId: 'li-conn', accountId: 'li-org' },
  google_business_profile: { connectionId: 'gbp-conn', accountId: 'gbp-location' },
};

describe('EditorialPipelineMock', () => {
  it('runs concept → variants → quality → manual approval → scheduling', async () => {
    const pipeline = new EditorialPipelineMock();
    const run = await pipeline.prepare({ context: context('manual-1'), platforms: ['facebook', 'instagram', 'linkedin', 'google_business_profile'], approvalMode: 'manual', scheduledAt: '2026-08-10T10:00:00.000Z', createdAt: '2026-08-09T10:00:00.000Z' });
    expect(run.approvalStatus).toBe('pending');
    expect(run.variants).toHaveLength(4);
    expect(() => pipeline.schedule({ tenantId: 'tenant-a', runId: run.id, destinations })).toThrow('editorial_not_approved');
    const approved = pipeline.approve({ tenantId: 'tenant-a', runId: run.id, actorId: 'user-a', now: '2026-08-09T10:01:00.000Z' });
    expect(approved.approvalStatus).toBe('approved');
    const jobs = pipeline.schedule({ tenantId: 'tenant-a', runId: run.id, destinations });
    expect(jobs).toHaveLength(run.variants.filter((variant) => variant.decision !== 'skip').length);
    expect(new Set(jobs.map((job) => job.idempotencyKey)).size).toBe(jobs.length);
  });

  it('replays the same tenant/correlation prepare operation without duplicating a run', async () => {
    const pipeline = new EditorialPipelineMock();
    const input = { context: context('same-correlation'), platforms: ['instagram', 'linkedin'] as const, approvalMode: 'manual' as const, scheduledAt: '2026-08-10T10:00:00.000Z', createdAt: '2026-08-09T10:00:00.000Z' };
    const first = await pipeline.prepare({ ...input, platforms: [...input.platforms] });
    const replay = await pipeline.prepare({ ...input, platforms: [...input.platforms] });
    expect(replay.id).toBe(first.id);
    expect(replay.concept).toEqual(first.concept);
  });

  it('auto-approval is immediately schedulable when quality passes', async () => {
    const pipeline = new EditorialPipelineMock();
    const run = await pipeline.prepare({ context: context('auto-1'), platforms: ['facebook'], approvalMode: 'auto', scheduledAt: '2026-08-10T10:00:00.000Z', createdAt: '2026-08-09T10:00:00.000Z' });
    expect(run.approvalStatus).toBe('approved');
    expect(pipeline.schedule({ tenantId: 'tenant-a', runId: run.id, destinations })).toHaveLength(1);
  });

  it('prevents another tenant from reading or deciding the run', async () => {
    const pipeline = new EditorialPipelineMock();
    const run = await pipeline.prepare({ context: context('tenant-bound'), platforms: ['instagram'], approvalMode: 'manual', scheduledAt: '2026-08-10T10:00:00.000Z', createdAt: '2026-08-09T10:00:00.000Z' });
    expect(() => pipeline.get({ tenantId: 'tenant-b', runId: run.id })).toThrow('editorial_tenant_mismatch');
    expect(() => pipeline.approve({ tenantId: 'tenant-b', runId: run.id, actorId: 'user-b', now: '2026-08-09T10:02:00.000Z' })).toThrow('editorial_tenant_mismatch');
  });

  it('keeps rejected content out of the scheduler', async () => {
    const pipeline = new EditorialPipelineMock();
    const run = await pipeline.prepare({ context: context('reject-1'), platforms: ['facebook'], approvalMode: 'manual', scheduledAt: '2026-08-10T10:00:00.000Z', createdAt: '2026-08-09T10:00:00.000Z' });
    const rejected = pipeline.reject({ tenantId: 'tenant-a', runId: run.id, actorId: 'user-a', reason: 'Claim da rivedere', now: '2026-08-09T10:03:00.000Z' });
    expect(rejected.approvalStatus).toBe('rejected');
    expect(() => pipeline.schedule({ tenantId: 'tenant-a', runId: run.id, destinations })).toThrow('editorial_not_approved');
  });

  it('blocks approval entirely when the quality gate is below threshold', async () => {
    const base = new DeterministicAIOrchestratorMock();
    const lowQuality = {
      generateCoreConcept: (ctx: Parameters<typeof base.generateCoreConcept>[0]) => base.generateCoreConcept(ctx),
      generatePlatformVariants: (ctx: Parameters<typeof base.generatePlatformVariants>[0], concept: Parameters<typeof base.generatePlatformVariants>[1], platforms: Parameters<typeof base.generatePlatformVariants>[2]) => base.generatePlatformVariants(ctx, concept, platforms),
      scoreAndValidate: async (ctx: Parameters<typeof base.scoreAndValidate>[0], concept: Parameters<typeof base.scoreAndValidate>[1], variants: Parameters<typeof base.scoreAndValidate>[2]) => ({ ...(await base.scoreAndValidate(ctx, concept, variants)), factConfidence: 0.2 }),
    };
    const pipeline = new EditorialPipelineMock(lowQuality);
    const run = await pipeline.prepare({ context: context('low-quality'), platforms: ['instagram'], approvalMode: 'manual', scheduledAt: '2026-08-10T10:00:00.000Z', createdAt: '2026-08-09T10:00:00.000Z' });
    expect(run.approvalStatus).toBe('blocked_quality');
    expect(run.approvalRequestId).toBeUndefined();
    expect(() => pipeline.approve({ tenantId: 'tenant-a', runId: run.id, actorId: 'user-a', now: '2026-08-09T10:04:00.000Z' })).toThrow('editorial_quality_blocked');
  });
});
