import { describe, expect, it } from 'vitest';
import { InMemoryPublicationScheduler } from '../src/scheduler-mock.js';
import { createDefaultMockProviders } from '../src/social-provider-mock.js';

const baseVariant = {
  platform: 'facebook' as const,
  decision: 'native_variant' as const,
  format: 'single_image',
  hook: 'Hook demo',
  caption: 'Caption demo',
  cta: 'Contattaci',
  hashtags: [],
  altText: 'Visual demo',
  visualBrief: {},
  approvalMode: 'manual' as const,
};

const classify = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('rate')) return 'rate_limit' as const;
  if (message.includes('expired')) return 'auth' as const;
  if (message.includes('skip')) return 'validation' as const;
  return 'non_retryable' as const;
};

describe('InMemoryPublicationScheduler', () => {
  it('deduplicates enqueue and publishes a due job exactly once', async () => {
    const providers = createDefaultMockProviders();
    providers.facebook.seedConnection('fb-conn');
    const scheduler = new InMemoryPublicationScheduler();

    const input = {
      tenantId: 'tenant-a',
      postVariantId: 'variant-1',
      platform: 'facebook' as const,
      scheduledAt: '2026-08-09T10:00:00.000Z',
      idempotencyKey: 'tenant-a:variant-1:facebook',
      maxAttempts: 3,
      correlationId: 'corr-1',
    };
    const payload = { connectionId: 'fb-conn', accountId: 'page-1', variant: baseVariant };

    const first = scheduler.enqueue(input, payload);
    const replay = scheduler.enqueue(input, payload);
    expect(replay.id).toBe(first.id);

    const processed = await scheduler.runDue({
      now: '2026-08-09T10:01:00.000Z',
      providers,
      classifyError: classify,
    });
    expect(processed).toHaveLength(1);
    expect(processed[0]?.state).toBe('published');
    expect(processed[0]?.attempts).toBe(1);
    expect(processed[0]?.externalPostId).toBeTruthy();

    const secondPass = await scheduler.runDue({
      now: '2026-08-09T10:02:00.000Z',
      providers,
      classifyError: classify,
    });
    expect(secondPass).toEqual([]);
    expect(scheduler.get(first.id).attempts).toBe(1);
  });

  it('moves a non-retryable provider failure to dead state', async () => {
    const providers = createDefaultMockProviders();
    providers.facebook.seedConnection('expired', { status: 'expired' });
    const scheduler = new InMemoryPublicationScheduler();

    const job = scheduler.enqueue(
      {
        tenantId: 'tenant-b',
        postVariantId: 'variant-2',
        platform: 'facebook',
        scheduledAt: '2026-08-09T11:00:00.000Z',
        idempotencyKey: 'tenant-b:variant-2:facebook',
        maxAttempts: 3,
        correlationId: 'corr-2',
      },
      { connectionId: 'expired', accountId: 'page-2', variant: baseVariant },
    );

    await scheduler.runDue({ now: '2026-08-09T11:01:00.000Z', providers, classifyError: classify });
    const failed = scheduler.get(job.id);
    expect(failed.state).toBe('dead');
    expect(failed.lastErrorClass).toBe('auth');
    expect(failed.attempts).toBe(1);
  });
});
