import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.TEST_SUPABASE_URL;
const publishableKey = process.env.TEST_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && publishableKey && serviceRoleKey);

const suite = enabled ? describe : describe.skip;

suite('tenant isolation', () => {
  const runId = crypto.randomUUID();
  const password = `T3st-${runId}!Aa9`;
  const emailA = `tenant-a-${runId}@example.test`;
  const emailB = `tenant-b-${runId}@example.test`;

  let admin: SupabaseClient;
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let userAId = '';
  let userBId = '';
  let tenantA = '';
  let tenantB = '';
  let websiteBId = '';
  let brandBId = '';

  beforeAll(async () => {
    admin = createClient(url!, serviceRoleKey!, { auth: { persistSession: false, autoRefreshToken: false } });

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
    await admin.from('tenants').delete().in('id', [tenantA, tenantB].filter(Boolean));
    await Promise.all([
      userAId ? admin.auth.admin.deleteUser(userAId) : Promise.resolve(),
      userBId ? admin.auth.admin.deleteUser(userBId) : Promise.resolve(),
    ]);
  });

  it('allows each owner to read their own tenant', async () => {
    const result = await clientA.from('tenants').select('id').eq('id', tenantA);
    expect(result.error).toBeNull();
    expect(result.data).toEqual([{ id: tenantA }]);
  });

  it('returns no rows when Tenant A reads Tenant B', async () => {
    const result = await clientA.from('websites').select('id,tenant_id').eq('id', websiteBId);
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
  });

  it('blocks Tenant A from inserting a Tenant B resource', async () => {
    const result = await clientA.from('websites').insert({ tenant_id: tenantB, url: 'https://attack.example.test' });
    expect(result.error).not.toBeNull();
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
  });

  it('does not expose app_private integration credentials to an authenticated client', async () => {
    const result = await clientA.schema('app_private').from('integration_credentials').select('*').limit(1);
    expect(result.error).not.toBeNull();
  });
});
