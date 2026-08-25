import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:8787';
const password = 'LocalE2E-password-123!';
const consoleErrors = (page: Page) => { const errors: string[] = []; page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); }); page.on('pageerror', (error) => errors.push(error.message)); return errors; };
async function session(page: Page) { return page.evaluate(() => ({ token: localStorage.getItem('post-automatici.session.token'), tenantId: localStorage.getItem('post-automatici.active-tenant') })); }
async function api<T>(request: APIRequestContext, token: string | null, path: string, method = 'GET', data?: unknown): Promise<T> { const response = await request.fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(data === undefined ? {} : { data }) }); const body = await response.json().catch(() => ({})); if (!response.ok()) throw new Error(`${response.status()} ${path}: ${JSON.stringify(body)}`); return body as T; }
async function setSession(page:Page,token:string,tenantId:string){await page.goto('/');await page.evaluate(({token,tenantId})=>{localStorage.setItem('post-automatici.session.token',token);localStorage.setItem('post-automatici.active-tenant',tenantId);localStorage.removeItem('socialpilot.local.token');localStorage.removeItem('socialpilot.local.tenant');},{token,tenantId});}

async function setupFixtureTenant(request:APIRequestContext,label:string){
  const email=`browser-fixture-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
  const auth=await api<any>(request,null,'/auth/register','POST',{email,password,name:label});
  const token=auth.access_token as string;
  const tenant=await api<{tenantId:string}>(request,token,'/tenants','POST',{name:label,slug:`${label}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9]+/g,'-')});
  const tenantId=tenant.tenantId;
  await api(request,token,`/tenants/${tenantId}/onboarding`,'PATCH',{business:{name:label,website:`${API}/fixture-site/local-browser/`,industry:'Servizi locali',subIndustry:'Assistenza',location:'Milano',language:'it',services:'assistenza locale',differentiator:'risposta rapida'},current_step:'goals'});
  await api(request,token,`/tenants/${tenantId}/onboarding`,'PATCH',{goals:['lead'],current_step:'target'});
  await api(request,token,`/tenants/${tenantId}/onboarding`,'PATCH',{target:{manual:['residenti'],suggestions:[]},current_step:'brand'});
  await api(request,token,`/tenants/${tenantId}/scan`,'POST',{});
  await api(request,token,`/tenants/${tenantId}/brand/status`,'POST',{status:'confirmed'});
  await api(request,token,`/tenants/${tenantId}/social`,'POST',{platforms:['facebook'],publishingModes:{facebook:'auto'}});
  await api(request,token,`/tenants/${tenantId}/onboarding`,'PATCH',{frequency:{postsPerWeek:1,days:[1],times:['10:00']},publishing_modes:{facebook:'auto'},current_step:'summary'});
  await api(request,token,`/tenants/${tenantId}/onboarding/complete`,'POST',{});
  return{token,tenantId};
}

test('browser completes onboarding → OpenAI workflow → preview → approval → publishing → analytics', async ({ page, request }) => {
  const errors = consoleErrors(page); const email = `browser-${Date.now()}@example.test`;
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: 'Crea il tuo workspace' })).toBeVisible();
  await page.getByTestId('register-name').fill('Browser Pizzeria Owner');
  await page.getByTestId('register-email').fill(email);
  await page.getByTestId('register-password').fill(password);
  await page.getByTestId('register-submit').click();

  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByText('Dati di base')).toBeVisible();
  await page.getByTestId('business-name').fill('Pizzeria Browser Milano');
  await page.getByTestId('business-website').fill(`${API}/fixture-site/pizza-browser/`);
  await page.getByTestId('onboarding-business-next').click();
  await expect(page.getByText('Cosa deve ottenere il piano editoriale?')).toBeVisible();
  await page.getByTestId('goal-lead').check();
  await page.getByTestId('onboarding-goals-next').click();
  await expect(page.getByText('Pubblico principale')).toBeVisible();
  await page.getByTestId('target-input').fill('famiglie locali, gruppi, professionisti del quartiere');
  await page.getByTestId('onboarding-target-next').click();

  await expect(page.getByRole('heading', { name: 'Analisi pagina per pagina' })).toBeVisible();
  await page.getByTestId('scan-website').click();
  await expect(page.getByText(/Copertura \d+%/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pizzeria Browser Milano' })).toBeVisible();
  await page.getByTestId('confirm-brand').click();

  await expect(page.getByRole('heading', { name: 'Canali da gestire' })).toBeVisible();
  for(const platform of ['instagram','facebook','linkedin','google_business_profile'])await page.getByTestId(`platform-${platform}`).check();
  await page.getByTestId('onboarding-social-next').click();
  await expect(page.getByText('Ritmo editoriale')).toBeVisible();
  await page.getByTestId('posts-per-week').fill('3');
  await page.getByTestId('onboarding-frequency-next').click();

  await expect(page.getByRole('heading', { name: 'Come pubblicare dopo la tua approvazione' })).toBeVisible();
  await page.getByTestId('mode-instagram').selectOption('manual');
  await page.getByTestId('mode-facebook').selectOption('auto');
  await page.getByTestId('mode-linkedin').selectOption('auto');
  await page.getByTestId('mode-google_business_profile').selectOption('manual');
  await page.getByTestId('onboarding-publishing-next').click();
  await expect(page.getByRole('heading', { name: 'Profilo pronto' })).toBeVisible();
  await page.getByTestId('complete-onboarding').click();

  await expect(page).toHaveURL(/\/app\/strategy$/);
  await expect(page.getByRole('heading', { name: 'Regole editoriali dell’attività' })).toBeVisible();
  await page.goto('/app/calendar');
  await expect(page.getByTestId('generate-calendar')).toBeEnabled();
  await page.getByTestId('generate-calendar').click();
  await expect(page.getByText('Calendario generato e salvato per questa attività.')).toBeVisible({timeout:30_000});
  await expect(page.getByTestId('generate-content')).toBeEnabled();
  await page.getByTestId('generate-content').click();
  await expect(page.getByText(/Contenuti generati\. Ogni variante resta ferma/)).toBeVisible({ timeout: 30_000 });

  await page.goto('/approvals');
  await expect(page.getByRole('heading', { name: 'Anteprime da approvare' })).toBeVisible();
  const firstApprove = page.locator('[data-testid^="approve-"]').first();
  await expect(firstApprove).toBeVisible();
  await expect(page.locator('.approval-preview img').first()).toBeVisible({timeout:30_000});
  await firstApprove.click();
  await expect(page.getByText(/Approvato/)).toBeVisible();

  const current = await session(page);
  expect(current.token).toBeTruthy(); expect(current.tenantId).toBeTruthy();
  const token = current.token!; const tenantId = current.tenantId!;
  let workspace = await api<any>(request, token, `/tenants/${tenantId}/workspace`);
  for (const post of workspace.posts) for (const variant of post.variants.filter((item: any) => item.platform_decision !== 'skip' && item.approval_status === 'pending')) await api(request, token, `/tenants/${tenantId}/variants/${variant.id}/approve`, 'POST', {});
  workspace = await api<any>(request, token, `/tenants/${tenantId}/workspace`);
  for (const post of workspace.posts.filter((item: any) => item.status === 'approved')) await api(request, token, `/tenants/${tenantId}/posts/${post.id}/schedule`, 'POST', {});
  await api(request, token, `/tenants/${tenantId}/publish-now`, 'POST', {});
  await api(request, token, `/tenants/${tenantId}/learning/refresh`, 'POST', {});

  await page.goto('/app');
  await expect(page.getByRole('heading', { name: /Cosa richiede attenzione in Pizzeria Browser Milano/ })).toBeVisible();
  await expect(page.getByText('Pubblicati')).toBeVisible();
  await expect(page.getByText(/mock/i)).toHaveCount(0);
  await page.goto('/app/analytics');
  await expect(page.getByRole('heading', { name: 'Performance reali' })).toBeVisible();
  await expect(page.getByText('Dati provider').first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(2);
  expect(errors, `browser console/page errors: ${errors.join('\n')}`).toEqual([]);
});

test('browser hides debug publishing controls and human gate blocks queue before approval', async ({ page, request }) => {
  const errors=consoleErrors(page);
  const fixture=await setupFixtureTenant(request,'Human Gate Browser');
  await api(request,fixture.token,`/tenants/${fixture.tenantId}/calendar`,'POST',{weeks:1});
  await api(request,fixture.token,`/tenants/${fixture.tenantId}/posts/generate-all`,'POST',{limit:3});
  let workspace=await api<any>(request,fixture.token,`/tenants/${fixture.tenantId}/workspace`);
  expect(workspace.jobs.filter((job:any)=>['queued','retry_wait'].includes(job.status))).toEqual([]);
  const attempted=await api<any[]>(request,fixture.token,`/tenants/${fixture.tenantId}/publish-now`,'POST',{failureMode:'rate_limit'});
  expect(attempted).toEqual([]);

  await setSession(page,fixture.token,fixture.tenantId);
  await page.goto(`/app/posts/${workspace.posts[0].id}`);
  await expect(page.locator('[data-testid="failure-mode"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="publish-now"]')).toHaveCount(0);
  await page.goto('/approvals');
  await expect(page.getByRole('heading',{name:'Anteprime da approvare'})).toBeVisible();
  await expect(page.locator('[data-testid^="approve-"]').first()).toBeVisible();

  const deniedAdmin = await request.get(`${API}/admin`, { headers: { authorization: `Bearer ${fixture.token}` } });
  expect(deniedAdmin.status()).toBe(403);
  await page.goto('/admin');
  await expect(page.getByText(/Backend non collegato|Accesso amministratore|amministr/i).first()).toBeVisible();
  expect(errors, `browser console/page errors: ${errors.join('\n')}`).toEqual([]);
});
