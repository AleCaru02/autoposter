export type AssetKind = 'image' | 'video' | 'document' | 'logo';
export type AssetSource = 'upload' | 'website' | 'generated' | 'imported';

export interface ManagedAsset {
  id: string;
  tenantId: string;
  kind: AssetKind;
  source: AssetSource;
  filename: string;
  tags: string[];
  storagePath: string;
  createdAt: string;
  archivedAt?: string;
}

export interface AssetUsageReference {
  id: string;
  tenantId: string;
  assetId: string;
  entityType: 'post' | 'brand_profile' | 'template' | 'website_page';
  entityId: string;
  purpose: string;
  createdAt: string;
}

export interface AssetWithUsage extends ManagedAsset {
  usage: AssetUsageReference[];
}

const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryAssetLibrary {
  private readonly assets = new Map<string, ManagedAsset>();
  private readonly usage = new Map<string, AssetUsageReference>();
  private sequence = 0;
  private usageSequence = 0;

  create(input: Omit<ManagedAsset, 'id'>): ManagedAsset {
    if (!input.tenantId.trim()) throw new Error('asset_tenant_required');
    if (!input.filename.trim() || !input.storagePath.trim()) throw new Error('asset_metadata_required');
    if (!input.storagePath.startsWith(`${input.tenantId}/`)) throw new Error('asset_storage_path_tenant_mismatch');
    if (!Number.isFinite(Date.parse(input.createdAt))) throw new Error('asset_invalid_time');

    this.sequence += 1;
    const asset: ManagedAsset = {
      ...clone(input),
      id: `asset-${this.sequence}`,
      tags: [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))],
    };
    this.assets.set(asset.id, asset);
    return clone(asset);
  }

  get(input: { tenantId: string; assetId: string }): AssetWithUsage {
    const asset = this.requireAsset(input.assetId);
    this.requireTenant(asset, input.tenantId);
    return {
      ...clone(asset),
      usage: this.usageForAsset(asset.tenantId, asset.id),
    };
  }

  list(tenantId: string, filter?: { kind?: AssetKind; tag?: string; includeArchived?: boolean }): ManagedAsset[] {
    return [...this.assets.values()]
      .filter((asset) => asset.tenantId === tenantId)
      .filter((asset) => filter?.includeArchived || !asset.archivedAt)
      .filter((asset) => !filter?.kind || asset.kind === filter.kind)
      .filter((asset) => !filter?.tag || asset.tags.includes(filter.tag))
      .map(clone);
  }

  addUsage(input: Omit<AssetUsageReference, 'id'>): AssetUsageReference {
    const asset = this.requireAsset(input.assetId);
    this.requireTenant(asset, input.tenantId);
    if (!input.entityId.trim() || !input.purpose.trim()) throw new Error('asset_usage_metadata_required');
    if (!Number.isFinite(Date.parse(input.createdAt))) throw new Error('asset_invalid_time');
    if (asset.archivedAt) throw new Error('asset_archived');

    const duplicate = [...this.usage.values()].find((reference) =>
      reference.tenantId === input.tenantId
      && reference.assetId === input.assetId
      && reference.entityType === input.entityType
      && reference.entityId === input.entityId
      && reference.purpose === input.purpose,
    );
    if (duplicate) return clone(duplicate);

    this.usageSequence += 1;
    const reference: AssetUsageReference = { ...clone(input), id: `asset-usage-${this.usageSequence}` };
    this.usage.set(reference.id, reference);
    return clone(reference);
  }

  removeUsage(input: { tenantId: string; usageId: string }): void {
    const reference = this.usage.get(input.usageId);
    if (!reference) throw new Error('asset_usage_not_found');
    if (reference.tenantId !== input.tenantId) throw new Error('asset_tenant_mismatch');
    this.usage.delete(input.usageId);
  }

  archive(input: { tenantId: string; assetId: string; now: string }): ManagedAsset {
    const asset = this.requireAsset(input.assetId);
    this.requireTenant(asset, input.tenantId);
    if (!Number.isFinite(Date.parse(input.now))) throw new Error('asset_invalid_time');
    asset.archivedAt = input.now;
    return clone(asset);
  }

  delete(input: { tenantId: string; assetId: string }): void {
    const asset = this.requireAsset(input.assetId);
    this.requireTenant(asset, input.tenantId);
    const references = this.usageForAsset(input.tenantId, input.assetId);
    if (references.length > 0) throw new Error('asset_in_use');
    this.assets.delete(input.assetId);
  }

  private usageForAsset(tenantId: string, assetId: string): AssetUsageReference[] {
    return [...this.usage.values()]
      .filter((reference) => reference.tenantId === tenantId && reference.assetId === assetId)
      .map(clone);
  }

  private requireAsset(assetId: string): ManagedAsset {
    const asset = this.assets.get(assetId);
    if (!asset) throw new Error('asset_not_found');
    return asset;
  }

  private requireTenant(asset: ManagedAsset, tenantId: string): void {
    if (asset.tenantId !== tenantId) throw new Error('asset_tenant_mismatch');
  }
}
