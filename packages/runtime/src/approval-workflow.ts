export type ApprovalMode = 'auto' | 'manual';
export type ApprovalDecision = 'approve' | 'reject';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ApprovalRequestState {
  id: string;
  tenantId: string;
  postId: string;
  mode: ApprovalMode;
  status: ApprovalStatus;
  requestedAt: string;
  decidedAt?: string;
  actorId?: string;
  reason?: string;
}

export interface ApprovalDecisionResult {
  request: ApprovalRequestState;
  idempotentReplay: boolean;
}

export class InMemoryApprovalWorkflow {
  private readonly requests = new Map<string, ApprovalRequestState>();
  private sequence = 0;

  create(input: {
    tenantId: string;
    postId: string;
    mode: ApprovalMode;
    requestedAt: string;
  }): ApprovalRequestState {
    if (!input.tenantId.trim() || !input.postId.trim()) throw new Error('approval_invalid_scope');
    if (!Number.isFinite(Date.parse(input.requestedAt))) throw new Error('approval_invalid_requested_at');

    this.sequence += 1;
    const id = `approval-${this.sequence}`;
    const state: ApprovalRequestState = {
      id,
      tenantId: input.tenantId,
      postId: input.postId,
      mode: input.mode,
      status: input.mode === 'auto' ? 'approved' : 'pending',
      requestedAt: input.requestedAt,
    };

    if (input.mode === 'auto') {
      state.decidedAt = input.requestedAt;
      state.actorId = 'system:auto-approval';
      state.reason = 'approved_by_configured_auto_policy';
    }

    this.requests.set(id, state);
    return this.snapshot(id);
  }

  get(input: { tenantId: string; requestId: string }): ApprovalRequestState {
    const request = this.requireRequest(input.requestId);
    this.requireTenant(request, input.tenantId);
    return this.snapshot(input.requestId);
  }

  decide(input: {
    tenantId: string;
    requestId: string;
    actorId: string;
    decision: ApprovalDecision;
    now: string;
    reason?: string;
  }): ApprovalDecisionResult {
    const request = this.requireRequest(input.requestId);
    this.requireTenant(request, input.tenantId);
    if (!input.actorId.trim()) throw new Error('approval_actor_required');
    if (!Number.isFinite(Date.parse(input.now))) throw new Error('approval_invalid_decision_at');

    const desiredStatus: ApprovalStatus = input.decision === 'approve' ? 'approved' : 'rejected';
    if (request.status !== 'pending') {
      if (request.status === desiredStatus && request.actorId === input.actorId) {
        return { request: this.snapshot(input.requestId), idempotentReplay: true };
      }
      throw new Error('approval_already_decided');
    }

    const reason = input.reason?.trim();
    if (input.decision === 'reject' && !reason) throw new Error('approval_rejection_reason_required');

    request.status = desiredStatus;
    request.decidedAt = input.now;
    request.actorId = input.actorId;
    if (reason) request.reason = reason;

    return { request: this.snapshot(input.requestId), idempotentReplay: false };
  }

  listForTenant(tenantId: string): ApprovalRequestState[] {
    return [...this.requests.values()]
      .filter((request) => request.tenantId === tenantId)
      .map((request) => ({ ...request }));
  }

  private requireRequest(requestId: string): ApprovalRequestState {
    const request = this.requests.get(requestId);
    if (!request) throw new Error('approval_request_not_found');
    return request;
  }

  private requireTenant(request: ApprovalRequestState, tenantId: string): void {
    if (request.tenantId !== tenantId) throw new Error('approval_tenant_mismatch');
  }

  private snapshot(requestId: string): ApprovalRequestState {
    return { ...this.requireRequest(requestId) };
  }
}
