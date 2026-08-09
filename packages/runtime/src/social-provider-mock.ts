import type {
  PostVariant,
  PublishResult,
  SocialAnalyticsSnapshot,
  SocialConnectionHealth,
  SocialPlatform,
  SocialProvider,
} from '@socialpilot/contracts';

interface StoredPost {
  connectionId: string;
  accountId: string;
  variant: PostVariant;
  result: PublishResult;
  mediaUrl?: string;
  deleted: boolean;
}

const connected: SocialConnectionHealth = { status: 'connected' };

export class MockSocialProvider implements SocialProvider {
  readonly platform: SocialPlatform;

  private sequence = 0;
  private readonly health = new Map<string, SocialConnectionHealth>();
  private readonly postsByExternalId = new Map<string, StoredPost>();
  private readonly resultByIdempotencyKey = new Map<string, PublishResult>();

  constructor(platform: SocialPlatform) {
    this.platform = platform;
  }

  seedConnection(connectionId: string, health: SocialConnectionHealth = connected): void {
    this.health.set(connectionId, { ...health });
  }

  async connect(input: { tenantId: string; redirectUri: string; state: string }): Promise<{ authorizationUrl: string }> {
    const query = new URLSearchParams({
      tenant_id: input.tenantId,
      redirect_uri: input.redirectUri,
      state: input.state,
    });
    return { authorizationUrl: `https://mock.invalid/oauth/${this.platform}?${query.toString()}` };
  }

  async refreshToken(connectionId: string): Promise<SocialConnectionHealth> {
    const current = this.requireConnection(connectionId);
    if (current.status === 'disabled' || current.status === 'permission_error') return { ...current };
    const next: SocialConnectionHealth = { status: 'connected' };
    this.health.set(connectionId, next);
    return { ...next };
  }

  async validateConnection(connectionId: string): Promise<SocialConnectionHealth> {
    return { ...this.requireConnection(connectionId) };
  }

  async publishPost(input: {
    connectionId: string;
    accountId: string;
    variant: PostVariant;
    idempotencyKey: string;
  }): Promise<PublishResult> {
    return this.publish({ ...input });
  }

  async publishImage(input: {
    connectionId: string;
    accountId: string;
    mediaUrl: string;
    variant: PostVariant;
    idempotencyKey: string;
  }): Promise<PublishResult> {
    return this.publish({ ...input, mediaUrl: input.mediaUrl });
  }

  async getPost(input: { connectionId: string; externalPostId: string }): Promise<Record<string, unknown>> {
    this.requireConnection(input.connectionId);
    const stored = this.postsByExternalId.get(input.externalPostId);
    if (!stored || stored.connectionId !== input.connectionId || stored.deleted) {
      throw new Error('mock_post_not_found');
    }

    return {
      externalPostId: stored.result.externalPostId,
      platform: this.platform,
      accountId: stored.accountId,
      caption: stored.variant.caption,
      publishedAt: stored.result.publishedAt,
      deleted: false,
    };
  }

  async deletePost(input: { connectionId: string; externalPostId: string }): Promise<void> {
    this.requireConnection(input.connectionId);
    const stored = this.postsByExternalId.get(input.externalPostId);
    if (!stored || stored.connectionId !== input.connectionId) throw new Error('mock_post_not_found');
    stored.deleted = true;
  }

  async getAnalytics(input: { connectionId: string; externalPostId: string }): Promise<SocialAnalyticsSnapshot> {
    const stored = this.postsByExternalId.get(input.externalPostId);
    if (!stored || stored.connectionId !== input.connectionId || stored.deleted) {
      throw new Error('mock_post_not_found');
    }

    const seed = Math.max(1, Number(input.externalPostId.split('-').at(-1)) || 1);
    return {
      platform: this.platform,
      capturedAt: new Date(Date.UTC(2026, 7, 9, 12, seed % 60)).toISOString(),
      metrics: {
        impressions: 100 * seed,
        reach: 80 * seed,
        engagements: 9 * seed,
        clicks: 3 * seed,
      },
      availableMetricKeys: ['impressions', 'reach', 'engagements', 'clicks'],
    };
  }

  private requireConnection(connectionId: string): SocialConnectionHealth {
    const health = this.health.get(connectionId);
    if (!health) throw new Error('mock_connection_not_found');
    return health;
  }

  private async publish(input: {
    connectionId: string;
    accountId: string;
    variant: PostVariant;
    idempotencyKey: string;
    mediaUrl?: string;
  }): Promise<PublishResult> {
    const health = this.requireConnection(input.connectionId);
    if (health.status !== 'connected') throw new Error(`mock_connection_${health.status}`);
    if (input.variant.platform !== this.platform) throw new Error('mock_platform_mismatch');
    if (input.variant.decision === 'skip') throw new Error('mock_skipped_variant_cannot_publish');

    const replay = this.resultByIdempotencyKey.get(input.idempotencyKey);
    if (replay) return { ...replay };

    this.sequence += 1;
    const externalPostId = `${this.platform}-mock-${this.sequence}`;
    const result: PublishResult = {
      externalPostId,
      externalUrl: `https://mock.invalid/${this.platform}/posts/${externalPostId}`,
      providerRequestId: `req-${this.platform}-${this.sequence}`,
      publishedAt: new Date(Date.UTC(2026, 7, 9, 10, this.sequence)).toISOString(),
    };

    const stored: StoredPost = {
      connectionId: input.connectionId,
      accountId: input.accountId,
      variant: input.variant,
      result,
      deleted: false,
    };
    if (input.mediaUrl) stored.mediaUrl = input.mediaUrl;

    this.postsByExternalId.set(externalPostId, stored);
    this.resultByIdempotencyKey.set(input.idempotencyKey, result);
    return { ...result };
  }
}

export const createDefaultMockProviders = (): Record<SocialPlatform, MockSocialProvider> => ({
  facebook: new MockSocialProvider('facebook'),
  instagram: new MockSocialProvider('instagram'),
  linkedin: new MockSocialProvider('linkedin'),
  google_business_profile: new MockSocialProvider('google_business_profile'),
});
