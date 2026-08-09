import { describe, expect, it } from 'vitest';
import { InMemoryAssetLibrary } from '../src/asset-library.js';

describe('InMemoryAssetLibrary', () => {
  it('requires tenant-scoped storage paths and keeps listings isolated', () => {
    const library = new InMemoryAssetLibrary();
    expect(() => library.create({
      tenantId: 'tenant-a',
      kind: 'image',
      source: 'upload',
      filename: 'wrong.jpg',
      tags: [],
      storagePath: 'tenant-b/wrong.jpg',
      createdAt: '2026-08-09T10:00:00.000Z',
    })).toThrow('asset_storage_path_tenant_mismatch');

    const a = library.create({ tenantId: 'tenant-a', kind: 'image', source: 'upload', filename: 'a.jpg', tags: ['brand'], storagePath: 'tenant-a/a.jpg', createdAt: '2026-08-09T10:00:00.000Z' });
    library.create({ tenantId: 'tenant-b', kind: 'image', source: 'upload', filename: 'b.jpg', tags: ['brand'], storagePath: 'tenant-b/b.jpg', createdAt: '2026-08-09T10:00:00.000Z' });

    expect(library.list('tenant-a').map((asset) => asset.id)).toEqual([a.id]);
    expect(() => library.get({ tenantId: 'tenant-b', assetId: a.id })).toThrow('asset_tenant_mismatch');
  });

  it('deduplicates usage references and prevents deletion while an asset is in use', () => {
    const library = new InMemoryAssetLibrary();
    const asset = library.create({ tenantId: 'tenant-a', kind: 'logo', source: 'upload', filename: 'logo.svg', tags: ['brand','brand'], storagePath: 'tenant-a/logo.svg', createdAt: '2026-08-09T11:00:00.000Z' });
    expect(asset.tags).toEqual(['brand']);

    const first = library.addUsage({ tenantId: 'tenant-a', assetId: asset.id, entityType: 'post', entityId: 'post-1', purpose: 'hero', createdAt: '2026-08-09T11:01:00.000Z' });
    const replay = library.addUsage({ tenantId: 'tenant-a', assetId: asset.id, entityType: 'post', entityId: 'post-1', purpose: 'hero', createdAt: '2026-08-09T11:02:00.000Z' });
    expect(replay.id).toBe(first.id);
    expect(library.get({ tenantId: 'tenant-a', assetId: asset.id }).usage).toHaveLength(1);
    expect(() => library.delete({ tenantId: 'tenant-a', assetId: asset.id })).toThrow('asset_in_use');

    library.removeUsage({ tenantId: 'tenant-a', usageId: first.id });
    library.delete({ tenantId: 'tenant-a', assetId: asset.id });
    expect(library.list('tenant-a')).toEqual([]);
  });

  it('archives assets without losing usage history and blocks new usage', () => {
    const library = new InMemoryAssetLibrary();
    const asset = library.create({ tenantId: 'tenant-a', kind: 'document', source: 'website', filename: 'brand.pdf', tags: ['guide'], storagePath: 'tenant-a/docs/brand.pdf', createdAt: '2026-08-09T12:00:00.000Z' });
    library.addUsage({ tenantId: 'tenant-a', assetId: asset.id, entityType: 'brand_profile', entityId: 'brand-v1', purpose: 'source', createdAt: '2026-08-09T12:01:00.000Z' });

    const archived = library.archive({ tenantId: 'tenant-a', assetId: asset.id, now: '2026-08-09T12:02:00.000Z' });
    expect(archived.archivedAt).toBe('2026-08-09T12:02:00.000Z');
    expect(library.list('tenant-a')).toEqual([]);
    expect(library.list('tenant-a', { includeArchived: true })).toHaveLength(1);
    expect(library.get({ tenantId: 'tenant-a', assetId: asset.id }).usage).toHaveLength(1);
    expect(() => library.addUsage({ tenantId: 'tenant-a', assetId: asset.id, entityType: 'post', entityId: 'post-2', purpose: 'hero', createdAt: '2026-08-09T12:03:00.000Z' })).toThrow('asset_archived');
  });

  it('supports kind/tag filters without leaking other tenants', () => {
    const library = new InMemoryAssetLibrary();
    library.create({ tenantId: 'tenant-a', kind: 'image', source: 'upload', filename: 'one.jpg', tags: ['team'], storagePath: 'tenant-a/one.jpg', createdAt: '2026-08-09T13:00:00.000Z' });
    library.create({ tenantId: 'tenant-a', kind: 'document', source: 'upload', filename: 'one.pdf', tags: ['guide'], storagePath: 'tenant-a/one.pdf', createdAt: '2026-08-09T13:00:00.000Z' });
    library.create({ tenantId: 'tenant-b', kind: 'image', source: 'upload', filename: 'other.jpg', tags: ['team'], storagePath: 'tenant-b/other.jpg', createdAt: '2026-08-09T13:00:00.000Z' });

    expect(library.list('tenant-a', { kind: 'image' }).map((asset) => asset.filename)).toEqual(['one.jpg']);
    expect(library.list('tenant-a', { tag: 'guide' }).map((asset) => asset.filename)).toEqual(['one.pdf']);
  });
});
