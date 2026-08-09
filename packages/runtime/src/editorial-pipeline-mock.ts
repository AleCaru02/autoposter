import type { PostVariant, QualityScore, SocialPlatform } from '@socialpilot/contracts';
import { DeterministicAIOrchestratorMock } from './ai-orchestrator-mock.js';
import { InMemoryApprovalWorkflow, type ApprovalMode } from './approval-workflow.js';
import { InMemoryPublicationScheduler, type ScheduledPublicationJob } from './scheduler-mock.js';

type OrchestratorContext = Parameters<DeterministicAIOrchestratorMock['generateCoreConcept']>[0];
type CoreConcept = Awaited<ReturnType<DeterministicAIOrchestratorMock['generateCoreConcept']>>;

export interface EditorialPipelineRun {
  id: string;
  tenantId: string;
  correlationId: string;
  concept: CoreConcept;
  variants: PostVariant[];
  quality: QualityScore;
  approvalRequestId?: string;
  approvalStatus: 'blocked_quality' | 'pending' | 'approved' | 'rejected';
  scheduledAt: string;
  createdAt: string;
}

interface EditorialOrchestrator {
  generateCoreConcept(context: OrchestratorContext): Promise<CoreConcept>;
  generatePlatformVariants(context: OrchestratorContext, concept: CoreConcept, platforms: SocialPlatform[]): Promise<PostVariant[]>;
  scoreAndValidate(context: OrchestratorContext, concept: CoreConcept, variants: PostVariant[]): Promise<QualityScore>;
}

export class EditorialPipelineMock {
  private readonly approvals = new InMemoryApprovalWorkflow();
  private readonly scheduler = new InMemoryPublicationScheduler();
  private readonly runs = new Map<string, EditorialPipelineRun>();
  private readonly idempotency = new Map<string, string>();
  private sequence = 0;

  constructor(
    private readonly orchestrator: EditorialOrchestrator = new DeterministicAIOrchestratorMock(),
    private readonly minimumQuality = 0.8,
  ) {
    if (!Number.isFinite(minimumQuality) || minimumQuality < 0 || minimumQuality > 1) throw new Error('editorial_invalid_quality_threshold');
  }

  async prepare(input: {
    context: OrchestratorContext;
    platforms: SocialPlatform[];
    approvalMode: ApprovalMode;
    scheduledAt: string;
    createdAt: string;
  }): Promise<EditorialPipelineRun> {
    const tenantId = input.context.tenantId;
    const correlationId = input.context.correlationId;
    if (!tenantId.trim() || !correlationId.trim()) throw new Error('editorial_scope_required');
    if (!Number.isFinite(Date.parse(input.scheduledAt)) || !Number.isFinite(Date.parse(input.createdAt))) throw new Error('editorial_invalid_time');

    const idempotencyKey = `${tenantId}:${correlationId}`;
    const existingId = this.idempotency.get(idempotencyKey);
    if (existingId) return this.snapshot(existingId);

    const concept = await this.orchestrator.generateCoreConcept(input.context);
    const variants = await this.orchestrator.generatePlatformVariants(input.context, concept, input.platforms);
    const quality = await this.orchestrator.scoreAndValidate(input.context, concept, variants);

    this.sequence += 1;
    const runId = `editorial-run-${this.sequence}`;
    const belowGate = [quality.brandMatch, quality.relevance, quality.clarity, quality.platformFit, quality.factConfidence]
      .some((score) => score < this.minimumQuality);

    const run: EditorialPipelineRun = {
      id: runId,
      tenantId,
      correlationId,
      concept,
      variants,
      quality,
      approvalStatus: belowGate ? 'blocked_quality' : 'pending',
      scheduledAt: input.scheduledAt,
      createdAt: input.createdAt,
    };

    if (!belowGate) {
      const approval = this.approvals.create({ tenantId, postId: runId, mode: input.approvalMode, requestedAt: input.createdAt });
      run.approvalRequestId = approval.id;
      run.approvalStatus = approval.status;
    }

    this.runs.set(runId, run);
    this.idempotency.set(idempotencyKey, runId);
    return this.snapshot(runId);
  }

  approve(input: { tenantId: string; runId: string; actorId: string; now: string }): EditorialPipelineRun {
    const run = this.requireRun(input.runId);
    this.requireTenant(run, input.tenantId);
    if (run.approvalStatus === 'blocked_quality') throw new Error('editorial_quality_blocked');
    if (!run.approvalRequestId) throw new Error('editorial_approval_missing');

    const decision = this.approvals.decide({
      tenantId: input.tenantId,
      requestId: run.approvalRequestId,
      actorId: input.actorId,
      decision: 'approve',
      now: input.now,
    });
    run.approvalStatus = decision.request.status;
    return this.snapshot(run.id);
  }

  reject(input: { tenantId: string; runId: string; actorId: string; reason: string; now: string }): EditorialPipelineRun {
    const run = this.requireRun(input.runId);
    this.requireTenant(run, input.tenantId);
    if (run.approvalStatus === 'blocked_quality') throw new Error('editorial_quality_blocked');
    if (!run.approvalRequestId) throw new Error('editorial_approval_missing');

    const decision = this.approvals.decide({
      tenantId: input.tenantId,
      requestId: run.approvalRequestId,
      actorId: input.actorId,
      decision: 'reject',
      reason: input.reason,
      now: input.now,
    });
    run.approvalStatus = decision.request.status;
    return this.snapshot(run.id);
  }

  schedule(input: {
    tenantId: string;
    runId: string;
    destinations: Partial<Record<SocialPlatform, { connectionId: string; accountId: string }>>;
  }): ScheduledPublicationJob[] {
    const run = this.requireRun(input.runId);
    this.requireTenant(run, input.tenantId);
    if (run.approvalStatus !== 'approved') throw new Error('editorial_not_approved');

    const jobs: ScheduledPublicationJob[] = [];
    for (const variant of run.variants) {
      if (variant.decision === 'skip') continue;
      const destination = input.destinations[variant.platform];
      if (!destination) throw new Error(`editorial_destination_missing:${variant.platform}`);
      jobs.push(this.scheduler.enqueue(
        {
          tenantId: run.tenantId,
          postVariantId: `${run.id}:${variant.platform}`,
          platform: variant.platform,
          scheduledAt: run.scheduledAt,
          idempotencyKey: `${run.tenantId}:${run.id}:${variant.platform}`,
          maxAttempts: 3,
          correlationId: run.correlationId,
        },
        { connectionId: destination.connectionId, accountId: destination.accountId, variant },
      ));
    }
    return jobs.map((job) => structuredClone(job));
  }

  get(input: { tenantId: string; runId: string }): EditorialPipelineRun {
    const run = this.requireRun(input.runId);
    this.requireTenant(run, input.tenantId);
    return this.snapshot(run.id);
  }

  private requireRun(runId: string): EditorialPipelineRun {
    const run = this.runs.get(runId);
    if (!run) throw new Error('editorial_run_not_found');
    return run;
  }

  private requireTenant(run: EditorialPipelineRun, tenantId: string): void {
    if (run.tenantId !== tenantId) throw new Error('editorial_tenant_mismatch');
  }

  private snapshot(runId: string): EditorialPipelineRun {
    return structuredClone(this.requireRun(runId));
  }
}
