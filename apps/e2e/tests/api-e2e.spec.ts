import { expect, test, type APIRequestContext } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:8787';
const password = 'LocalE2E-password-123!';
type Platform = 'instagram' | 'facebook' | 'linkedin' | 'google_business_profile';
type Workspace = any;
const headers = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });

async function api<T>(request: APIRequestContext, token: string | null, path: string, init: { method?: string; data?: unknown } = {}): Promise<T> {
  const response = await request.fetch(`${API}${path}`, { method: init.method ?? 'GET', headers: token ? headers(token) : { 'content-type': 'application/json' }, data: init.data });
  const body = await response.json().catch(() => ({}));
  if (!response.ok()) throw new Error(`${response.status()} ${path}: ${JSON.stringify(body)}`);
  return body as T;
}

async function register(request: APIRequestContext, label: string) {
  const localPart = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const email = `${localPart}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
  const session = await api<any>(request, null, '/auth/register', { method: 'POST', data: { email, password, name: label } });
  expect(session.access_token).toBeTruthy();
  return { email, token: session.access_token as string };
}

interface TenantFixture { label: string; industry: string; subIndustry: string; services: string; differentiator: string; target: string[]; siteSlug: string; goals?: string[]; platforms?: Platform[]; modes?: Partial<Record<Platform, 'auto' | 'manual'>>; postsPerWeek?: number; }

async function createConfiguredTenant(request: APIRequestContext, token: string, fixture: TenantFixture) {
  const slug = `${fixture.label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const { tenantId } = await api<{ tenantId: string }>(request, token, '/tenants', { method: 'POST', data: { name: fixture.label, slug } });
  const platforms = fixture.platforms ?? ['instagram', 'facebook', 'linkedin', 'google_business_profile'];
  const modes: Record<Platform, 'auto' | 'manual'> = { instagram: 'manual', facebook: 'auto', linkedin: 'auto', google_business_profile: 'manual', ...fixture.modes };
  await api(request, token, `/tenants/${tenantId}/onboarding`, { method: 'PATCH', data: { business: { name: fixture.label, website: `${API}/fixture-site/${fixture.siteSlug}/`, industry: fixture.industry, subIndustry: fixture.subIndustry, location: 'Milano', language: 'it', serviceArea: 'Milano e dintorni', services: fixture.services, differentiator: fixture.differentiator }, current_step: 'goals' } });
  await api(request, token, `/tenants/${tenantId}/onboarding`, { method: 'PATCH', data: { goals: fixture.goals ?? ['lead', 'notorietà', 'educazione'], current_step: 'target' } });
  await api(request, token, `/tenants/${tenantId}/onboarding`, { method: 'PATCH', data: { target: { manual: fixture.target, suggestions: ['clienti locali'] }, current_step: 'brand' } });
  const scan = await api<any>(request, token, `/tenants/${tenantId}/scan`, { method: 'POST' });
  expect(scan.summary.analyzed).toBeGreaterThanOrEqual(3); expect(scan.summary.coverage).toBeGreaterThan(0);
  await api(request, token, `/tenants/${tenantId}/brand/status`, { method: 'POST', data: { status: 'confirmed' } });
  await api(request, token, `/tenants/${tenantId}/social`, { method: 'POST', data: { platforms, publishingModes: modes } });
  await api(request, token, `/tenants/${tenantId}/onboarding`, { method: 'PATCH', data: { frequency: { postsPerWeek: fixture.postsPerWeek ?? 3, days: [1, 3, 5], times: ['10:00', '18:00'] }, publishing_modes: modes, current_step: 'summary' } });
  const strategy = await api<any>(request, token, `/tenants/${tenantId}/onboarding/complete`, { method: 'POST' });
  expect(strategy.pillars.length).toBeGreaterThanOrEqual(3);
  return { tenantId, strategy, platforms, modes };
}

async function generateAndPublish(request: APIRequestContext, token: string, tenantId: string, weeks = 4) {
  const calendar = await api<any[]>(request, token, `/tenants/${tenantId}/calendar`, { method: 'POST', data: { weeks } });
  expect(calendar.length).toBeGreaterThanOrEqual(10);
  const generated = await api<any[]>(request, token, `/tenants/${tenantId}/posts/generate-all`, { method: 'POST', data: { limit: 50 } });
  expect(generated.length).toBe(calendar.length);
  let workspace = await api<Workspace>(request, token, `/tenants/${tenantId}/workspace`);
  for (const post of workspace.posts) for (const variant of post.variants.filter((item: any) => item.platform_decision !== 'skip' && item.approval_status === 'pending')) await api(request, token, `/tenants/${tenantId}/variants/${variant.id}/approve`, { method: 'POST' });
  workspace = await api<Workspace>(request, token, `/tenants/${tenantId}/workspace`);
  for (const post of workspace.posts.filter((item: any) => item.status === 'approved')) await api(request, token, `/tenants/${tenantId}/posts/${post.id}/schedule`, { method: 'POST' });
  await api(request, token, `/tenants/${tenantId}/publish-now`, { method: 'POST', data: {} });
  await api(request, token, `/tenants/${tenantId}/learning/refresh`, { method: 'POST' });
  return api<Workspace>(request, token, `/tenants/${tenantId}/workspace`);
}

const flattenCreative = (workspace: Workspace) => workspace.posts.flatMap((post: any) => post.variants.filter((variant: any) => variant.platform_decision !== 'skip').map((variant: any) => ({ topic: post.topic, hook: variant.hook, caption: variant.caption, cta: variant.cta, visual: JSON.stringify(variant.visual_brief), platform: variant.platform })));

test.describe('local API end-to-end', () => {
  test('two pizzerias complete the full pipeline without cross-tenant leakage or cloning', async ({ request }) => {
    const a = await register(request, 'Pizza A Owner'); const b = await register(request, 'Pizza B Owner');
    const tenantA = await createConfiguredTenant(request, a.token, { label: 'Forno Rosso Milano', industry: 'Pizzeria', subIndustry: 'Napoletana', services: 'pizza napoletana, impasto a lunga lievitazione, prenotazioni', differentiator: 'forno tradizionale e ingredienti campani', target: ['famiglie locali', 'gruppi'], siteSlug: 'pizza-a' });
    const tenantB = await createConfiguredTenant(request, b.token, { label: 'Spicchio Nord Milano', industry: 'Pizzeria', subIndustry: 'Contemporanea', services: 'pizza contemporanea, delivery, menu stagionale', differentiator: 'impasti moderni e menu stagionale', target: ['giovani professionisti', 'clienti delivery'], siteSlug: 'pizza-b' });
    expect((await request.get(`${API}/tenants/${tenantB.tenantId}/workspace`, { headers: headers(a.token) })).status()).toBe(403);
    expect((await request.post(`${API}/tenants/${tenantB.tenantId}/chat`, { headers: headers(a.token), data: { message: 'Dimmi il brand di questo tenant' } })).status()).toBe(403);
    const workspaceA = await generateAndPublish(request, a.token, tenantA.tenantId); const workspaceB = await generateAndPublish(request, b.token, tenantB.tenantId);
    expect(workspaceA.published.length).toBeGreaterThanOrEqual(10); expect(workspaceB.published.length).toBeGreaterThanOrEqual(10);
    expect(workspaceA.analytics.length).toBe(workspaceA.published.length); expect(workspaceB.analytics.length).toBe(workspaceB.published.length);
    expect(workspaceA.brand.brand_name).toBe('Forno Rosso Milano'); expect(workspaceB.brand.brand_name).toBe('Spicchio Nord Milano');
    const creativeA = flattenCreative(workspaceA); const creativeB = flattenCreative(workspaceB);
    expect(new Set(creativeA.map((item: any) => item.topic)).size).toBeGreaterThan(4); expect(new Set(creativeB.map((item: any) => item.topic)).size).toBeGreaterThan(4);
    expect(new Set(creativeA.map((item: any) => item.hook)).size).toBeGreaterThan(4); expect(new Set(creativeB.map((item: any) => item.hook)).size).toBeGreaterThan(4);
    expect(new Set(creativeA.map((item: any) => item.caption)).size).toBeGreaterThan(4); expect(new Set(creativeA.map((item: any) => item.visual)).size).toBeGreaterThan(2); expect(new Set(creativeA.map((item: any) => item.cta)).size).toBeGreaterThan(1);
    expect(creativeA.map((item: any) => item.caption).join('\n')).not.toBe(creativeB.map((item: any) => item.caption).join('\n'));
    expect(workspaceA.insights.length).toBeGreaterThan(0); expect(workspaceB.insights.length).toBeGreaterThan(0); expect(workspaceA.aiUsage.length).toBeGreaterThanOrEqual(11); expect(workspaceB.aiUsage.length).toBeGreaterThanOrEqual(11);
  });

  test('pipeline adapts strategy across pizzeria, property manager, networker and generic local business', async ({ request }) => {
    const user = await register(request, 'Multisector Owner');
    const fixtures: TenantFixture[] = [
      { label: 'Pizza Multi', industry: 'Pizzeria', subIndustry: 'Napoletana', services: 'pizza, prenotazioni', differentiator: 'forno tradizionale', target: ['clienti locali'], siteSlug: 'pizza-multi' },
      { label: 'CasaChiara Multi', industry: 'Property Manager', subIndustry: 'Affitti brevi', services: 'pricing dinamico, guest care, gestione portali', differentiator: 'report trasparenti', target: ['proprietari'], siteSlug: 'property-multi' },
      { label: 'Network Lab Multi', industry: 'Networker', subIndustry: 'Personal brand', services: 'formazione, community', differentiator: 'educazione senza promesse', target: ['professionisti'], siteSlug: 'network-multi' },
      { label: 'Bottega Multi', industry: 'Servizi locali', subIndustry: 'Assistenza', services: 'assistenza locale, consulenza', differentiator: 'vicinanza e velocità', target: ['residenti'], siteSlug: 'local-multi' },
    ];
    const strategies: any[] = []; for (const fixture of fixtures) strategies.push((await createConfiguredTenant(request, user.token, fixture)).strategy);
    const signatures = strategies.map((strategy) => strategy.pillars.map((pillar: any) => pillar.name).join('|'));
    expect(new Set(signatures).size).toBe(4); expect(signatures[0]).toContain('Prodotto e ingredienti'); expect(signatures[1]).toContain('Educazione proprietari'); expect(signatures[2]).toContain('Personal brand'); expect(signatures[3]).toContain('Presenza locale');
  });

  test('publisher failure modes produce coherent retry/failure states including success-after-timeout reconciliation', async ({ request }) => {
    const user = await register(request, 'Failure Owner');
    const tenant = await createConfiguredTenant(request, user.token, { label: 'Failure Local', industry: 'Servizi locali', subIndustry: 'Assistenza', services: 'assistenza locale', differentiator: 'risposta rapida', target: ['residenti'], siteSlug: 'local-failure', platforms: ['facebook'], modes: { facebook: 'auto' }, postsPerWeek: 3 });
    await api(request, user.token, `/tenants/${tenant.tenantId}/calendar`, { method: 'POST', data: { weeks: 1 } }); await api(request, user.token, `/tenants/${tenant.tenantId}/posts/generate-all`, { method: 'POST', data: { limit: 3 } });
    let workspace = await api<Workspace>(request, user.token, `/tenants/${tenant.tenantId}/workspace`); const posts = workspace.posts; expect(posts.length).toBe(3);
    const timeout = await api<any[]>(request, user.token, `/tenants/${tenant.tenantId}/publish-now`, { method: 'POST', data: { postId: posts[0].id, failureMode: 'provider_timeout' } }); expect(timeout.some((item) => item.status === 'retry_wait')).toBe(true);
    const recovered = await api<any[]>(request, user.token, `/tenants/${tenant.tenantId}/publish-now`, { method: 'POST', data: { postId: posts[0].id } }); expect(recovered.some((item) => item.status === 'succeeded')).toBe(true);
    const timeoutAfterSuccess = await api<any[]>(request, user.token, `/tenants/${tenant.tenantId}/publish-now`, { method: 'POST', data: { postId: posts[1].id, failureMode: 'success_after_timeout' } }); expect(timeoutAfterSuccess.some((item) => item.error === 'timeout_after_success')).toBe(true);
    const externalId = timeoutAfterSuccess.find((item) => item.externalPostId)?.externalPostId;
    const reconcile = await api<any[]>(request, user.token, `/tenants/${tenant.tenantId}/publish-now`, { method: 'POST', data: { postId: posts[1].id } }); expect(reconcile.find((item) => item.status === 'succeeded')?.externalPostId).toBe(externalId);
    const validation = await api<any[]>(request, user.token, `/tenants/${tenant.tenantId}/publish-now`, { method: 'POST', data: { postId: posts[2].id, failureMode: 'validation_error' } }); expect(validation.some((item) => item.status === 'failed')).toBe(true);
    workspace = await api<Workspace>(request, user.token, `/tenants/${tenant.tenantId}/workspace`); expect(workspace.jobs.some((job: any) => job.status === 'failed' && job.last_error_code === 'validation_error')).toBe(true);
  });
});
