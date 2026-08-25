import { describe, expect, it } from 'vitest';
import { InMemoryApprovalWorkflow } from '../src/approval-workflow.js';

describe('InMemoryApprovalWorkflow', () => {
  it('keeps manual approvals tenant-scoped and requires a rejection reason', () => {
    const workflow = new InMemoryApprovalWorkflow();
    const request = workflow.create({ tenantId: 'tenant-a', postId: 'post-1', mode: 'manual', requestedAt: '2026-08-09T12:00:00.000Z' });

    expect(request.status).toBe('pending');
    expect(() => workflow.get({ tenantId: 'tenant-b', requestId: request.id })).toThrow('approval_tenant_mismatch');
    expect(() => workflow.decide({ tenantId: 'tenant-a', requestId: request.id, actorId: 'user-a', decision: 'reject', now: '2026-08-09T12:01:00.000Z' })).toThrow('approval_rejection_reason_required');

    const rejected = workflow.decide({
      tenantId: 'tenant-a',
      requestId: request.id,
      actorId: 'user-a',
      decision: 'reject',
      reason: 'Claim da verificare',
      now: '2026-08-09T12:02:00.000Z',
    });
    expect(rejected.request.status).toBe('rejected');
    expect(rejected.idempotentReplay).toBe(false);

    const replay = workflow.decide({
      tenantId: 'tenant-a',
      requestId: request.id,
      actorId: 'user-a',
      decision: 'reject',
      reason: 'Claim da verificare',
      now: '2026-08-09T12:03:00.000Z',
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(() => workflow.decide({ tenantId: 'tenant-a', requestId: request.id, actorId: 'user-a', decision: 'approve', now: '2026-08-09T12:04:00.000Z' })).toThrow('approval_already_decided');
  });

  it('applies configured auto approval immediately and prevents later manual overwrite', () => {
    const workflow = new InMemoryApprovalWorkflow();
    const request = workflow.create({ tenantId: 'tenant-a', postId: 'post-auto', mode: 'auto', requestedAt: '2026-08-09T13:00:00.000Z' });

    expect(request.status).toBe('approved');
    expect(request.actorId).toBe('system:auto-approval');
    expect(() => workflow.decide({ tenantId: 'tenant-a', requestId: request.id, actorId: 'user-a', decision: 'reject', reason: 'No', now: '2026-08-09T13:01:00.000Z' })).toThrow('approval_already_decided');
  });

  it('lists only approval requests belonging to the requested tenant', () => {
    const workflow = new InMemoryApprovalWorkflow();
    workflow.create({ tenantId: 'tenant-a', postId: 'a1', mode: 'manual', requestedAt: '2026-08-09T14:00:00.000Z' });
    workflow.create({ tenantId: 'tenant-b', postId: 'b1', mode: 'manual', requestedAt: '2026-08-09T14:00:00.000Z' });
    workflow.create({ tenantId: 'tenant-a', postId: 'a2', mode: 'auto', requestedAt: '2026-08-09T14:01:00.000Z' });

    expect(workflow.listForTenant('tenant-a').map((item) => item.postId)).toEqual(['a1', 'a2']);
    expect(workflow.listForTenant('tenant-b').map((item) => item.postId)).toEqual(['b1']);
  });
});
