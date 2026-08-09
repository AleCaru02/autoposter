import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.TEST_SUPABASE_URL;
const publishableKey = process.env.TEST_SUPABASE_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && publishableKey && serviceRoleKey);
const suite = enabled ? describe : describe.skip;

suite('local E2E state tenant isolation', () => {
  const runId = crypto.randomUUID();
  const password = `T3st-${runId}!Aa9`;
  let admin: SupabaseClient;
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let userA = '';
  let userB = '';
  let tenantA = '';
  let tenantB = '';
  let brandA = '';
  let brandB = '';

  beforeAll(async () => {
    admin = createClient(url!, serviceRoleKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const emailA = `e2e-state-a-${runId}@example.test`;
    const emailB = `e2e-state-b-${runId}@example.test`;
    const [createdA, createdB] = await Promise.all([
      admin.auth.admin.createUser({ email: emailA, password, email_confirm: true }),
      admin.auth.admin.createUser({ email: emailB, password, email_confirm: true }),
    ]);
    if (createdA.error) throw createdA.error;
    if (createdB.error) throw createdB.error;
    userA = createdA.data.user.id;
    userB = createdB.data.user.id;
    clientA = createClient(url!, publishableKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    clientB = createClient(url!, publishableKey!, { auth: { persistSession: false, autoRefreshToken: false } });
    const [loginA, loginB] = await Promise.all([
      clientA.auth.signInWithPassword({ email: emailA, password }),
      clientB.auth.signInWithPassword({ email: emailB, password }),
    ]);
    if (loginA.error) throw loginA.error;
    if (loginB.error) throw loginB.error;
    const [createdTenantA, createdTenantB] = await Promise.all([
      clientA.rpc('create_tenant', { p_name: 'E2E State A', p_slug: `e2e-state-a-${runId}` }),
      clientB.rpc('create_tenant', { p_name: 'E2E State B', p_slug: `e2e-state-b-${runId}` }),
    ]);
    if (createdTenantA.error) throw createdTenantA.error;
    if (createdTenantB.error) throw createdTenantB.error;
    tenantA = createdTenantA.data as string;
    tenantB = createdTenantB.data as string;
    const [profileA, profileB] = await Promise.all([
      clientA.from('brand_profiles').insert({ tenant_id: tenantA, brand_name: 'Brand A', version: 1 }).select('id').single(),
      clientB.from('brand_profiles').insert({ tenant_id: tenantB, brand_name: 'Brand B', version: 1 }).select('id').single(),
    ]);
    if (profileA.error) throw profileA.error;
    if (profileB.error) throw profileB.error;
    brandA = profileA.data.id;
    brandB = profileB.data.id;
  });

  afterAll(async () => {
    if (tenantA || tenantB) await admin.from('tenants').delete().in('id', [tenantA, tenantB].filter(Boolean));
    await Promise.all([
      userA ? admin.auth.admin.deleteUser(userA) : Promise.resolve(),
      userB ? admin.auth.admin.deleteUser(userB) : Promise.resolve(),
    ]);
  });

  it('persists onboarding only inside the authenticated tenant scope', async () => {
    const own = await clientA.from('onboarding_sessions').insert({ tenant_id: tenantA, current_step: 'goals', business: { name: 'A' } }).select('tenant_id,current_step').single();
    expect(own.error).toBeNull();
    expect(own.data).toMatchObject({ tenant_id: tenantA, current_step: 'goals' });
    const crossInsert = await clientA.from('onboarding_sessions').insert({ tenant_id: tenantB, current_step: 'goals', business: { name: 'attack' } });
    expect(crossInsert.error).not.toBeNull();
    const crossRead = await clientA.from('onboarding_sessions').select('tenant_id').eq('tenant_id', tenantB);
    expect(crossRead.error).toBeNull();
    expect(crossRead.data).toEqual([]);
  });

  it('enforces tenant-consistent Brand Profile version history', async () => {
    const own = await clientA.from('brand_profile_versions').insert({ tenant_id: tenantA, brand_profile_id: brandA, version: 1, status: 'draft', snapshot: { brand_name: 'Brand A' }, created_by: userA }).select('id').single();
    expect(own.error).toBeNull();
    const guessedCrossTenantParent = await clientA.from('brand_profile_versions').insert({ tenant_id: tenantA, brand_profile_id: brandB, version: 1, status: 'draft', snapshot: { brand_name: 'stolen' }, created_by: userA });
    expect(guessedCrossTenantParent.error).not.toBeNull();
    const hidden = await clientA.from('brand_profile_versions').select('id').eq('tenant_id', tenantB);
    expect(hidden.error).toBeNull();
    expect(hidden.data).toEqual([]);
  });

  it('allows tenant-scoped learning reads but prevents clients from forging learning evidence', async () => {
    const forged = await clientA.from('learning_insights').insert({ tenant_id: tenantA, insight_type: 'general', title: 'fake', body: 'fake', sample_size: 99, confidence: 1 });
    expect(forged.error).not.toBeNull();
    const inserted = await admin.from('learning_insights').insert([
      { tenant_id: tenantA, insight_type: 'pillar', title: 'Insight A', body: 'Evidence A', sample_size: 6, confidence: 0.8 },
      { tenant_id: tenantB, insight_type: 'pillar', title: 'Insight B', body: 'Evidence B', sample_size: 6, confidence: 0.8 },
    ]);
    expect(inserted.error).toBeNull();
    const visibleA = await clientA.from('learning_insights').select('title').order('title');
    const visibleB = await clientB.from('learning_insights').select('title').order('title');
    expect(visibleA.error).toBeNull();
    expect(visibleB.error).toBeNull();
    expect(visibleA.data).toEqual([{ title: 'Insight A' }]);
    expect(visibleB.data).toEqual([{ title: 'Insight B' }]);
  });
});
