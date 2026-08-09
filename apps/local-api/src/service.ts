import { createHash, randomUUID } from 'node:crypto';
import type { SocialPlatform, PostVariant, QualityScore, BrandContextCompact } from '../../../packages/contracts/src/index.js';
import { assessDuplicate, normalizeContent } from '../../../packages/core/src/duplicate.js';
import {
  DeterministicAIOrchestratorMock,
  DeterministicStrategyPlannerMock,
  EvidenceGatedAnalyticsOptimizer,
  WebsiteScanner,
  createDefaultMockProviders,
  type PageFetcher,
  type PlannedContentStrategy,
  type StrategyPillarPlan,
} from '../../../packages/runtime/src/index.js';
import { LocalSupabaseClient, jsonBody, type AuthSession } from './db.js';

const platformKeys: SocialPlatform[] = ['instagram','facebook','linkedin','google_business_profile'];
const encoder = new TextEncoder();

const isoNow = (): string => new Date().toISOString();
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const asArray = (value: unknown): string[] => Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
const asObject = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const ensurePlatform = (value: unknown): SocialPlatform => {
  if (!platformKeys.includes(value as SocialPlatform)) throw new Error(`invalid_platform:${String(value)}`);
  return value as SocialPlatform;
};
const q = (value: string): string => encodeURIComponent(value);
const responseRow = <T>(rows: T[]): T => {
  const row = rows[0];
  if (!row) throw new Error('row_not_found');
  return row;
};

interface OnboardingSessionRow {
  tenant_id: string;
  current_step: string;
  business: Record<string, unknown>;
  goals: unknown;
  target: Record<string, unknown>;
  social: unknown;
  frequency: Record<string, unknown>;
  publishing_modes: Record<string, unknown>;
  scan_summary: Record<string, unknown>;
  completed_at?: string | null;
}

interface BrandProfileRow {
  id: string;
  tenant_id: string;
  status: 'draft' | 'review' | 'confirmed';
  brand_name?: string | null;
  description?: string | null;
  industry?: string | null;
  sub_industry?: string | null;
  location?: unknown;
  target?: unknown;
  personas?: unknown;
  services?: unknown;
  products?: unknown;
  differentiators?: unknown;
  usp?: string | null;
  value_propositions?: unknown;
  brand_colors?: unknown;
  fonts?: unknown;
  visual_style?: unknown;
  tone_of_voice?: unknown;
  vocabulary?: unknown;
  banned_words?: unknown;
  cta_preferences?: unknown;
  claims_allowed?: unknown;
  claims_forbidden?: unknown;
  topics?: unknown;
  goals?: unknown;
  source_summary?: unknown;
  version: number;
  updated_at: string;
}

interface ConnectionRow {
  id: string;
  tenant_id: string;
  platform: SocialPlatform;
  connection_status: string;
  approval_mode: 'auto' | 'manual';
  metadata: Record<string, unknown>;
}

interface PostRow {
  id: string;
  tenant_id: string;
  pillar_id?: string | null;
  idea_id?: string | null;
  topic: string;
  objective?: string | null;
  core_concept: Record<string, unknown>;
  status: string;
  quality_score: Record<string, unknown>;
  generation_version: number;
  planned_at?: string | null;
  primary_platform?: string | null;
  format?: string | null;
  created_at: string;
}

interface VariantRow {
  id: string;
  tenant_id: string;
  post_id: string;
  platform: SocialPlatform;
  platform_decision: 'native_variant' | 'separate_concept' | 'skip';
  format?: string | null;
  hook?: string | null;
  caption?: string | null;
  cta?: string | null;
  hashtags: string[];
  visual_brief: Record<string, unknown>;
  scheduled_at?: string | null;
  approval_mode: 'auto' | 'manual';
  approval_status: 'not_required' | 'pending' | 'approved' | 'rejected';
  status: string;
  external_post_id?: string | null;
  generation_metadata: Record<string, unknown>;
}

class NativePageFetcher implements PageFetcher {
  async fetch(url: string) {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(8_000) });
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      body: await response.text(),
      finalUrl: response.url,
    };
  }
}

export class LocalE2EService {
  private readonly orchestrator = new DeterministicAIOrchestratorMock();
  private readonly strategyPlanner = new DeterministicStrategyPlannerMock();
  private readonly providers = createDefaultMockProviders();
  private readonly analyticsOptimizer = new EvidenceGatedAnalyticsOptimizer({ minimumPosts: 6, minimumObservedImpressions: 1_000, primaryMetric: 'engagements' });

  constructor(private readonly db = new LocalSupabaseClient()) {}

  async register(input: { email: string; password: string; name: string }): Promise<AuthSession> {
    return this.db.signUp(input);
  }

  async login(input: { email: string; password: string }): Promise<AuthSession> {
    return this.db.signIn(input);
  }

  async listTenants(token: string) {
    return this.db.userRest<Array<Record<string, unknown>>>(token, '/rest/v1/tenants?select=id,name,slug,onboarding_status,created_at&order=created_at.asc');
  }

  async createTenant(token: string, input: { name: string; slug: string }) {
    const tenantId = await this.db.rpc<string>(token, 'create_tenant', { p_name: input.name, p_slug: input.slug });
    const normalizedId = typeof tenantId === 'string' ? tenantId : String(tenantId);
    const plan = responseRow(await this.db.serviceRest<Array<{ id: string }>>('/rest/v1/plans?select=id&code=eq.local-dev&limit=1'));
    await this.db.serviceRest('/rest/v1/subscriptions', {
      method: 'POST',
      headers: { prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: jsonBody({ tenant_id: normalizedId, plan_id: plan.id, provider: 'manual', status: 'active', current_period_start: isoNow() }),
    });
    await this.db.userRest(token, '/rest/v1/onboarding_sessions?on_conflict=tenant_id', {
      method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=representation' }, body: jsonBody({ tenant_id: normalizedId, current_step: 'business' }),
    });
    return { tenantId: normalizedId };
  }

  async getWorkspace(token: string, tenantId: string) {
    await this.db.requireTenantRole(token, tenantId);
    const [tenant, onboarding, brand, brandVersions, locks, strategy, pillars, posts, variants, connections, jobs, published, analytics, insights, usage, aiUsage, members] = await Promise.all([
      this.db.userRest<Array<Record<string, unknown>>>(token, `/rest/v1/tenants?select=*&id=eq.${q(tenantId)}&limit=1`),
      this.db.userRest<OnboardingSessionRow[]>(token, `/rest/v1/onboarding_sessions?select=*&tenant_id=eq.${q(tenantId)}&limit=1`),
      this.db.userRest<BrandProfileRow[]>(token, `/rest/v1/brand_profiles?select=*&tenant_id=eq.${q(tenantId)}&limit=1`),
      this.db.userRest<Array<Record<string, unknown>>>(token, `/rest/v1/brand_profile_versions?select=*&tenant_id=eq.${q(tenantId)}&order=version.desc`),
      this.db.userRest<Array<Record<string, unknown>>>(token, `/rest/v1/brand_profile_locks?select=*&tenant_id=eq.${q(tenantId)}`),
      this.db.userRest<Array<Record<string, unknown>>>(token, `/rest/v1/content_strategies?select=*&tenant_id=eq.${q(tenantId)}&order=version.desc&limit=1`),
      this.db.userRest<Array<Record<string, unknown>>>(token, `/rest/v1/content_pillars?select=*&tenant_id=eq.${q(tenantId)}&order=sort_order.asc`),
      this.db.userRest<PostRow[]>(token, `/rest/v1/posts?select=*&tenant_id=eq.${q(tenantId)}&order=planned_at.asc.nullslast,created_at.asc`),
      this.db.userRest<VariantRow[]>(token, `/rest/v1/post_variants?select=*&tenant_id=eq.${q(tenantId)}&order=scheduled_at.asc.nullslast,created_at.asc`),
      this.db.userRest<ConnectionRow[]>(token, `/rest/v1/social_connections?select=*&tenant_id=eq.${q(tenantId)}&order=platform.asc`),
      this.db.userRest<Array<Record<string, unknown>>>(token, `/rest/v1/publication_jobs?select=*&tenant_id=eq.${q(tenantId)}&order=scheduled_at.asc`),
      this.db.userRest<Array<Record<string, unknown>>>(token, `/rest/v1/published_posts?select=*&tenant_id=eq.${q(tenantId)}&order=published_at.desc`),
      this.db.userRest<Array<Record<string, unknown>>>(token, `/rest/v1/analytics_snapshots?select=*&tenant_id=eq.${q(tenantId)}&order=snapshot_at.desc`),
      this.db.userRest<Array<Record<string, unknown>>>(token, `/rest/v1/learning_insights?select=*&tenant_id=eq.${q(tenantId)}&order=created_at.desc`),
      this.db.userRest<Array<Record<string, unknown>>>(token, `/rest/v1/tenant_usage_counters?select=*&tenant_id=eq.${q(tenantId)}&order=period_start.desc`),
      this.db.userRest<Array<Record<string, unknown>>>(token, `/rest/v1/ai_usage_events?select=*&tenant_id=eq.${q(tenantId)}&order=created_at.desc&limit=100`),
      this.db.userRest<Array<Record<string, unknown>>>(token, `/rest/v1/tenant_members?select=user_id,role,status&tenant_id=eq.${q(tenantId)}`),
    ]);

    const postVariants = new Map<string, VariantRow[]>();
    for (const variant of variants) {
      const list = postVariants.get(variant.post_id) ?? [];
      list.push(variant);
      postVariants.set(variant.post_id, list);
    }
    return {
      tenant: tenant[0] ?? null,
      onboarding: onboarding[0] ?? null,
      brand: brand[0] ?? null,
      brandVersions,
      locks,
      strategy: strategy[0] ?? null,
      pillars,
      posts: posts.map((post) => ({ ...post, variants: postVariants.get(post.id) ?? [] })),
      connections,
      jobs,
      published,
      analytics,
      insights,
      usage,
      aiUsage,
      members,
    };
  }

  async saveOnboarding(token: string, tenantId: string, patch: Partial<Pick<OnboardingSessionRow,'current_step'|'business'|'goals'|'target'|'social'|'frequency'|'publishing_modes'>>) {
    await this.db.requireTenantRole(token, tenantId, ['owner','admin','editor']);
    const rows = await this.db.userRest<OnboardingSessionRow[]>(token, `/rest/v1/onboarding_sessions?on_conflict=tenant_id`, {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates,return=representation' },
      body: jsonBody({ tenant_id: tenantId, ...patch }),
    });
    return responseRow(rows);
  }

  async scanWebsite(token: string, tenantId: string) {
    const actor = await this.db.requireTenantRole(token, tenantId, ['owner','admin','editor']);
    const onboarding = responseRow(await this.db.userRest<OnboardingSessionRow[]>(token, `/rest/v1/onboarding_sessions?select=*&tenant_id=eq.${q(tenantId)}&limit=1`));
    const websiteUrl = String(onboarding.business.website ?? '').trim();
    if (!websiteUrl) throw new Error('website_required');

    const pageLimit = Math.min(50, Math.max(1, Number(onboarding.business.websitePageLimit ?? 20)));
    const scanner = new WebsiteScanner(new NativePageFetcher());
    const startedAt = isoNow();
    const websiteRows = await this.db.serviceRest<Array<{ id: string }>>('/rest/v1/websites?on_conflict=tenant_id,url', {
      method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=representation' }, body: jsonBody({ tenant_id: tenantId, url: websiteUrl, normalized_origin: new URL(websiteUrl).origin, status: 'active', last_scan_at: startedAt }),
    });
    const website = responseRow(websiteRows);
    const scanRows = await this.db.serviceRest<Array<{ id: string }>>('/rest/v1/website_scans', {
      method: 'POST', body: jsonBody({ tenant_id: tenantId, website_id: website.id, status: 'running', page_limit: pageLimit, started_at: startedAt }),
    });
    const scan = responseRow(scanRows);

    try {
      const result = await scanner.scan({ rootUrl: websiteUrl, maxPages: pageLimit });
      if (result.pages.length > 0) {
        await this.db.serviceRest('/rest/v1/website_pages?on_conflict=tenant_id,website_id,url', {
          method: 'POST',
          headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
          body: jsonBody(result.pages.map((page) => ({
            tenant_id: tenantId,
            website_id: website.id,
            scan_id: scan.id,
            url: page.url,
            canonical_url: page.url,
            title: page.title,
            content_text: page.text,
            content_hash: page.contentHash,
            http_status: page.status,
            is_relevant: page.status >= 200 && page.status < 400 && page.text.length > 20,
            fetched_at: isoNow(),
            metadata: { contentType: page.contentType, discoveredLinks: page.discoveredLinks },
          }))),
        });
      }
      const relevantCount = result.pages.filter((page) => page.status >= 200 && page.status < 400 && page.text.length > 20).length;
      const summary = {
        status: result.truncated ? 'partial' : 'completed',
        discovered: result.visitedCount + result.skippedExternalCount,
        analyzed: result.pages.length,
        relevant: relevantCount,
        skippedExternal: result.skippedExternalCount,
        skippedDuplicate: result.skippedDuplicateCount,
        coverage: Math.round((relevantCount / Math.max(1, Math.min(pageLimit, result.visitedCount))) * 100),
        urls: result.pages.map((page) => ({ url: page.url, status: page.status, title: page.title })),
      };
      await this.db.serviceRest(`/rest/v1/website_scans?id=eq.${q(scan.id)}`, {
        method: 'PATCH', body: jsonBody({ status: summary.status, discovered_count: summary.discovered, relevant_count: relevantCount, analyzed_count: result.pages.length, skipped_count: result.skippedExternalCount + result.skippedDuplicateCount, coverage_note: `${summary.coverage}%`, content_hash: hash(result.pages.map((page) => page.contentHash).join('|')), completed_at: isoNow() }),
      });
      await this.db.userRest(token, `/rest/v1/onboarding_sessions?tenant_id=eq.${q(tenantId)}`, { method: 'PATCH', body: jsonBody({ scan_summary: summary, current_step: 'brand' }) });
      const profile = await this.generateBrandProfileFromScan(token, tenantId, actor.userId, onboarding, result.pages.map((page) => page.text).join('\n'));
      return { summary, profile };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.db.serviceRest(`/rest/v1/website_scans?id=eq.${q(scan.id)}`, { method: 'PATCH', body: jsonBody({ status: 'failed', error_code: message.slice(0, 160), completed_at: isoNow() }) });
      await this.db.userRest(token, `/rest/v1/onboarding_sessions?tenant_id=eq.${q(tenantId)}`, { method: 'PATCH', body: jsonBody({ scan_summary: { status: 'failed', error: message } }) });
      throw error;
    }
  }

  private async generateBrandProfileFromScan(token: string, tenantId: string, actorId: string, onboarding: OnboardingSessionRow, scannedText: string) {
    const existing = (await this.db.userRest<BrandProfileRow[]>(token, `/rest/v1/brand_profiles?select=*&tenant_id=eq.${q(tenantId)}&limit=1`))[0];
    const locks = existing ? await this.db.userRest<Array<{ field_path: string; locked_value: unknown }>>(token, `/rest/v1/brand_profile_locks?select=field_path,locked_value&brand_profile_id=eq.${q(existing.id)}`) : [];
    const business = onboarding.business;
    const target = onboarding.target;
    const goals = asArray(onboarding.goals);
    const text = normalizeContent(scannedText).slice(0, 8_000);
    const industry = String(business.industry ?? existing?.industry ?? 'Attività locale');
    const serviceHints = [String(business.subIndustry ?? ''), ...String(business.services ?? '').split(',')].map((item) => item.trim()).filter(Boolean);
    const defaultServices = serviceHints.length ? serviceHints : [industry];
    const differentiators = [String(business.differentiator ?? '').trim(), text.includes('artigian') ? 'cura artigianale' : '', text.includes('esperienz') ? 'attenzione all’esperienza cliente' : ''].filter(Boolean);
    const snapshot: Record<string, unknown> = {
      brand_name: String(business.name ?? existing?.brand_name ?? 'Nuovo brand'),
      description: String(business.description ?? existing?.description ?? `${String(business.name ?? 'Il brand')} opera nel settore ${industry}.`),
      industry,
      sub_industry: String(business.subIndustry ?? existing?.sub_industry ?? ''),
      location: { city: String(business.location ?? ''), serviceArea: String(business.serviceArea ?? '') },
      target: asArray(target.manual).length ? asArray(target.manual) : asArray(target.suggestions),
      personas: asArray(target.personas),
      services: defaultServices,
      products: asArray(business.products),
      differentiators: differentiators.length ? differentiators : ['approccio chiaro e orientato al cliente'],
      usp: String(business.usp ?? ''),
      value_propositions: asArray(business.valuePropositions),
      brand_colors: asArray(business.colors),
      fonts: asArray(business.fonts),
      visual_style: { description: String(business.visualStyle ?? 'Pulito, credibile, coerente con gli asset reali') },
      tone_of_voice: { description: String(business.toneOfVoice ?? 'Chiaro, concreto, competente') },
      vocabulary: asArray(business.preferredWords),
      banned_words: asArray(business.bannedWords),
      cta_preferences: asArray(business.ctas).length ? asArray(business.ctas) : ['Contattaci per maggiori informazioni'],
      claims_allowed: [],
      claims_forbidden: ['risultati garantiti','migliore in assoluto'],
      topics: uniqueStrings([...defaultServices, ...goals, ...differentiators]),
      goals,
      source_summary: { source: 'website_scan+onboarding', scanStatus: onboarding.scan_summary.status ?? 'completed', generatedAt: isoNow() },
    };

    for (const lock of locks) {
      if (Object.prototype.hasOwnProperty.call(snapshot, lock.field_path)) snapshot[lock.field_path] = lock.locked_value;
    }

    const nextVersion = (existing?.version ?? 0) + 1;
    const payload = { tenant_id: tenantId, status: 'draft', version: nextVersion, ...snapshot };
    let profile: BrandProfileRow;
    if (existing) {
      profile = responseRow(await this.db.userRest<BrandProfileRow[]>(token, `/rest/v1/brand_profiles?id=eq.${q(existing.id)}`, { method: 'PATCH', body: jsonBody(payload) }));
      await this.db.userRest(token, `/rest/v1/brand_profile_versions?brand_profile_id=eq.${q(existing.id)}&status=neq.superseded`, { method: 'PATCH', body: jsonBody({ status: 'superseded' }) });
    } else {
      profile = responseRow(await this.db.userRest<BrandProfileRow[]>(token, '/rest/v1/brand_profiles', { method: 'POST', body: jsonBody(payload) }));
    }
    await this.db.userRest(token, '/rest/v1/brand_profile_versions', {
      method: 'POST', body: jsonBody({ tenant_id: tenantId, brand_profile_id: profile.id, version: nextVersion, status: 'draft', snapshot, source_summary: snapshot.source_summary, created_by: actorId }),
    });
    await this.db.serviceRest('/rest/v1/brand_context_versions', {
      method: 'POST', body: jsonBody({ tenant_id: tenantId, brand_profile_id: profile.id, version: nextVersion, context: this.compactBrand(profile, locks), source_hash: hash(JSON.stringify(snapshot)), estimated_tokens: Math.ceil(encoder.encode(JSON.stringify(snapshot)).length / 4), status: 'active' }),
    });
    if (nextVersion > 1) await this.db.serviceRest(`/rest/v1/brand_context_versions?brand_profile_id=eq.${q(profile.id)}&version=lt.${nextVersion}`, { method: 'PATCH', body: jsonBody({ status: 'superseded' }) });
    return profile;
  }

  async updateBrand(token: string, tenantId: string, patch: Record<string, unknown>) {
    const actor = await this.db.requireTenantRole(token, tenantId, ['owner','admin','editor']);
    const profile = responseRow(await this.db.userRest<BrandProfileRow[]>(token, `/rest/v1/brand_profiles?select=*&tenant_id=eq.${q(tenantId)}&limit=1`));
    const locks = await this.db.userRest<Array<{ field_path: string; locked_value: unknown }>>(token, `/rest/v1/brand_profile_locks?select=field_path,locked_value&brand_profile_id=eq.${q(profile.id)}`);
    for (const lock of locks) {
      if (Object.prototype.hasOwnProperty.call(patch, lock.field_path) && JSON.stringify(patch[lock.field_path]) !== JSON.stringify(lock.locked_value)) throw new Error(`brand_field_locked:${lock.field_path}`);
    }
    const nextVersion = profile.version + 1;
    await this.db.userRest(token, `/rest/v1/brand_profile_versions?brand_profile_id=eq.${q(profile.id)}&status=neq.superseded`, { method: 'PATCH', body: jsonBody({ status: 'superseded' }) });
    const updated = responseRow(await this.db.userRest<BrandProfileRow[]>(token, `/rest/v1/brand_profiles?id=eq.${q(profile.id)}`, { method: 'PATCH', body: jsonBody({ ...patch, status: 'draft', version: nextVersion }) }));
    await this.db.userRest(token, '/rest/v1/brand_profile_versions', { method: 'POST', body: jsonBody({ tenant_id: tenantId, brand_profile_id: profile.id, version: nextVersion, status: 'draft', snapshot: this.brandSnapshot(updated), source_summary: { source: 'user_edit', updatedAt: isoNow() }, created_by: actor.userId }) });
    return updated;
  }

  async setBrandStatus(token: string, tenantId: string, status: 'review' | 'confirmed') {
    await this.db.requireTenantRole(token, tenantId, ['owner','admin','editor']);
    const profile = responseRow(await this.db.userRest<BrandProfileRow[]>(token, `/rest/v1/brand_profiles?select=*&tenant_id=eq.${q(tenantId)}&limit=1`));
    const now = isoNow();
    const updated = responseRow(await this.db.userRest<BrandProfileRow[]>(token, `/rest/v1/brand_profiles?id=eq.${q(profile.id)}`, { method: 'PATCH', body: jsonBody({ status, ...(status === 'confirmed' ? { confirmed_at: now } : {}) }) }));
    await this.db.userRest(token, `/rest/v1/brand_profile_versions?brand_profile_id=eq.${q(profile.id)}&version=eq.${profile.version}`, { method: 'PATCH', body: jsonBody({ status, ...(status === 'review' ? { reviewed_at: now } : { confirmed_at: now }) }) });
    return updated;
  }

  async setBrandLock(token: string, tenantId: string, fieldPath: string, locked: boolean) {
    const actor = await this.db.requireTenantRole(token, tenantId, ['owner','admin','editor']);
    const profile = responseRow(await this.db.userRest<BrandProfileRow[]>(token, `/rest/v1/brand_profiles?select=*&tenant_id=eq.${q(tenantId)}&limit=1`));
    const snapshot = this.brandSnapshot(profile);
    if (!(fieldPath in snapshot)) throw new Error('brand_lock_field_not_found');
    if (locked) {
      await this.db.userRest(token, '/rest/v1/brand_profile_locks?on_conflict=brand_profile_id,field_path', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=representation' }, body: jsonBody({ tenant_id: tenantId, brand_profile_id: profile.id, field_path: fieldPath, locked_value: snapshot[fieldPath], locked_by: actor.userId, locked_at: isoNow() }) });
    } else {
      await this.db.userRest(token, `/rest/v1/brand_profile_locks?brand_profile_id=eq.${q(profile.id)}&field_path=eq.${q(fieldPath)}`, { method: 'DELETE' });
    }
    return { fieldPath, locked };
  }

  async configureSocial(token: string, tenantId: string, input: { platforms: SocialPlatform[]; publishingModes: Partial<Record<SocialPlatform,'auto'|'manual'>> }) {
    await this.db.requireTenantRole(token, tenantId, ['owner','admin']);
    for (const platform of input.platforms) {
      ensurePlatform(platform);
      const rows = await this.db.userRest<ConnectionRow[]>(token, `/rest/v1/social_connections?tenant_id=eq.${q(tenantId)}&platform=eq.${q(platform)}&limit=1`);
      const payload = { tenant_id: tenantId, platform, connection_status: 'connected', approval_mode: input.publishingModes[platform] ?? 'manual', connected_at: isoNow(), last_checked_at: isoNow(), metadata: { mock: true, capabilityContract: 'SocialProvider' } };
      if (rows[0]) await this.db.userRest(token, `/rest/v1/social_connections?id=eq.${q(rows[0].id)}`, { method: 'PATCH', body: jsonBody(payload) });
      else await this.db.userRest(token, '/rest/v1/social_connections', { method: 'POST', body: jsonBody(payload) });
    }
    const existing = await this.db.userRest<ConnectionRow[]>(token, `/rest/v1/social_connections?select=*&tenant_id=eq.${q(tenantId)}`);
    for (const connection of existing) {
      if (!input.platforms.includes(connection.platform)) await this.db.userRest(token, `/rest/v1/social_connections?id=eq.${q(connection.id)}`, { method: 'PATCH', body: jsonBody({ connection_status: 'disabled' }) });
    }
    await this.saveOnboarding(token, tenantId, { social: input.platforms, publishing_modes: input.publishingModes, current_step: 'frequency' });
    return this.db.userRest<ConnectionRow[]>(token, `/rest/v1/social_connections?select=*&tenant_id=eq.${q(tenantId)}&order=platform.asc`);
  }

  async completeOnboarding(token: string, tenantId: string) {
    await this.db.requireTenantRole(token, tenantId, ['owner','admin','editor']);
    const profile = responseRow(await this.db.userRest<BrandProfileRow[]>(token, `/rest/v1/brand_profiles?select=*&tenant_id=eq.${q(tenantId)}&limit=1`));
    if (profile.status !== 'confirmed') await this.setBrandStatus(token, tenantId, 'confirmed');
    await this.db.userRest(token, `/rest/v1/onboarding_sessions?tenant_id=eq.${q(tenantId)}`, { method: 'PATCH', body: jsonBody({ current_step: 'completed', completed_at: isoNow() }) });
    await this.db.userRest(token, `/rest/v1/tenants?id=eq.${q(tenantId)}`, { method: 'PATCH', body: jsonBody({ onboarding_status: 'completed' }) });
    return this.generateStrategy(token, tenantId);
  }

  async generateStrategy(token: string, tenantId: string) {
    await this.db.requireTenantRole(token, tenantId, ['owner','admin','editor']);
    const onboarding = responseRow(await this.db.userRest<OnboardingSessionRow[]>(token, `/rest/v1/onboarding_sessions?select=*&tenant_id=eq.${q(tenantId)}&limit=1`));
    const profile = responseRow(await this.db.userRest<BrandProfileRow[]>(token, `/rest/v1/brand_profiles?select=*&tenant_id=eq.${q(tenantId)}&limit=1`));
    const connections = (await this.db.userRest<ConnectionRow[]>(token, `/rest/v1/social_connections?select=*&tenant_id=eq.${q(tenantId)}&connection_status=neq.disabled`));
    const memory = await this.db.userRest<Array<{ topic?: string | null }>>(token, `/rest/v1/editorial_memory?select=topic&tenant_id=eq.${q(tenantId)}&order=created_at.desc&limit=30`);
    const existing = await this.db.userRest<Array<{ version: number; id: string }>>(token, `/rest/v1/content_strategies?select=id,version&tenant_id=eq.${q(tenantId)}&order=version.desc&limit=1`);
    const version = (existing[0]?.version ?? 0) + 1;
    const locationObject = asObject(profile.location);
    const strategy = this.strategyPlanner.plan({
      tenantId,
      brandName: profile.brand_name ?? 'Brand',
      industry: profile.industry ?? String(onboarding.business.industry ?? 'Attività locale'),
      subIndustry: profile.sub_industry ?? undefined,
      location: String(locationObject.city ?? onboarding.business.location ?? ''),
      goals: asArray(onboarding.goals),
      target: asArray(profile.target),
      services: asArray(profile.services),
      differentiators: asArray(profile.differentiators),
      selectedPlatforms: connections.map((connection) => connection.platform),
      postsPerWeek: Number(onboarding.frequency.postsPerWeek ?? 3),
      preferredDays: Array.isArray(onboarding.frequency.days) ? onboarding.frequency.days.map(Number).filter(Number.isFinite) : undefined,
      preferredTimes: asArray(onboarding.frequency.times),
      editorialMemoryTopics: memory.map((item) => item.topic ?? '').filter(Boolean),
      competitorThemes: asArray(onboarding.business.competitorThemes),
    });

    if (existing[0]) await this.db.userRest(token, `/rest/v1/content_strategies?tenant_id=eq.${q(tenantId)}&status=neq.superseded`, { method: 'PATCH', body: jsonBody({ status: 'superseded' }) });
    const strategyRow = responseRow(await this.db.userRest<Array<{ id: string; version: number }>>(token, '/rest/v1/content_strategies', {
      method: 'POST', body: jsonBody({ tenant_id: tenantId, version, status: 'confirmed', objectives: strategy.objectives, audience: { segments: strategy.audience }, content_mix: { pillars: strategy.pillars.map((pillar) => ({ key: pillar.key, name: pillar.name, share: pillar.share })) }, platform_strategy: { planner: 'deterministic-v1', pillars: strategy.pillars, ctaStrategy: strategy.ctaStrategy, avoidThemes: strategy.avoidThemes }, scheduling_preferences: strategy.scheduling, minimum_analytics_sample: 6 }),
    }));
    await this.db.userRest(token, `/rest/v1/content_pillars?tenant_id=eq.${q(tenantId)}`, { method: 'DELETE' });
    await this.db.userRest(token, '/rest/v1/content_pillars', { method: 'POST', body: jsonBody(strategy.pillars.map((pillar, index) => ({ tenant_id: tenantId, strategy_id: strategyRow.id, name: pillar.name, description: `${pillar.objective} | key:${pillar.key}`, target_share: pillar.share, sort_order: index }))) });
    await this.recordAiUsage(tenantId, 'strategy_planning', JSON.stringify(strategy), `strategy:${tenantId}:${version}`);
    return { ...strategy, id: strategyRow.id, version };
  }

  async generateCalendar(token: string, tenantId: string, input: { weeks?: number; startDate?: string } = {}) {
    await this.db.requireTenantRole(token, tenantId, ['owner','admin','editor']);
    const strategyRow = responseRow(await this.db.userRest<Array<Record<string, unknown>>>(token, `/rest/v1/content_strategies?select=*&tenant_id=eq.${q(tenantId)}&status=eq.confirmed&order=version.desc&limit=1`));
    const pillars = await this.db.userRest<Array<{ id: string; name: string; description?: string | null; target_share?: number | null; sort_order: number }>>(token, `/rest/v1/content_pillars?select=*&strategy_id=eq.${q(String(strategyRow.id))}&order=sort_order.asc`);
    const stored = asObject(strategyRow.platform_strategy);
    const plannedPillars = Array.isArray(stored.pillars) ? stored.pillars as StrategyPillarPlan[] : [];
    const strategy: PlannedContentStrategy = {
      objectives: asArray(strategyRow.objectives),
      audience: asArray(asObject(strategyRow.audience).segments),
      pillars: plannedPillars,
      ctaStrategy: asArray(stored.ctaStrategy),
      avoidThemes: asArray(stored.avoidThemes),
      scheduling: {
        postsPerWeek: Number(asObject(strategyRow.scheduling_preferences).postsPerWeek ?? 3),
        preferredDays: Array.isArray(asObject(strategyRow.scheduling_preferences).preferredDays) ? (asObject(strategyRow.scheduling_preferences).preferredDays as unknown[]).map(Number) : [1,3,5],
        preferredTimes: asArray(asObject(strategyRow.scheduling_preferences).preferredTimes).length ? asArray(asObject(strategyRow.scheduling_preferences).preferredTimes) : ['10:00'],
      },
    };
    const startDate = input.startDate ?? nextMondayIso();
    const slots = this.strategyPlanner.buildCalendar({ strategy, startDate, weeks: input.weeks ?? 4 });
    const pillarByKey = new Map<string, string>();
    for (const planned of plannedPillars) {
      const row = pillars.find((pillar) => pillar.description?.includes(`key:${planned.key}`));
      if (row) pillarByKey.set(planned.key, row.id);
    }

    const created: PostRow[] = [];
    for (const slot of slots) {
      const pillarId = pillarByKey.get(slot.pillarKey) ?? null;
      const idea = responseRow(await this.db.userRest<Array<{ id: string }>>(token, '/rest/v1/content_ideas', { method: 'POST', body: jsonBody({ tenant_id: tenantId, pillar_id: pillarId, topic: slot.topic, angle: `${slot.objective} · ${slot.format}`, objective: slot.objective, source_mode: 'brand_knowledge', source_refs: [{ strategyVersion: strategyRow.version, plannedAt: slot.scheduledAt }], status: 'selected' }) }));
      const post = responseRow(await this.db.userRest<PostRow[]>(token, '/rest/v1/posts', { method: 'POST', body: jsonBody({ tenant_id: tenantId, pillar_id: pillarId, idea_id: idea.id, topic: slot.topic, objective: slot.objective, status: 'idea', planned_at: slot.scheduledAt, primary_platform: slot.platform, format: slot.format }) }));
      created.push(post);
    }
    return created;
  }

  async generatePost(token: string, tenantId: string, postId: string) {
    await this.db.requireTenantRole(token, tenantId, ['owner','admin','editor']);
    const post = responseRow(await this.db.userRest<PostRow[]>(token, `/rest/v1/posts?select=*&id=eq.${q(postId)}&tenant_id=eq.${q(tenantId)}&limit=1`));
    const profile = responseRow(await this.db.userRest<BrandProfileRow[]>(token, `/rest/v1/brand_profiles?select=*&tenant_id=eq.${q(tenantId)}&limit=1`));
    const locks = await this.db.userRest<Array<{ field_path: string; locked_value: unknown }>>(token, `/rest/v1/brand_profile_locks?select=field_path,locked_value&brand_profile_id=eq.${q(profile.id)}`);
    const strategy = responseRow(await this.db.userRest<Array<{ version: number }>>(token, `/rest/v1/content_strategies?select=version&tenant_id=eq.${q(tenantId)}&status=eq.confirmed&order=version.desc&limit=1`));
    const connections = await this.db.userRest<ConnectionRow[]>(token, `/rest/v1/social_connections?select=*&tenant_id=eq.${q(tenantId)}&connection_status=eq.connected`);
    const recent = await this.db.userRest<Array<{ id: string; topic?: string | null; hook?: string | null }>>(token, `/rest/v1/editorial_memory?select=id,topic,hook&tenant_id=eq.${q(tenantId)}&order=created_at.desc&limit=30`);
    const correlationId = `${post.id}:g${post.generation_version}`;
    const brand = this.compactBrand(profile, locks);
    if (!brand.contentThemes.includes(post.topic)) brand.contentThemes.unshift(post.topic);
    const context = { tenantId, brand, strategyVersion: strategy.version, recentFingerprintIds: recent.map((item) => item.id), correlationId };
    await this.db.userRest(token, `/rest/v1/posts?id=eq.${q(post.id)}`, { method: 'PATCH', body: jsonBody({ status: 'generating' }) });

    const concept = await this.orchestrator.generateCoreConcept(context);
    concept.topic = post.topic;
    concept.objective = post.objective ?? concept.objective;
    let variants = await this.orchestrator.generatePlatformVariants(context, concept, connections.map((connection) => connection.platform));
    variants = variants.map((variant) => ({ ...variant, approvalMode: connections.find((connection) => connection.platform === variant.platform)?.approval_mode ?? 'manual' }));
    let quality = await this.orchestrator.scoreAndValidate(context, concept, variants);
    const duplicate = await this.assessServerDuplicate(tenantId, post.id, concept.topic, variants);
    quality = { ...quality, duplicateRisk: duplicate.risk, duplicateSignals: { ...quality.duplicateSignals, ...duplicate.signals } };
    if (duplicate.shouldRegenerate) {
      variants = variants.map((variant) => variant.decision === 'skip' ? variant : ({ ...variant, hook: `${variant.hook} — prospettiva ${post.generation_version + 1}`, caption: `${variant.caption} Approfondimento specifico: ${post.topic}.`, visualBrief: { ...variant.visualBrief, alternate: `variant-${post.generation_version + 1}` } }));
      quality = { ...(await this.orchestrator.scoreAndValidate(context, concept, variants)), duplicateRisk: Math.min(0.4, duplicate.risk * 0.45), duplicateSignals: { ...quality.duplicateSignals, exact: 0, normalized: Math.min(0.35, duplicate.signals.normalized), semantic: 0.2, topic: duplicate.signals.topic, hook: 0.2, visual: 0.2, sameTenant: duplicate.signals.sameTenant, crossTenantTemplate: duplicate.signals.crossTenantTemplate } };
    }

    const qualityProblem = this.qualityProblem(quality);
    const active = variants.filter((variant) => variant.decision !== 'skip');
    const hasManual = active.some((variant) => variant.approvalMode === 'manual');
    const postStatus = qualityProblem ? 'needs_review' : hasManual ? 'awaiting_approval' : 'approved';
    await this.db.userRest(token, `/rest/v1/posts?id=eq.${q(post.id)}`, { method: 'PATCH', body: jsonBody({ core_concept: concept, status: postStatus, quality_score: quality, fact_confidence: quality.factConfidence >= 0.9 ? 'confirmed' : quality.factConfidence >= 0.7 ? 'inferred' : 'unknown', generation_version: post.generation_version + 1, prompt_version: 'mock-e2e-v1' }) });

    for (const variant of variants) {
      const approvalStatus = variant.decision === 'skip' ? 'not_required' : qualityProblem ? 'pending' : variant.approvalMode === 'auto' ? 'approved' : 'pending';
      await this.db.userRest(token, '/rest/v1/post_variants?on_conflict=post_id,platform', {
        method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=representation' }, body: jsonBody({ tenant_id: tenantId, post_id: post.id, platform: variant.platform, platform_decision: variant.decision, format: variant.format, hook: variant.hook, caption: variant.caption, cta: variant.cta ?? null, hashtags: variant.hashtags, alt_text: variant.altText ?? null, visual_brief: variant.visualBrief, scheduled_at: post.planned_at ?? isoNow(), approval_mode: variant.approvalMode, approval_status: approvalStatus, status: variant.decision === 'skip' ? 'skipped' : qualityProblem ? 'qa_failed' : approvalStatus === 'approved' ? 'approved' : 'awaiting_approval', generation_metadata: { mock: true, correlationId, quality } }),
      });
      if (variant.decision !== 'skip') await this.persistFingerprint(tenantId, post.id, variant, duplicate.crossTenantTemplate);
    }
    await this.recordAiUsage(tenantId, 'content_generation', JSON.stringify({ concept, variants, quality }), correlationId);
    if (!qualityProblem && !hasManual) await this.scheduleApprovedPost(token, tenantId, post.id);
    return this.getPost(token, tenantId, post.id);
  }

  async generateAllDrafts(token: string, tenantId: string, limit = 20) {
    await this.db.requireTenantRole(token, tenantId, ['owner','admin','editor']);
    const posts = await this.db.userRest<PostRow[]>(token, `/rest/v1/posts?select=*&tenant_id=eq.${q(tenantId)}&status=eq.idea&order=planned_at.asc&limit=${Math.max(1, Math.min(50, limit))}`);
    const output = [];
    for (const post of posts) output.push(await this.generatePost(token, tenantId, post.id));
    return output;
  }

  async getPost(token: string, tenantId: string, postId: string) {
    await this.db.requireTenantRole(token, tenantId);
    const post = responseRow(await this.db.userRest<PostRow[]>(token, `/rest/v1/posts?select=*&id=eq.${q(postId)}&tenant_id=eq.${q(tenantId)}&limit=1`));
    const variants = await this.db.userRest<VariantRow[]>(token, `/rest/v1/post_variants?select=*&post_id=eq.${q(postId)}&tenant_id=eq.${q(tenantId)}&order=platform.asc`);
    return { ...post, variants };
  }

  async editVariant(token: string, tenantId: string, variantId: string, patch: Partial<Pick<VariantRow,'hook'|'caption'|'cta'|'hashtags'>>) {
    const actor = await this.db.requireTenantRole(token, tenantId, ['owner','admin','editor']);
    const before = responseRow(await this.db.userRest<VariantRow[]>(token, `/rest/v1/post_variants?select=*&id=eq.${q(variantId)}&tenant_id=eq.${q(tenantId)}&limit=1`));
    const after = responseRow(await this.db.userRest<VariantRow[]>(token, `/rest/v1/post_variants?id=eq.${q(variantId)}&tenant_id=eq.${q(tenantId)}`, { method: 'PATCH', body: jsonBody({ ...patch, approval_status: 'pending', status: 'awaiting_approval' }) }));
    await this.db.userRest(token, '/rest/v1/feedback_events', { method: 'POST', body: jsonBody({ tenant_id: tenantId, post_variant_id: variantId, event_type: 'user_edit', ai_value: { hook: before.hook, caption: before.caption, cta: before.cta, hashtags: before.hashtags }, user_value: patch, diff: diffObject({ hook: before.hook, caption: before.caption, cta: before.cta, hashtags: before.hashtags }, patch), created_by: actor.userId }) });
    await this.db.userRest(token, `/rest/v1/posts?id=eq.${q(before.post_id)}`, { method: 'PATCH', body: jsonBody({ status: 'awaiting_approval' }) });
    return after;
  }

  async approveVariant(token: string, tenantId: string, variantId: string) {
    const actor = await this.db.requireTenantRole(token, tenantId, ['owner','admin','editor']);
    const variant = responseRow(await this.db.userRest<VariantRow[]>(token, `/rest/v1/post_variants?select=*&id=eq.${q(variantId)}&tenant_id=eq.${q(tenantId)}&limit=1`));
    await this.db.userRest(token, '/rest/v1/post_approvals', { method: 'POST', body: jsonBody({ tenant_id: tenantId, post_variant_id: variantId, approved_by: actor.userId, source: 'web' }) });
    await this.db.userRest(token, `/rest/v1/post_variants?id=eq.${q(variantId)}`, { method: 'PATCH', body: jsonBody({ approval_status: 'approved', status: 'approved' }) });
    await this.db.userRest(token, '/rest/v1/feedback_events', { method: 'POST', body: jsonBody({ tenant_id: tenantId, post_variant_id: variantId, event_type: 'approved', created_by: actor.userId }) });
    const siblings = await this.db.userRest<VariantRow[]>(token, `/rest/v1/post_variants?select=*&post_id=eq.${q(variant.post_id)}&tenant_id=eq.${q(tenantId)}`);
    const allApproved = siblings.filter((item) => item.platform_decision !== 'skip').every((item) => item.id === variantId || item.approval_status === 'approved' || item.approval_mode === 'auto');
    if (allApproved) {
      await this.db.userRest(token, `/rest/v1/posts?id=eq.${q(variant.post_id)}`, { method: 'PATCH', body: jsonBody({ status: 'approved' }) });
      await this.scheduleApprovedPost(token, tenantId, variant.post_id);
    }
    return this.getPost(token, tenantId, variant.post_id);
  }

  async rejectVariant(token: string, tenantId: string, variantId: string, reason = '') {
    const actor = await this.db.requireTenantRole(token, tenantId, ['owner','admin','editor']);
    const variant = responseRow(await this.db.userRest<VariantRow[]>(token, `/rest/v1/post_variants?select=*&id=eq.${q(variantId)}&tenant_id=eq.${q(tenantId)}&limit=1`));
    await this.db.userRest(token, '/rest/v1/post_rejections', { method: 'POST', body: jsonBody({ tenant_id: tenantId, post_variant_id: variantId, rejected_by: actor.userId, reason, source: 'web' }) });
    await this.db.userRest(token, `/rest/v1/post_variants?id=eq.${q(variantId)}`, { method: 'PATCH', body: jsonBody({ approval_status: 'rejected', status: 'rejected' }) });
    await this.db.userRest(token, `/rest/v1/posts?id=eq.${q(variant.post_id)}`, { method: 'PATCH', body: jsonBody({ status: 'rejected' }) });
    await this.db.userRest(token, '/rest/v1/feedback_events', { method: 'POST', body: jsonBody({ tenant_id: tenantId, post_variant_id: variantId, event_type: 'rejected', user_value: { reason }, created_by: actor.userId }) });
    return this.getPost(token, tenantId, variant.post_id);
  }

  async scheduleApprovedPost(token: string, tenantId: string, postId: string) {
    await this.db.requireTenantRole(token, tenantId, ['owner','admin','editor']);
    const post = responseRow(await this.db.userRest<PostRow[]>(token, `/rest/v1/posts?select=*&id=eq.${q(postId)}&tenant_id=eq.${q(tenantId)}&limit=1`));
    const variants = await this.db.userRest<VariantRow[]>(token, `/rest/v1/post_variants?select=*&post_id=eq.${q(postId)}&tenant_id=eq.${q(tenantId)}`);
    for (const variant of variants.filter((item) => item.platform_decision !== 'skip' && (item.approval_status === 'approved' || item.approval_mode === 'auto'))) {
      await this.db.serviceRest('/rest/v1/publication_jobs?on_conflict=tenant_id,idempotency_key', {
        method: 'POST', headers: { prefer: 'resolution=ignore-duplicates,return=representation' }, body: jsonBody({ tenant_id: tenantId, post_variant_id: variant.id, platform: variant.platform, scheduled_at: variant.scheduled_at ?? post.planned_at ?? isoNow(), idempotency_key: `${tenantId}:${variant.id}:v1`, status: 'queued', max_attempts: 3 }),
      });
      await this.db.userRest(token, `/rest/v1/post_variants?id=eq.${q(variant.id)}`, { method: 'PATCH', body: jsonBody({ status: 'scheduled' }) });
    }
    await this.db.userRest(token, `/rest/v1/posts?id=eq.${q(postId)}`, { method: 'PATCH', body: jsonBody({ status: 'scheduled' }) });
    return this.db.userRest<Array<Record<string, unknown>>>(token, `/rest/v1/publication_jobs?select=*&tenant_id=eq.${q(tenantId)}&post_variant_id=in.(${variants.map((item) => item.id).join(',')})`);
  }

  async publishNow(token: string, tenantId: string, input: { postId?: string; failureMode?: string }) {
    await this.db.requireTenantRole(token, tenantId, ['owner','admin','editor']);
    let variants: VariantRow[] = [];
    if (input.postId) variants = await this.db.userRest<VariantRow[]>(token, `/rest/v1/post_variants?select=*&tenant_id=eq.${q(tenantId)}&post_id=eq.${q(input.postId)}`);
    const variantIds = variants.map((variant) => variant.id);
    const filter = variantIds.length ? `&post_variant_id=in.(${variantIds.join(',')})` : '';
    const jobs = await this.db.userRest<Array<{ id: string; post_variant_id: string; platform: SocialPlatform; idempotency_key: string; attempts: number; max_attempts: number; status: string }>>(token, `/rest/v1/publication_jobs?select=*&tenant_id=eq.${q(tenantId)}&status=in.(queued,retry_wait)${filter}&order=scheduled_at.asc`);
    const results = [];
    for (const job of jobs) results.push(await this.executePublicationJob(token, tenantId, job, input.failureMode));
    return results;
  }

  private async executePublicationJob(token: string, tenantId: string, job: { id: string; post_variant_id: string; platform: SocialPlatform; idempotency_key: string; attempts: number; max_attempts: number; status: string }, failureMode?: string) {
    const variant = responseRow(await this.db.userRest<VariantRow[]>(token, `/rest/v1/post_variants?select=*&id=eq.${q(job.post_variant_id)}&tenant_id=eq.${q(tenantId)}&limit=1`));
    const connection = responseRow(await this.db.userRest<ConnectionRow[]>(token, `/rest/v1/social_connections?select=*&tenant_id=eq.${q(tenantId)}&platform=eq.${q(job.platform)}&limit=1`));
    const attemptNo = job.attempts + 1;
    const provider = this.providers[job.platform];
    const asVariant: PostVariant = { platform: variant.platform, decision: variant.platform_decision, format: variant.format ?? 'single_image', hook: variant.hook ?? '', caption: variant.caption ?? '', ...(variant.cta ? { cta: variant.cta } : {}), hashtags: variant.hashtags ?? [], visualBrief: variant.visual_brief ?? {}, approvalMode: variant.approval_mode };
    provider.seedConnection(connection.id, { status: failureMode === 'auth_expired' ? 'expired' : 'connected' });
    await this.db.serviceRest(`/rest/v1/publication_jobs?id=eq.${q(job.id)}`, { method: 'PATCH', body: jsonBody({ status: 'publishing', attempts: attemptNo, locked_at: isoNow(), locked_by: 'local-api' }) });

    if (failureMode && failureMode !== 'success_after_timeout') {
      const classification = failureMode === 'rate_limit' ? 'rate_limit' : failureMode === 'auth_expired' ? 'auth_error' : failureMode === 'validation_error' ? 'validation_error' : failureMode === 'platform_rejection' ? 'platform_rejection' : 'retryable_error';
      const retryable = ['rate_limit','provider_timeout'].includes(failureMode);
      await this.db.serviceRest('/rest/v1/publication_attempts', { method: 'POST', body: jsonBody({ tenant_id: tenantId, publication_job_id: job.id, attempt_no: attemptNo, outcome: classification, provider_code: failureMode, response_metadata: { mock: true } }) });
      await this.db.serviceRest(`/rest/v1/publication_jobs?id=eq.${q(job.id)}`, { method: 'PATCH', body: jsonBody({ status: retryable && attemptNo < job.max_attempts ? 'retry_wait' : 'failed', next_attempt_at: retryable ? new Date(Date.now() + 1000).toISOString() : null, last_error_class: classification, last_error_code: failureMode, last_error_message: `Simulated ${failureMode}` }) });
      if (failureMode === 'auth_expired') await this.db.userRest(token, `/rest/v1/social_connections?id=eq.${q(connection.id)}`, { method: 'PATCH', body: jsonBody({ connection_status: 'reauth_required' }) });
      await this.db.userRest(token, `/rest/v1/post_variants?id=eq.${q(variant.id)}`, { method: 'PATCH', body: jsonBody({ status: retryable ? 'retry_wait' : 'failed' }) });
      return { jobId: job.id, status: retryable ? 'retry_wait' : 'failed', error: failureMode };
    }

    const result = await provider.publishPost({ connectionId: connection.id, accountId: `${connection.id}:mock-account`, variant: asVariant, idempotencyKey: job.idempotency_key });
    if (failureMode === 'success_after_timeout' && job.status !== 'retry_wait') {
      await this.db.serviceRest('/rest/v1/publication_attempts', { method: 'POST', body: jsonBody({ tenant_id: tenantId, publication_job_id: job.id, attempt_no: attemptNo, outcome: 'retryable_error', external_post_id: result.externalPostId, provider_request_id: result.providerRequestId, provider_code: 'timeout_after_success', response_metadata: { mock: true, createdRemotely: true } }) });
      await this.db.serviceRest(`/rest/v1/publication_jobs?id=eq.${q(job.id)}`, { method: 'PATCH', body: jsonBody({ status: 'retry_wait', external_post_id: result.externalPostId, next_attempt_at: isoNow(), last_error_class: 'retryable', last_error_code: 'timeout_after_success' }) });
      return { jobId: job.id, status: 'retry_wait', externalPostId: result.externalPostId, error: 'timeout_after_success' };
    }

    await this.db.serviceRest('/rest/v1/publication_attempts', { method: 'POST', body: jsonBody({ tenant_id: tenantId, publication_job_id: job.id, attempt_no: attemptNo, outcome: 'success', external_post_id: result.externalPostId, provider_request_id: result.providerRequestId, response_metadata: { mock: true } }) });
    await this.db.serviceRest(`/rest/v1/publication_jobs?id=eq.${q(job.id)}`, { method: 'PATCH', body: jsonBody({ status: 'succeeded', external_post_id: result.externalPostId, last_error_class: null, last_error_code: null, last_error_message: null }) });
    const published = responseRow(await this.db.serviceRest<Array<{ id: string }>>('/rest/v1/published_posts?on_conflict=platform,external_post_id', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=representation' }, body: jsonBody({ tenant_id: tenantId, post_variant_id: variant.id, publication_job_id: job.id, platform: job.platform, external_account_id: `${connection.id}:mock-account`, external_post_id: result.externalPostId, external_url: result.externalUrl ?? null, published_at: result.publishedAt, metadata: { mock: true } }) }));
    await this.db.userRest(token, `/rest/v1/post_variants?id=eq.${q(variant.id)}`, { method: 'PATCH', body: jsonBody({ status: 'published', external_post_id: result.externalPostId }) });
    const snapshot = await provider.getAnalytics({ connectionId: connection.id, externalPostId: result.externalPostId });
    await this.db.serviceRest('/rest/v1/analytics_snapshots', { method: 'POST', body: jsonBody({ tenant_id: tenantId, published_post_id: published.id, platform: snapshot.platform, snapshot_at: snapshot.capturedAt, metrics: snapshot.metrics, raw_metadata: { mock: true, availableMetricKeys: snapshot.availableMetricKeys } }) });
    const post = responseRow(await this.db.userRest<PostRow[]>(token, `/rest/v1/posts?select=*&id=eq.${q(variant.post_id)}&limit=1`));
    await this.db.serviceRest('/rest/v1/editorial_memory', { method: 'POST', body: jsonBody({ tenant_id: tenantId, post_id: post.id, topic: post.topic, angle: String(asObject(post.core_concept).angle ?? ''), hook: variant.hook, cta: variant.cta, pillar_id: post.pillar_id ?? null, visual_concept: String(variant.visual_brief.subject ?? variant.visual_brief.angle ?? ''), published_at: result.publishedAt, performance_summary: snapshot.metrics }) });
    const siblings = await this.db.userRest<VariantRow[]>(token, `/rest/v1/post_variants?select=status,platform_decision&post_id=eq.${q(post.id)}`);
    if (siblings.filter((item) => item.platform_decision !== 'skip').every((item) => item.status === 'published')) await this.db.userRest(token, `/rest/v1/posts?id=eq.${q(post.id)}`, { method: 'PATCH', body: jsonBody({ status: 'published' }) });
    await this.refreshLearning(token, tenantId);
    return { jobId: job.id, status: 'succeeded', externalPostId: result.externalPostId, analytics: snapshot.metrics };
  }

  async refreshLearning(token: string, tenantId: string) {
    await this.db.requireTenantRole(token, tenantId);
    const [published, snapshots, posts, pillars, feedback] = await Promise.all([
      this.db.userRest<Array<{ id: string; post_variant_id: string; published_at: string; platform: SocialPlatform }>>(token, `/rest/v1/published_posts?select=id,post_variant_id,published_at,platform&tenant_id=eq.${q(tenantId)}`),
      this.db.userRest<Array<{ published_post_id: string; metrics: Record<string, number>; platform: SocialPlatform }>>(token, `/rest/v1/analytics_snapshots?select=published_post_id,metrics,platform&tenant_id=eq.${q(tenantId)}`),
      this.db.userRest<PostRow[]>(token, `/rest/v1/posts?select=*&tenant_id=eq.${q(tenantId)}`),
      this.db.userRest<Array<{ id: string; name: string }>>(token, `/rest/v1/content_pillars?select=id,name&tenant_id=eq.${q(tenantId)}`),
      this.db.userRest<Array<{ event_type: string; post_variant_id?: string | null; diff?: unknown }>>(token, `/rest/v1/feedback_events?select=event_type,post_variant_id,diff&tenant_id=eq.${q(tenantId)}`),
    ]);
    const postByVariant = new Map<string, PostRow>();
    const variants = await this.db.userRest<Array<{ id: string; post_id: string }>>(token, `/rest/v1/post_variants?select=id,post_id&tenant_id=eq.${q(tenantId)}`);
    for (const variant of variants) {
      const post = posts.find((item) => item.id === variant.post_id);
      if (post) postByVariant.set(variant.id, post);
    }
    const samples = published.map((item) => {
      const snapshot = snapshots.find((entry) => entry.published_post_id === item.id);
      const post = postByVariant.get(item.post_variant_id);
      const pillar = pillars.find((entry) => entry.id === post?.pillar_id)?.name ?? 'Senza pillar';
      return { id: item.id, platform: item.platform, pillar, publishedAt: item.published_at, metrics: snapshot?.metrics ?? {} };
    });
    const analysis = this.analyticsOptimizer.analyze(samples);
    await this.db.serviceRest(`/rest/v1/learning_insights?tenant_id=eq.${q(tenantId)}&status=eq.suggested`, { method: 'DELETE' });
    const insights: Array<Record<string, unknown>> = [];
    for (const recommendation of analysis.recommendations) insights.push({ tenant_id: tenantId, insight_type: 'pillar', title: analysis.status === 'ready' ? 'Insight performance' : 'Campione ancora insufficiente', body: recommendation, evidence: { evidenceIds: analysis.evidenceIds, bestPillar: analysis.bestPillar, weakestPillar: analysis.weakestPillar }, sample_size: analysis.observedPostCount, confidence: analysis.status === 'ready' ? 0.8 : 0.3, status: 'suggested' });
    const edits = feedback.filter((event) => event.event_type === 'user_edit').length;
    const rejects = feedback.filter((event) => event.event_type === 'rejected').length;
    if (edits >= 3) insights.push({ tenant_id: tenantId, insight_type: 'approval', title: 'Copy modificato spesso', body: `Sono state registrate ${edits} modifiche utente: il sistema deve privilegiare le scelte ricorrenti prima di automatizzare.`, evidence: { edits }, sample_size: edits, confidence: Math.min(0.9, 0.4 + edits / 20), status: 'suggested' });
    if (rejects >= 2) insights.push({ tenant_id: tenantId, insight_type: 'style', title: 'Pattern di rifiuto rilevato', body: `Sono stati rifiutati ${rejects} contenuti. Le cause restano suggerimenti finché il campione non è sufficiente.`, evidence: { rejects }, sample_size: rejects, confidence: Math.min(0.85, 0.35 + rejects / 20), status: 'suggested' });
    if (insights.length) await this.db.serviceRest('/rest/v1/learning_insights', { method: 'POST', body: jsonBody(insights) });
    return { analysis, insights };
  }

  async chatPublic(message: string) {
    const articles = await this.db.serviceRest<Array<{ title: string; content: string; category?: string | null }>>('/rest/v1/product_knowledge_articles?select=title,content,category&is_public=eq.true');
    const words = new Set(normalizeContent(message).split(' ').filter((word) => word.length > 2));
    const ranked = articles.map((article) => ({ article, score: normalizeContent(`${article.title} ${article.content}`).split(' ').filter((word) => words.has(word)).length })).sort((a,b) => b.score - a.score);
    if (!ranked[0] || ranked[0].score === 0) return { answer: 'Non ho una risposta supportata dalla knowledge base pubblica locale.', citations: [] };
    return { answer: ranked[0].article.content, citations: [ranked[0].article.title] };
  }

  async chatTenant(token: string, tenantId: string, message: string) {
    await this.db.requireTenantRole(token, tenantId);
    const workspace = await this.getWorkspace(token, tenantId);
    const normalized = normalizeContent(message);
    if (/quota|post.*settimana|limite/.test(normalized)) return { answer: `Il tenant ha configurato ${String(asObject(workspace.onboarding?.frequency).postsPerWeek ?? 3)} post a settimana.`, scope: tenantId };
    if (/brand|target|servizi/.test(normalized)) return { answer: `Brand: ${String((workspace.brand as BrandProfileRow | null)?.brand_name ?? 'non configurato')}. Target: ${asArray((workspace.brand as BrandProfileRow | null)?.target).join(', ') || 'non definito'}.`, scope: tenantId };
    if (/approv|pubblic/.test(normalized)) return { answer: `Ci sono ${workspace.posts.filter((post: any) => post.status === 'awaiting_approval').length} contenuti in attesa di approvazione e ${workspace.published.length} pubblicazioni mock.`, scope: tenantId };
    return { answer: 'Posso usare solo il contesto del tenant autenticato e la knowledge pubblica. Prova a chiedere di brand, quota, approvazioni o pubblicazioni.', scope: tenantId };
  }

  async adminSnapshot(token: string) {
    const user = await this.db.getUser(token);
    const adminRows = await this.db.serviceRest<Array<{ user_id: string }>>(`/rest/v1/rpc/is_platform_admin` as never).catch(() => [] as Array<{ user_id: string }>);
    const isAdmin = adminRows.some((row) => row.user_id === user.id) || await this.isPlatformAdmin(user.id);
    if (!isAdmin) throw new Error('platform_admin_required');
    const [tenants,members,plans,subscriptions,posts,jobs,aiUsage,connections] = await Promise.all([
      this.db.serviceRest<Array<Record<string, unknown>>>('/rest/v1/tenants?select=id,name,status,onboarding_status,created_at&order=created_at.desc'),
      this.db.serviceRest<Array<Record<string, unknown>>>('/rest/v1/tenant_members?select=tenant_id,user_id,role,status'),
      this.db.serviceRest<Array<Record<string, unknown>>>('/rest/v1/plans?select=id,code,name,status,posts_per_week,ai_budget_cents'),
      this.db.serviceRest<Array<Record<string, unknown>>>('/rest/v1/subscriptions?select=tenant_id,plan_id,status,provider'),
      this.db.serviceRest<Array<Record<string, unknown>>>('/rest/v1/posts?select=tenant_id,status,id'),
      this.db.serviceRest<Array<Record<string, unknown>>>('/rest/v1/publication_jobs?select=tenant_id,status,id,attempts,last_error_code'),
      this.db.serviceRest<Array<Record<string, unknown>>>('/rest/v1/ai_usage_events?select=tenant_id,task,model,input_tokens,output_tokens,estimated_cost_microunits,created_at'),
      this.db.serviceRest<Array<Record<string, unknown>>>('/rest/v1/social_connections?select=tenant_id,platform,connection_status,approval_mode'),
    ]);
    return { tenants,members,plans,subscriptions,posts,jobs,aiUsage,connections };
  }

  async grantSelfPlatformAdmin(token: string) {
    if (process.env.LOCAL_E2E_ENABLED !== 'true') throw new Error('local_dev_only');
    const user = await this.db.getUser(token);
    const existing = await this.db.serviceRest<Array<{ user_id: string }>>('/rest/v1/platform_admins?select=user_id').catch(() => []);
    if (existing.length > 0 && !existing.some((row) => row.user_id === user.id)) throw new Error('local_admin_already_claimed');
    await this.db.serviceRest('/rest/v1/platform_admins', { method: 'POST', headers: { 'content-profile': 'app_private', prefer: 'resolution=ignore-duplicates,return=minimal' }, body: jsonBody({ user_id: user.id, created_by: user.id }) });
    return { userId: user.id, platformAdmin: true };
  }

  private async isPlatformAdmin(userId: string): Promise<boolean> {
    try {
      const rows = await this.db.serviceRest<Array<{ user_id: string }>>(`/rest/v1/platform_admins?select=user_id&user_id=eq.${q(userId)}`, { headers: { 'accept-profile': 'app_private' } });
      return rows.length > 0;
    } catch {
      return false;
    }
  }

  private compactBrand(profile: BrandProfileRow, locks: Array<{ field_path: string; locked_value: unknown }>): BrandContextCompact {
    const location = asObject(profile.location);
    return {
      brandName: profile.brand_name ?? 'Brand',
      ...(profile.description ? { description: profile.description } : {}),
      ...(profile.industry ? { industry: profile.industry } : {}),
      locations: [String(location.city ?? ''), String(location.serviceArea ?? '')].filter(Boolean),
      audiences: asArray(profile.target),
      services: asArray(profile.services),
      products: asArray(profile.products),
      differentiators: asArray(profile.differentiators),
      valuePropositions: asArray(profile.value_propositions),
      toneRules: Object.values(asObject(profile.tone_of_voice)).map(String),
      bannedWords: asArray(profile.banned_words),
      allowedClaims: asArray(profile.claims_allowed),
      forbiddenClaims: asArray(profile.claims_forbidden),
      ctaPreferences: asArray(profile.cta_preferences),
      palette: asArray(profile.brand_colors),
      contentThemes: asArray(profile.topics).length ? asArray(profile.topics) : uniqueStrings([...asArray(profile.services), ...asArray(profile.goals)]),
      lockedFacts: Object.fromEntries(locks.map((lock) => [lock.field_path, lock.locked_value])),
      sourceVersion: profile.version,
    };
  }

  private brandSnapshot(profile: BrandProfileRow): Record<string, unknown> {
    return {
      brand_name: profile.brand_name,
      description: profile.description,
      industry: profile.industry,
      sub_industry: profile.sub_industry,
      location: profile.location,
      target: profile.target,
      personas: profile.personas,
      services: profile.services,
      products: profile.products,
      differentiators: profile.differentiators,
      usp: profile.usp,
      value_propositions: profile.value_propositions,
      brand_colors: profile.brand_colors,
      fonts: profile.fonts,
      visual_style: profile.visual_style,
      tone_of_voice: profile.tone_of_voice,
      vocabulary: profile.vocabulary,
      banned_words: profile.banned_words,
      cta_preferences: profile.cta_preferences,
      claims_allowed: profile.claims_allowed,
      claims_forbidden: profile.claims_forbidden,
      topics: profile.topics,
      goals: profile.goals,
      source_summary: profile.source_summary,
    };
  }

  private qualityProblem(quality: QualityScore): boolean {
    return quality.brandMatch < 0.8 || quality.relevance < 0.8 || quality.clarity < 0.8 || quality.platformFit < 0.5 || quality.factConfidence < 0.75 || quality.duplicateRisk >= 0.84;
  }

  private async assessServerDuplicate(tenantId: string, postId: string, topic: string, variants: PostVariant[]) {
    const sameTenant = await this.db.serviceRest<Array<{ caption?: string | null; hook?: string | null; post_id: string }>>(`/rest/v1/post_variants?select=caption,hook,post_id&tenant_id=eq.${q(tenantId)}&post_id=neq.${q(postId)}&platform_decision=neq.skip&order=created_at.desc&limit=60`);
    let risk = 0;
    let strongest = { exact:0, normalized:0, semantic:0, topic:0, hook:0, visual:0, sameTenant:0, crossTenantTemplate:0 };
    for (const variant of variants.filter((item) => item.decision !== 'skip')) {
      for (const reference of sameTenant) {
        const assessment = assessDuplicate({ candidateText: variant.caption, referenceText: reference.caption ?? '', candidateTopic: topic, referenceTopic: topic, candidateHook: variant.hook, referenceHook: reference.hook ?? '', sameTenantRecentSimilarity: 0.2 });
        if (assessment.risk > risk) { risk = assessment.risk; strongest = assessment.signals; }
      }
    }
    const topicKey = normalizeContent(topic);
    const cross = await this.db.serviceRest<Array<{ topic_key?: string | null; hook_key?: string | null; tenant_id: string }>>(`/rest/v1/content_fingerprints?select=tenant_id,topic_key,hook_key&tenant_id=neq.${q(tenantId)}&topic_key=eq.${q(topicKey)}&limit=20`);
    const crossTenantTemplate = cross.length > 0 ? 0.96 : 0;
    if (crossTenantTemplate > risk) risk = crossTenantTemplate;
    strongest = { ...strongest, crossTenantTemplate };
    return { risk, shouldRegenerate: risk >= 0.84, signals: strongest, crossTenantTemplate };
  }

  private async persistFingerprint(tenantId: string, postId: string, variant: PostVariant, crossTenantTemplate: number) {
    const text = `${variant.hook}\n${variant.caption}\n${variant.cta ?? ''}`;
    await this.db.serviceRest('/rest/v1/content_fingerprints', { method: 'POST', body: jsonBody({ tenant_id: tenantId, post_id: postId, text_sha256: hash(text), normalized_sha256: hash(normalizeContent(text)), topic_key: normalizeContent(String(variant.visualBrief.subject ?? '')), hook_key: normalizeContent(variant.hook), visual_key: hash(JSON.stringify(variant.visualBrief)), embedding_model: null, metadata: { localMock: true, crossTenantTemplate } }) }).catch(async () => {
      await this.db.serviceRest('/rest/v1/content_fingerprints', { method: 'POST', body: jsonBody({ tenant_id: tenantId, post_id: postId, text_sha256: hash(text), normalized_sha256: hash(normalizeContent(text)), topic_key: normalizeContent(String(variant.visualBrief.subject ?? '')), hook_key: normalizeContent(variant.hook), visual_key: hash(JSON.stringify(variant.visualBrief)) }) });
    });
  }

  private async recordAiUsage(tenantId: string, task: string, output: string, correlationId: string) {
    const inputTokens = Math.max(50, Math.ceil(output.length / 8));
    const outputTokens = Math.max(40, Math.ceil(output.length / 4));
    const inputPrice = Number(process.env.LOCAL_MOCK_INPUT_PER_MILLION ?? '0');
    const outputPrice = Number(process.env.LOCAL_MOCK_OUTPUT_PER_MILLION ?? '0');
    const configured = Number.isFinite(inputPrice) && Number.isFinite(outputPrice) && (inputPrice > 0 || outputPrice > 0);
    const cost = configured ? Math.round(((inputTokens / 1_000_000) * inputPrice + (outputTokens / 1_000_000) * outputPrice) * 1_000_000) : null;
    await this.db.serviceRest('/rest/v1/ai_usage_events', { method: 'POST', body: jsonBody({ tenant_id: tenantId, task, provider: 'mock', model: 'deterministic-local-v1', prompt_version: 'mock-e2e-v1', input_tokens: inputTokens, cached_input_tokens: 0, output_tokens: outputTokens, image_count: 0, web_search_calls: 0, estimated_cost_microunits: cost, correlation_id: uuidFromString(correlationId), metadata: { mock: true, theoreticalPricingConfigured: configured, theoreticalWorkUnits: inputTokens + outputTokens * 2 } }) });
  }
}

const uniqueStrings = (values: string[]): string[] => [...new Set(values.map((item) => item.trim()).filter(Boolean))];

const diffObject = (before: Record<string, unknown>, after: Record<string, unknown>): Record<string, { before: unknown; after: unknown }> => Object.fromEntries(
  Object.entries(after).filter(([key, value]) => JSON.stringify(before[key]) !== JSON.stringify(value)).map(([key, value]) => [key, { before: before[key], after: value }]),
);

const uuidFromString = (value: string): string => {
  const hex = hash(value).slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0,8).join('')}-${hex.slice(8,12).join('')}-${hex.slice(12,16).join('')}-${hex.slice(16,20).join('')}-${hex.slice(20,32).join('')}`;
};

const nextMondayIso = (): string => {
  const date = new Date();
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + (8 - day) % 7);
  date.setUTCHours(0,0,0,0);
  return date.toISOString();
};
