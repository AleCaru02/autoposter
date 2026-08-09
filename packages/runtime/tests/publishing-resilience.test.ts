import { describe, expect, it } from 'vitest';
import type { PostVariant, PublishResult, SocialAnalyticsSnapshot, SocialConnectionHealth, SocialProvider } from '@socialpilot/contracts';
import { InMemoryPublicationScheduler } from '../src/scheduler-mock.js';
import { MockSocialProvider, createDefaultMockProviders } from '../src/social-provider-mock.js';

const variant: PostVariant = {
  platform: 'facebook',
  decision: 'native_variant',
  format: 'single_image',
  hook: 'Hook resilienza',
  caption: 'Caption resilienza',
  cta: 'Scopri di più',
  hashtags: [],
  altText: 'Visual resilienza',
  visualBrief: {},
  approvalMode: 'manual',
};

class TimeoutAfterSuccessProvider implements SocialProvider {
  readonly platform = 'facebook' as const;
  private shouldTimeout = true;

  constructor(private readonly delegate: MockSocialProvider) {}

  connect(input: { tenantId: string; redirectUri: string; state: string }): Promise<{ authorizationUrl: string }> { return this.delegate.connect(input); }
  refreshToken(connectionId: string): Promise<SocialConnectionHealth> { return this.delegate.refreshToken(connectionId); }
  validateConnection(connectionId: string): Promise<SocialConnectionHealth> { return this.delegate.validateConnection(connectionId); }

  async publishPost(input: { connectionId: string; accountId: string; variant: PostVariant; idempotencyKey: string }): Promise<PublishResult> {
    const result = await this.delegate.publishPost(input);
    if (this.shouldTimeout) {
      this.shouldTimeout = false;
      throw new Error('mock_timeout_after_provider_success');
    }
    return result;
  }

  async publishImage(input: { connectionId: string; accountId: string; mediaUrl: string; variant: PostVariant; idempotencyKey: string }): Promise<PublishResult> {
    const result = await this.delegate.publishImage(input);
    if (this.shouldTimeout) {
      this.shouldTimeout = false;
      throw new Error('mock_timeout_after_provider_success');
    }
    return result;
  }

  getPost(input: { connectionId: string; externalPostId: string }): Promise<Record<string, unknown>> { return this.delegate.getPost(input); }
  deletePost(input: { connectionId: string; externalPostId: string }): Promise<void> { return this.delegate.deletePost(input); }
  getAnalytics(input: { connectionId: string; externalPostId: string }): Promise<SocialAnalyticsSnapshot> { return this.delegate.getAnalytics(input); }
}

describe('publishing reconciliation semantics', () => {
  it('recovers from timeout after provider success without creating a duplicate post', async () => {
    const base = new MockSocialProvider('facebook');
    base.seedConnection('fb-conn');
    const flaky = new TimeoutAfterSuccessProvider(base);
    const providers: Record<'facebook' | 'instagram' | 'linkedin' | 'google_business_profile', SocialProvider> = createDefaultMockProviders();
    providers.facebook = flaky;
    const scheduler = new InMemoryPublicationScheduler();

    const job = scheduler.enqueue(
      {
        tenantId: 'tenant-a',
        postVariantId: 'variant-resilience',
        platform: 'facebook',
        scheduledAt: '2026-08-09T15:00:00.000Z',
        idempotencyKey: 'tenant-a:variant-resilience:facebook',
        maxAttempts: 3,
        correlationId: 'corr-resilience',
      },
      { connectionId: 'fb-conn', accountId: 'page-a', variant },
    );

    await scheduler.runDue({
      now: '2026-08-09T15:00:00.000Z',
      providers,
      classifyError: (error) => error instanceof Error && error.message.includes('timeout') ? 'retryable' : 'non_retryable',
    });

    const afterTimeout = scheduler.get(job.id);
    expect(afterTimeout.state).toBe('retry_wait');
    expect(afterTimeout.attempts).toBe(1);
    expect(afterTimeout.externalPostId).toBeUndefined();

    await scheduler.runDue({
      now: '2026-08-09T15:00:02.000Z',
      providers,
      classifyError: (error) => error instanceof Error && error.message.includes('timeout') ? 'retryable' : 'non_retryable',
    });

    const recovered = scheduler.get(job.id);
    expect(recovered.state).toBe('published');
    expect(recovered.attempts).toBe(2);
    expect(recovered.externalPostId).toBe('facebook-mock-1');

    const providerPost = await base.getPost({ connectionId: 'fb-conn', externalPostId: recovered.externalPostId! });
    expect(providerPost.externalPostId).toBe('facebook-mock-1');

    const second = await base.publishPost({
      connectionId: 'fb-conn',
      accountId: 'page-a',
      variant,
      idempotencyKey: 'second-distinct-operation',
    });
    expect(second.externalPostId).toBe('facebook-mock-2');
  });
});
