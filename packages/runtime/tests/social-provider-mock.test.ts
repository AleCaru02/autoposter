import { describe, expect, it } from 'vitest';
import { MockSocialProvider } from '../src/social-provider-mock.js';

const variant = {
  platform: 'instagram' as const,
  decision: 'native_variant' as const,
  format: 'single_image',
  hook: 'Tre cose utili',
  caption: 'Contenuto demo',
  cta: 'Scopri di più',
  hashtags: ['#demo'],
  altText: 'Visual demo',
  visualBrief: {},
  approvalMode: 'manual' as const,
};

describe('MockSocialProvider', () => {
  it('publishes idempotently and exposes deterministic analytics', async () => {
    const provider = new MockSocialProvider('instagram');
    provider.seedConnection('conn-1');

    const first = await provider.publishPost({
      connectionId: 'conn-1',
      accountId: 'account-1',
      variant,
      idempotencyKey: 'idem-1',
    });
    const replay = await provider.publishPost({
      connectionId: 'conn-1',
      accountId: 'account-1',
      variant,
      idempotencyKey: 'idem-1',
    });

    expect(replay.externalPostId).toBe(first.externalPostId);
    const stored = await provider.getPost({ connectionId: 'conn-1', externalPostId: first.externalPostId });
    expect(stored.caption).toBe('Contenuto demo');

    const analytics = await provider.getAnalytics({ connectionId: 'conn-1', externalPostId: first.externalPostId });
    expect(analytics.platform).toBe('instagram');
    expect(analytics.metrics.impressions).toBeGreaterThan(0);
  });

  it('refuses publishing on unhealthy connections and skipped variants', async () => {
    const provider = new MockSocialProvider('instagram');
    provider.seedConnection('expired', { status: 'expired' });
    await expect(
      provider.publishPost({ connectionId: 'expired', accountId: 'a', variant, idempotencyKey: 'x' }),
    ).rejects.toThrow('mock_connection_expired');

    provider.seedConnection('ok');
    await expect(
      provider.publishPost({
        connectionId: 'ok',
        accountId: 'a',
        variant: { ...variant, decision: 'skip' },
        idempotencyKey: 'skip',
      }),
    ).rejects.toThrow('mock_skipped_variant_cannot_publish');
  });

  it('supports delete without affecting another connection', async () => {
    const provider = new MockSocialProvider('instagram');
    provider.seedConnection('one');
    provider.seedConnection('two');
    const result = await provider.publishImage({
      connectionId: 'one',
      accountId: 'a',
      mediaUrl: 'https://assets.example.test/image.jpg',
      variant,
      idempotencyKey: 'image-1',
    });

    await expect(provider.getPost({ connectionId: 'two', externalPostId: result.externalPostId })).rejects.toThrow();
    await provider.deletePost({ connectionId: 'one', externalPostId: result.externalPostId });
    await expect(provider.getPost({ connectionId: 'one', externalPostId: result.externalPostId })).rejects.toThrow(
      'mock_post_not_found',
    );
  });
});
