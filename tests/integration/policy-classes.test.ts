import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.TEST_SUPABASE_URL;
const publishableKey = process.env.TEST_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && publishableKey && serviceRoleKey);
const suite = enabled ? describe : describe.skip;

suite('representative RLS policy classes', () => {
  const runId = crypto.randomUUID();
  const password = `Rls-${runId}!Aa9`;
  let admin: SupabaseClient;
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let userAId = '';
  let userBId = '';
  let tenantA = '';
  let tenantB = '';
  let brandAssetBId = '';
  let postBId = '';
  let socialConnectionBId = '';
  let aiUsageBId = 0;

  beforeAll(async () => {
    admin = createClient(url!, serviceRoleKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    clientA = createClient(url!, publishableKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    clientB = createClient(url!, publishableKey!, { auth: { persistSession: false, autoRefreshToken: false } });

    const emailA = `policy-a-${runId}@example.test`;
    const emailB = `policy-b-${runId}@example.test`;
    const [createdA, createdB] = await Promise.all([
      admin.auth.admin.createUser({ email: emailA, password, email_confirm: true }),
      admin.auth.admin.createUser({ email: emailB, password, email_confirm: true }),
    ]);
    if (createdA.error) throw createdA.error;
    if (createdB.error) throw createdB.error;
    userAId = createdA.data.user.id;
    userBId = createdB.data.user.id;

    const [loginA, loginB] = await Promise.all([
      clientA.auth.signInWithPassword({ email: emailA, password }),
      clientB.auth.signInWithPassword({ email: emailB, password }),
    ]);
    if (loginA.error) throw loginA.error;
    if (loginB.error) throw loginB.error;

    const [createdTenantA, createdTenantB] = await Promise.all([
      clientA.rpc('create_tenant', { p_name: 'Policy Tenant A', p_slug: `policy-a-${runId}` }),
      clientB.rpc('create_tenant', { p_name: 'Policy Tenant B', p_slug: `policy-b-${runId}` }),
    ]);
    if (createdTenantA.error) throw createdTenantA.error;
    if (createdTenantB.error) throw createdTenantB.error;
    tenantA = createdTenantA.data as string;
    tenantB = createdTenantB.data as string;

    const asset = await clientB
      .from('brand_assets')
      .insert({
        tenant_id: tenantB,
        kind: 'image',
        storage_bucket: 'brand-assets',
        storage_path: `${tenantB}/fixtures/brand.jpg`,
        original_filename: 'brand.jpg',
      })
      .select('id')
      .single();
    if (asset.error) throw asset.error;
    brandAssetBId = asset.data.id as string;

    const post = await clientB
      .from('posts')
      .insert({ tenant_id: tenantB, topic: 'Tenant B private topic', status: 'draft' })
      .select('id')
      .single();
    if (post.error) throw post.error;
    postBId = post.data.id as string;

    const connection = await clientB
      .from('social_connections')
      .insert({ tenant_id: tenantB, platform: 'facebook', connection_status: 'connected' })
      .select('id')
      .single();
    if (connection.error) throw connection.error;
    socialConnectionBId = connection.data.id as string;

    const usage = await admin
      .from('ai_usage_events')
      .insert({ tenant_id: tenantB, task: 'local_policy_fixture', model: 'mock-model' })
      .select('id')
      .single();
    if (usage.error) throw usage.error;
    aiUsageBId = Number(usage.data.id);
  });

  afterAll(async () => {
    if (!admin) return;
    if (tenantA || tenantB) await admin.from('tenants').delete().in('id', [tenantA, tenantB].filter(Boolean));
    await Promise.all([
      userAId ? admin.auth.admin.deleteUser(userAId) : Promise.resolve(),
      userBId ? admin.auth.admin.deleteUser(userBId) : Promise.resolve(),
    ]);
  });

  it('isolates editable content tables across tenants while allowing owner CRUD', async () => {
    for (const [table, id] of [['brand_assets', brandAssetBId], ['posts', postBId]] as const) {
      const attackerRead = await clientA.from(table).select('id,tenant_id').eq('id', id);
      expect(attackerRead.error).toBeNull();
      expect(attackerRead.data).toEqual([]);

      const ownerRead = await clientB.from(table).select('id,tenant_id').eq('id', id).single();
      expect(ownerRead.error).toBeNull();
      expect(ownerRead.data?.tenant_id).toBe(tenantB);
    }

    const attackAssetInsert = await clientA.from('brand_assets').insert({
      tenant_id: tenantB,
      kind: 'image',
      storage_bucket: 'brand-assets',
      storage_path: `${tenantB}/fixtures/attack.jpg`,
    });
    expect(attackAssetInsert.error).not.toBeNull();

    const attackPostInsert = await clientA.from('posts').insert({ tenant_id: tenantB, topic: 'Injected topic' });
    expect(attackPostInsert.error).not.toBeNull();

    const ownerPostUpdate = await clientB.from('posts').update({ topic: 'Owner updated topic' }).eq('id', postBId).select('topic').single();
    expect(ownerPostUpdate.error).toBeNull();
    expect(ownerPostUpdate.data?.topic).toBe('Owner updated topic');

    const attackerPostUpdate = await clientA.from('posts').update({ topic: 'Attacker update' }).eq('id', postBId).select('id');
    expect(attackerPostUpdate.error).toBeNull();
    expect(attackerPostUpdate.data).toEqual([]);
  });

  it('isolates owner/admin connection metadata and blocks cross-tenant mutation', async () => {
    const attackerRead = await clientA.from('social_connections').select('id,tenant_id').eq('id', socialConnectionBId);
    expect(attackerRead.error).toBeNull();
    expect(attackerRead.data).toEqual([]);

    const ownerRead = await clientB.from('social_connections').select('id,tenant_id,connection_status').eq('id', socialConnectionBId).single();
    expect(ownerRead.error).toBeNull();
    expect(ownerRead.data?.tenant_id).toBe(tenantB);

    const attackerInsert = await clientA.from('social_connections').insert({ tenant_id: tenantB, platform: 'linkedin' });
    expect(attackerInsert.error).not.toBeNull();

    const attackerUpdate = await clientA.from('social_connections').update({ connection_status: 'disabled' }).eq('id', socialConnectionBId).select('id');
    expect(attackerUpdate.error).toBeNull();
    expect(attackerUpdate.data).toEqual([]);

    const ownerUpdate = await clientB.from('social_connections').update({ connection_status: 'expiring' }).eq('id', socialConnectionBId).select('connection_status').single();
    expect(ownerUpdate.error).toBeNull();
    expect(ownerUpdate.data?.connection_status).toBe('expiring');
  });

  it('keeps server-only AI usage writes unavailable to authenticated clients while preserving tenant-scoped reads', async () => {
    const attackerRead = await clientA.from('ai_usage_events').select('id,tenant_id').eq('id', aiUsageBId);
    expect(attackerRead.error).toBeNull();
    expect(attackerRead.data).toEqual([]);

    const ownerRead = await clientB.from('ai_usage_events').select('id,tenant_id,task').eq('id', aiUsageBId).single();
    expect(ownerRead.error).toBeNull();
    expect(ownerRead.data?.tenant_id).toBe(tenantB);
    expect(ownerRead.data?.task).toBe('local_policy_fixture');

    const clientWrite = await clientB.from('ai_usage_events').insert({ tenant_id: tenantB, task: 'forbidden_client_write', model: 'mock-model' });
    expect(clientWrite.error).not.toBeNull();
  });
});
