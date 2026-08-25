import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.TEST_SUPABASE_URL;
const publishableKey = process.env.TEST_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && publishableKey && serviceRoleKey);

const suite = enabled ? describe : describe.skip;

suite('tenant isolation and quota engine', () => {
  const runId = crypto.randomUUID();
  const password = `T3st-${runId}!Aa9`;
  const emailA = `tenant-a-${runId}@example.test`;
  const emailB = `tenant-b-${runId}@example.test`;

  let admin: SupabaseClient;
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let anon: SupabaseClient;
  let userAId = '';
  let userBId = '';
  let tenantA = '';
  let tenantB = '';
  let websiteBId = '';
  let brandBId = '';

  const period = (weekOffset: number) => {
    const start = new Date(Date.UTC(2026, 0, 5 + weekOffset * 7));
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    return { start: start.toISOString(), end: end.toISOString() };
  };

  beforeAll(async () => {
    admin = createClient(url!, serviceRoleKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    anon = createClient(url!, publishableKey!, { auth: { persistSession: false, autoRefreshToken: false } });

    const [createdA, createdB] = await Promise.all([
      admin.auth.admin.createUser({ email: emailA, password, email_confirm: true }),
      admin.auth.admin.createUser({ email: emailB, password, email_confirm: true }),
    ]);
    if (createdA.error) throw createdA.error;
    if (createdB.error) throw createdB.error;
    userAId = createdA.data.user.id;
    userBId = createdB.data.user.id;

    clientA = createClient(url!, publishableKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    clientB = createClient(url!, publishableKey!, { auth: { persistSession: false, autoRefreshToken: false } });

    const [loginA, loginB] = await Promise.all([
      clientA.auth.signInWithPassword({ email: emailA, password }),
      clientB.auth.signInWithPassword({ email: emailB, password }),
    ]);
    if (loginA.error) throw loginA.error;
    if (loginB.error) throw loginB.error;

    const [tenantCreateA, tenantCreateB] = await Promise.all([
      clientA.rpc('create_tenant', { p_name: 'Tenant A', p_slug: `tenant-a-${runId}` }),
      clientB.rpc('create_tenant', { p_name: 'Tenant B', p_slug: `tenant-b-${runId}` }),
    ]);
    if (tenantCreateA.error) throw tenantCreateA.error;
    if (tenantCreateB.error) throw tenantCreateB.error;
    tenantA = tenantCreateA.data as string;
    tenantB = tenantCreateB.data as string;

    const plan = await admin.from('plans').select('id').eq('code', 'local-dev').single();
    if (plan.error) throw plan.error;

    const subscriptions = await admin.from('subscriptions').insert([
      { tenant_id: tenantA, plan_id: plan.data.id, provider: 'manual', status: 'active' },
      { tenant_id: tenantB, plan_id: plan.data.id, provider: 'manual', status: 'active' },
    ]);
    if (subscriptions.error) throw subscriptions.error;

    const websiteB = await clientB
      .from('websites')
      .insert({ tenant_id: tenantB, url: 'https://tenant-b.example.test' })
      .select('id')
      .single();
    if (websiteB.error) throw websiteB.error;
    websiteBId = websiteB.data.id as string;

    const brandB = await clientB
      .from('brand_profiles')
      .insert({ tenant_id: tenantB, brand_name: 'Brand B' })
      .select('id')
      .single();
    if (brandB.error) throw brandB.error;
    brandBId = brandB.data.id as string;
  });

  afterAll(async () => {
    if (!admin) return;
    if (tenantA || tenantB) {
      await admin.from('tenants').delete().in('id', [tenantA, tenantB].filter(Boolean));
    }
    await Promise.all([
      userAId ? admin.auth.admin.deleteUser(userAId) : Promise.resolve(),
      userBId ? admin.auth.admin.deleteUser(userBId) : Promise.resolve(),
    ]);
  });

  it('allows each owner to read only their own tenant', async () => {
    const resultA = await clientA.from('tenants').select('id').order('id');
    const resultB = await clientB.from('tenants').select('id').order('id');
    expect(resultA.error).toBeNull();
    expect(resultB.error).toBeNull();
    expect(resultA.data).toEqual([{ id: tenantA }]);
    expect(resultB.data).toEqual([{ id: tenantB }]);
  });

  it('returns no rows when Tenant A reads Tenant B data', async () => {
    const result = await clientA.from('websites').select('id,tenant_id').eq('id', websiteBId);
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });

  it('blocks Tenant A from inserting a Tenant B resource', async () => {
    const result = await clientA.from('websites').insert({ tenant_id: tenantB, url: 'https://attack.example.test' });
    expect(result.error).not.toBeNull();
  });

  it('allows Tenant A to create, update and delete its own resource', async () => {
    const inserted = await clientA
      .from('websites')
      .insert({ tenant_id: tenantA, url: `https://tenant-a-${runId}.example.test` })
      .select('id,status')
      .single();
    expect(inserted.error).toBeNull();
    expect(inserted.data?.status).toBe('pending');

    const updated = await clientA
      .from('websites')
      .update({ status: 'active' })
      .eq('id', inserted.data!.id)
      .select('status')
      .single();
    expect(updated.error).toBeNull();
    expect(updated.data?.status).toBe('active');

    const deleted = await clientA.from('websites').delete().eq('id', inserted.data!.id).select('id');
    expect(deleted.error).toBeNull();
    expect(deleted.data).toHaveLength(1);
  });

  it('blocks Tenant A updates and deletes against Tenant B rows', async () => {
    const updateResult = await clientA
      .from('websites')
      .update({ status: 'disabled' })
      .eq('id', websiteBId)
      .select('id');
    expect(updateResult.error).toBeNull();
    expect(updateResult.data).toEqual([]);

    const deleteResult = await clientA.from('websites').delete().eq('id', websiteBId).select('id');
    expect(deleteResult.error).toBeNull();
    expect(deleteResult.data).toEqual([]);

    const verifyB = await clientB.from('websites').select('status').eq('id', websiteBId).single();
    expect(verifyB.error).toBeNull();
    expect(verifyB.data?.status).toBe('pending');
  });

  it('blocks cross-tenant foreign-key linking even with a guessed parent id', async () => {
    const result = await clientA.from('brand_profile_locks').insert({
      tenant_id: tenantA,
      brand_profile_id: brandBId,
      field_path: 'brand_colors.primary',
      locked_value: '#ffffff',
    });
    expect(result.error).not.toBeNull();
  });

  it('keeps service-only publication writes inaccessible to authenticated users', async () => {
    const result = await clientA.from('publication_jobs').insert({
      tenant_id: tenantA,
      post_variant_id: crypto.randomUUID(),
      platform: 'instagram',
      scheduled_at: new Date().toISOString(),
      idempotency_key: `attack-${runId}`,
    });
    expect(result.error).not.toBeNull();
  });

  it('does not expose app_private integration credentials to an authenticated client', async () => {
    const result = await clientA.schema('app_private').from('integration_credentials').select('*').limit(1);
    expect(result.error).not.toBeNull();
  });

  it('allows anonymous reads only for intended public knowledge and active plans', async () => {
    const knowledge = await anon.from('product_knowledge_articles').select('slug').eq('slug', 'local-test-knowledge');
    const plans = await anon.from('plans').select('code').eq('code', 'local-dev');
    expect(knowledge.error).toBeNull();
    expect(knowledge.data).toEqual([{ slug: 'local-test-knowledge' }]);
    expect(plans.error).toBeNull();
    expect(plans.data).toEqual([{ code: 'local-dev' }]);
  });

  it('returns own entitlements and rejects cross-tenant entitlement reads', async () => {
    const own = await clientA.rpc('get_tenant_entitlements', { p_tenant_id: tenantA });
    const other = await clientA.rpc('get_tenant_entitlements', { p_tenant_id: tenantB });
    expect(own.error).toBeNull();
    expect(own.data?.plan_code).toBe('local-dev');
    expect(other.error).not.toBeNull();
  });

  it('prevents authenticated clients from mutating quota directly', async () => {
    const p = period(0);
    const result = await clientA.rpc('reserve_tenant_usage', {
      p_tenant_id: tenantA,
      p_metric: 'posts_week',
      p_amount: 1,
      p_period_start: p.start,
      p_period_end: p.end,
      p_idempotency_key: `client-attack-${runId}`,
    });
    expect(result.error).not.toBeNull();
  });

  it('reserves and releases quota idempotently through service_role', async () => {
    const p = period(1);
    const key = `release-${runId}`;
    const reserved = await admin.rpc('reserve_tenant_usage', {
      p_tenant_id: tenantA,
      p_metric: 'posts_week',
      p_amount: 1,
      p_period_start: p.start,
      p_period_end: p.end,
      p_idempotency_key: key,
    });
    expect(reserved.error).toBeNull();
    expect(reserved.data?.status).toBe('reserved');
    expect(reserved.data?.idempotent_replay).toBe(false);

    const replay = await admin.rpc('reserve_tenant_usage', {
      p_tenant_id: tenantA,
      p_metric: 'posts_week',
      p_amount: 1,
      p_period_start: p.start,
      p_period_end: p.end,
      p_idempotency_key: key,
    });
    expect(replay.error).toBeNull();
    expect(replay.data?.reservation_id).toBe(reserved.data?.reservation_id);
    expect(replay.data?.idempotent_replay).toBe(true);

    const released = await admin.rpc('release_tenant_usage', { p_reservation_id: reserved.data!.reservation_id });
    const releaseReplay = await admin.rpc('release_tenant_usage', { p_reservation_id: reserved.data!.reservation_id });
    expect(released.error).toBeNull();
    expect(released.data?.status).toBe('released');
    expect(releaseReplay.error).toBeNull();
    expect(releaseReplay.data?.idempotent_replay).toBe(true);

    const counter = await admin
      .from('tenant_usage_counters')
      .select('used,reserved')
      .eq('tenant_id', tenantA)
      .eq('metric', 'posts_week')
      .eq('period_start', p.start)
      .single();
    expect(counter.error).toBeNull();
    expect(counter.data).toMatchObject({ used: 0, reserved: 0 });
  });

  it('reserves and commits quota exactly once', async () => {
    const p = period(2);
    const reserved = await admin.rpc('reserve_tenant_usage', {
      p_tenant_id: tenantA,
      p_metric: 'posts_week',
      p_amount: 1,
      p_period_start: p.start,
      p_period_end: p.end,
      p_idempotency_key: `commit-${runId}`,
    });
    expect(reserved.error).toBeNull();

    const committed = await admin.rpc('commit_tenant_usage', { p_reservation_id: reserved.data!.reservation_id });
    const commitReplay = await admin.rpc('commit_tenant_usage', { p_reservation_id: reserved.data!.reservation_id });
    expect(committed.error).toBeNull();
    expect(committed.data?.status).toBe('committed');
    expect(commitReplay.error).toBeNull();
    expect(commitReplay.data?.idempotent_replay).toBe(true);

    const counter = await admin
      .from('tenant_usage_counters')
      .select('used,reserved')
      .eq('tenant_id', tenantA)
      .eq('metric', 'posts_week')
      .eq('period_start', p.start)
      .single();
    expect(counter.error).toBeNull();
    expect(counter.data).toMatchObject({ used: 1, reserved: 0 });
  });

  it('enforces quota limits and isolates usage counters between tenants', async () => {
    const p = period(3);
    const full = await admin.rpc('reserve_tenant_usage', {
      p_tenant_id: tenantB,
      p_metric: 'posts_week',
      p_amount: 3,
      p_period_start: p.start,
      p_period_end: p.end,
      p_idempotency_key: `full-${runId}`,
    });
    expect(full.error).toBeNull();

    const exceeded = await admin.rpc('reserve_tenant_usage', {
      p_tenant_id: tenantB,
      p_metric: 'posts_week',
      p_amount: 1,
      p_period_start: p.start,
      p_period_end: p.end,
      p_idempotency_key: `over-${runId}`,
    });
    expect(exceeded.error).not.toBeNull();

    const tenantARead = await clientA
      .from('tenant_usage_counters')
      .select('tenant_id,used,reserved')
      .eq('tenant_id', tenantB)
      .eq('period_start', p.start);
    expect(tenantARead.error).toBeNull();
    expect(tenantARead.data).toEqual([]);

    const tenantBRead = await clientB
      .from('tenant_usage_counters')
      .select('tenant_id,used,reserved')
      .eq('tenant_id', tenantB)
      .eq('period_start', p.start);
    expect(tenantBRead.error).toBeNull();
    expect(tenantBRead.data).toHaveLength(1);
    expect(tenantBRead.data?.[0]).toMatchObject({ tenant_id: tenantB, used: 0, reserved: 3 });
  });
});
