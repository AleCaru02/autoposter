export interface BrandProfileDraft {
  brandName: string;
  industry?: string;
  target?: unknown;
  services?: unknown;
  differentiators?: unknown;
  toneOfVoice?: unknown;
  visualStyle?: unknown;
  ctaPreferences?: unknown;
  claimsAllowed?: unknown;
  claimsForbidden?: unknown;
  [key: string]: unknown;
}

export interface BrandFieldLock {
  fieldPath: string;
  value: unknown;
  lockedBy: string;
  lockedAt: string;
}

export interface BrandProfileVersion {
  tenantId: string;
  version: number;
  status: 'draft' | 'confirmed' | 'superseded';
  profile: BrandProfileDraft;
  locks: BrandFieldLock[];
  createdAt: string;
  confirmedAt?: string;
}

const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryBrandProfileStore {
  private readonly versionsByTenant = new Map<string, BrandProfileVersion[]>();

  createInitial(input: { tenantId: string; profile: BrandProfileDraft; now: string }): BrandProfileVersion {
    if (!input.tenantId.trim()) throw new Error('brand_tenant_required');
    if (!input.profile.brandName.trim()) throw new Error('brand_name_required');
    if (!Number.isFinite(Date.parse(input.now))) throw new Error('brand_invalid_time');
    if ((this.versionsByTenant.get(input.tenantId)?.length ?? 0) > 0) throw new Error('brand_profile_already_exists');

    const version: BrandProfileVersion = {
      tenantId: input.tenantId,
      version: 1,
      status: 'draft',
      profile: clone(input.profile),
      locks: [],
      createdAt: input.now,
    };
    this.versionsByTenant.set(input.tenantId, [version]);
    return clone(version);
  }

  current(tenantId: string): BrandProfileVersion {
    const versions = this.requireVersions(tenantId);
    return clone(versions[versions.length - 1]!);
  }

  createVersion(input: { tenantId: string; patch: Partial<BrandProfileDraft>; now: string }): BrandProfileVersion {
    const versions = this.requireVersions(input.tenantId);
    const current = versions[versions.length - 1]!;
    if (!Number.isFinite(Date.parse(input.now))) throw new Error('brand_invalid_time');

    for (const lock of current.locks) {
      if (Object.prototype.hasOwnProperty.call(input.patch, lock.fieldPath)) {
        const nextValue = input.patch[lock.fieldPath];
        if (JSON.stringify(nextValue) !== JSON.stringify(lock.value)) throw new Error(`brand_field_locked:${lock.fieldPath}`);
      }
    }

    if (current.status === 'confirmed') current.status = 'superseded';
    const next: BrandProfileVersion = {
      tenantId: input.tenantId,
      version: current.version + 1,
      status: 'draft',
      profile: { ...clone(current.profile), ...clone(input.patch) },
      locks: clone(current.locks),
      createdAt: input.now,
    };
    versions.push(next);
    return clone(next);
  }

  confirm(input: { tenantId: string; version: number; now: string }): BrandProfileVersion {
    const version = this.requireVersion(input.tenantId, input.version);
    if (!Number.isFinite(Date.parse(input.now))) throw new Error('brand_invalid_time');
    const latest = this.current(input.tenantId);
    if (latest.version !== version.version) throw new Error('brand_only_latest_version_confirmable');
    version.status = 'confirmed';
    version.confirmedAt = input.now;
    return clone(version);
  }

  lockField(input: { tenantId: string; fieldPath: string; lockedBy: string; now: string }): BrandProfileVersion {
    const versions = this.requireVersions(input.tenantId);
    const current = versions[versions.length - 1]!;
    if (!input.fieldPath.trim() || !input.lockedBy.trim()) throw new Error('brand_invalid_lock');
    if (!Number.isFinite(Date.parse(input.now))) throw new Error('brand_invalid_time');
    if (!Object.prototype.hasOwnProperty.call(current.profile, input.fieldPath)) throw new Error('brand_lock_field_not_found');

    const existing = current.locks.find((lock) => lock.fieldPath === input.fieldPath);
    if (existing) return clone(current);
    current.locks.push({
      fieldPath: input.fieldPath,
      value: clone(current.profile[input.fieldPath]),
      lockedBy: input.lockedBy,
      lockedAt: input.now,
    });
    return clone(current);
  }

  unlockField(input: { tenantId: string; fieldPath: string }): BrandProfileVersion {
    const versions = this.requireVersions(input.tenantId);
    const current = versions[versions.length - 1]!;
    current.locks = current.locks.filter((lock) => lock.fieldPath !== input.fieldPath);
    return clone(current);
  }

  history(tenantId: string): BrandProfileVersion[] {
    return clone(this.requireVersions(tenantId));
  }

  private requireVersions(tenantId: string): BrandProfileVersion[] {
    const versions = this.versionsByTenant.get(tenantId);
    if (!versions || versions.length === 0) throw new Error('brand_profile_not_found');
    return versions;
  }

  private requireVersion(tenantId: string, versionNumber: number): BrandProfileVersion {
    const version = this.requireVersions(tenantId).find((item) => item.version === versionNumber);
    if (!version) throw new Error('brand_version_not_found');
    return version;
  }
}
