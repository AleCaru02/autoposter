import { describe, expect, it } from 'vitest';
import { InMemoryBrandProfileStore } from '../src/brand-profile-store.js';

describe('InMemoryBrandProfileStore', () => {
  it('keeps a single current version and preserves history', () => {
    const store = new InMemoryBrandProfileStore();
    const first = store.createInitial({
      tenantId: 'tenant-a',
      profile: { brandName: 'Demo Brand', industry: 'servizi', toneOfVoice: 'chiaro' },
      now: '2026-08-09T10:00:00.000Z',
    });
    expect(first.version).toBe(1);
    expect(first.status).toBe('draft');

    const second = store.createVersion({
      tenantId: 'tenant-a',
      patch: { toneOfVoice: 'chiaro e competente' },
      now: '2026-08-09T10:05:00.000Z',
    });
    expect(second.version).toBe(2);
    expect(second.status).toBe('draft');
    expect(second.profile.toneOfVoice).toBe('chiaro e competente');

    const history = store.history('tenant-a');
    expect(history).toHaveLength(2);
    expect(history[0]?.status).toBe('superseded');
    expect(history[1]?.status).toBe('draft');
  });

  it('allows only the latest version to be confirmed', () => {
    const store = new InMemoryBrandProfileStore();
    store.createInitial({ tenantId: 'tenant-a', profile: { brandName: 'A' }, now: '2026-08-09T11:00:00.000Z' });
    store.createVersion({ tenantId: 'tenant-a', patch: { industry: 'retail' }, now: '2026-08-09T11:01:00.000Z' });

    expect(() => store.confirm({ tenantId: 'tenant-a', version: 1, now: '2026-08-09T11:02:00.000Z' })).toThrow('brand_only_latest_version_confirmable');
    const confirmed = store.confirm({ tenantId: 'tenant-a', version: 2, now: '2026-08-09T11:03:00.000Z' });
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.confirmedAt).toBe('2026-08-09T11:03:00.000Z');
  });

  it('carries locks forward and blocks changes until explicitly unlocked', () => {
    const store = new InMemoryBrandProfileStore();
    store.createInitial({
      tenantId: 'tenant-a',
      profile: { brandName: 'Locked Brand', claimsForbidden: ['risultati garantiti'] },
      now: '2026-08-09T12:00:00.000Z',
    });
    store.lockField({ tenantId: 'tenant-a', fieldPath: 'brandName', lockedBy: 'user-a', now: '2026-08-09T12:01:00.000Z' });

    expect(() => store.createVersion({
      tenantId: 'tenant-a',
      patch: { brandName: 'Changed Brand' },
      now: '2026-08-09T12:02:00.000Z',
    })).toThrow('brand_field_locked:brandName');

    const second = store.createVersion({
      tenantId: 'tenant-a',
      patch: { industry: 'property management' },
      now: '2026-08-09T12:03:00.000Z',
    });
    expect(second.locks.find((lock) => lock.fieldPath === 'brandName')?.value).toBe('Locked Brand');

    store.unlockField({ tenantId: 'tenant-a', fieldPath: 'brandName' });
    const third = store.createVersion({
      tenantId: 'tenant-a',
      patch: { brandName: 'Changed Brand' },
      now: '2026-08-09T12:04:00.000Z',
    });
    expect(third.profile.brandName).toBe('Changed Brand');
  });

  it('keeps tenant histories isolated', () => {
    const store = new InMemoryBrandProfileStore();
    store.createInitial({ tenantId: 'tenant-a', profile: { brandName: 'Brand A' }, now: '2026-08-09T13:00:00.000Z' });
    store.createInitial({ tenantId: 'tenant-b', profile: { brandName: 'Brand B' }, now: '2026-08-09T13:00:00.000Z' });
    store.createVersion({ tenantId: 'tenant-a', patch: { industry: 'A industry' }, now: '2026-08-09T13:01:00.000Z' });

    expect(store.current('tenant-a').profile.brandName).toBe('Brand A');
    expect(store.current('tenant-b').profile.brandName).toBe('Brand B');
    expect(store.history('tenant-a')).toHaveLength(2);
    expect(store.history('tenant-b')).toHaveLength(1);
  });
});
