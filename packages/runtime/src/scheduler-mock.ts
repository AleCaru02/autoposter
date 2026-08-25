import type {
  PostVariant,
  PublicationErrorClass,
  PublicationJob,
  SocialPlatform,
  SocialProvider,
} from '@socialpilot/contracts';

export type MockJobState = 'queued' | 'publishing' | 'retry_wait' | 'published' | 'dead';

export interface MockPublicationPayload {
  connectionId: string;
  accountId: string;
  variant: PostVariant;
  mediaUrl?: string;
}

export interface MockScheduledJob extends PublicationJob {
  state: MockJobState;
  lastErrorClass?: PublicationErrorClass;
  lastErrorMessage?: string;
  nextAttemptAt?: string;
}

interface InternalJob {
  job: MockScheduledJob;
  payload: MockPublicationPayload;
}

export type ProviderRegistry = Record<SocialPlatform, SocialProvider>;

export class InMemoryPublicationScheduler {
  private readonly jobs = new Map<string, InternalJob>();
  private readonly jobIdByTenantIdempotency = new Map<string, string>();
  private sequence = 0;

  enqueue(input: Omit<PublicationJob, 'id' | 'attempts' | 'externalPostId'>, payload: MockPublicationPayload): MockScheduledJob {
    if (payload.variant.platform !== input.platform) throw new Error('scheduler_platform_mismatch');

    const dedupeKey = `${input.tenantId}:${input.idempotencyKey}`;
    const existingId = this.jobIdByTenantIdempotency.get(dedupeKey);
    if (existingId) return this.snapshot(existingId);

    this.sequence += 1;
    const id = `job-${this.sequence}`;
    const job: MockScheduledJob = {
      ...input,
      id,
      attempts: 0,
      state: 'queued',
    };

    this.jobs.set(id, { job, payload: { ...payload } });
    this.jobIdByTenantIdempotency.set(dedupeKey, id);
    return this.snapshot(id);
  }

  get(jobId: string): MockScheduledJob {
    return this.snapshot(jobId);
  }

  list(): MockScheduledJob[] {
    return [...this.jobs.keys()].map((id) => this.snapshot(id));
  }

  async runDue(input: {
    now: string;
    providers: ProviderRegistry;
    classifyError: (error: unknown) => PublicationErrorClass;
  }): Promise<MockScheduledJob[]> {
    const nowMs = Date.parse(input.now);
    if (!Number.isFinite(nowMs)) throw new Error('scheduler_invalid_now');

    const candidates = [...this.jobs.values()].filter(({ job }) => {
      if (job.state === 'published' || job.state === 'dead' || job.state === 'publishing') return false;
      const dueAt = job.nextAttemptAt ?? job.scheduledAt;
      return Date.parse(dueAt) <= nowMs;
    });

    const results: MockScheduledJob[] = [];
    for (const internal of candidates) {
      await this.processOne(internal, input.providers, input.classifyError, nowMs);
      results.push(this.snapshot(internal.job.id));
    }
    return results;
  }

  private async processOne(
    internal: InternalJob,
    providers: ProviderRegistry,
    classifyError: (error: unknown) => PublicationErrorClass,
    nowMs: number,
  ): Promise<void> {
    const { job, payload } = internal;
    if (job.externalPostId) {
      job.state = 'published';
      return;
    }

    job.state = 'publishing';
    job.attempts += 1;
    delete job.lastErrorClass;
    delete job.lastErrorMessage;
    delete job.nextAttemptAt;

    const provider = providers[job.platform];

    try {
      const baseInput = {
        connectionId: payload.connectionId,
        accountId: payload.accountId,
        variant: payload.variant,
        idempotencyKey: job.idempotencyKey,
      };
      const published = payload.mediaUrl
        ? await provider.publishImage({ ...baseInput, mediaUrl: payload.mediaUrl })
        : await provider.publishPost(baseInput);

      job.externalPostId = published.externalPostId;
      job.state = 'published';
    } catch (error) {
      const errorClass = classifyError(error);
      job.lastErrorClass = errorClass;
      job.lastErrorMessage = error instanceof Error ? error.message : 'unknown_error';

      const retryable = errorClass === 'retryable' || errorClass === 'rate_limit';
      if (!retryable || job.attempts >= job.maxAttempts) {
        job.state = 'dead';
        return;
      }

      const delayMs = Math.min(60_000, 1_000 * 2 ** Math.max(0, job.attempts - 1));
      job.nextAttemptAt = new Date(nowMs + delayMs).toISOString();
      job.state = 'retry_wait';
    }
  }

  private snapshot(jobId: string): MockScheduledJob {
    const internal = this.jobs.get(jobId);
    if (!internal) throw new Error('scheduler_job_not_found');
    return { ...internal.job };
  }
}
