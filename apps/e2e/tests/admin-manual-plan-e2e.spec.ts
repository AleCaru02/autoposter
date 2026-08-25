import { expect, test } from '@playwright/test';

const API=process.env.LOCAL_API_URL??'http://127.0.0.1:8787';
const jsonHeaders={'content-type':'application/json'};

test('platform admin manages a first client without alternate product modes',async({request})=>{
  const suffix=`${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const register=await request.post(`${API}/auth/register`,{data:{name:'Manual Admin Test',email:`manual-admin-${suffix}@example.test`,password:'StrongPass!123'}});expect(register.ok()).toBeTruthy();const session=await register.json();const auth={authorization:`Bearer ${session.access_token}`,...jsonHeaders};
  const tenantResponse=await request.post(`${API}/tenants`,{headers:auth,data:{name:'Client Manual Plan',slug:`client-${suffix}`}});expect(tenantResponse.ok()).toBeTruthy();const {tenantId}=await tenantResponse.json();
  const grant=await request.post(`${API}/dev/grant-platform-admin`,{headers:auth});expect(grant.ok()).toBeTruthy();
  const snapshot=await request.get(`${API}/admin/customers`,{headers:auth});expect(snapshot.ok()).toBeTruthy();const admin=await snapshot.json();const created=admin.tenants.find((tenant:any)=>tenant.id===tenantId);expect(created).toBeTruthy();expect(created).not.toHaveProperty('data_mode');expect(admin.plans.some((plan:any)=>plan.code==='local-dev')).toBe(true);

  const plan=await request.post(`${API}/admin/tenants/${tenantId}/plan`,{headers:auth,data:{planCode:'local-dev'}});expect(plan.ok()).toBeTruthy();
  const overrides=await request.patch(`${API}/admin/tenants/${tenantId}/overrides`,{headers:auth,data:{overrides:{posts_per_week:7,website_page_limit:25},reason:'E2E manual client'}});expect(overrides.ok()).toBeTruthy();
  const budget=await request.patch(`${API}/admin/tenants/${tenantId}/ai-budget`,{headers:auth,data:{currency:'USD',softLimitMicrounits:5_000_000,hardLimitMicrounits:10_000_000,enabled:true}});expect(budget.ok()).toBeTruthy();
  const suspended=await request.patch(`${API}/admin/tenants/${tenantId}/status`,{headers:auth,data:{status:'suspended'}});expect(suspended.ok()).toBeTruthy();
  const active=await request.patch(`${API}/admin/tenants/${tenantId}/status`,{headers:auth,data:{status:'active'}});expect(active.ok()).toBeTruthy();

  const removedModeRoute=await request.patch(`${API}/admin/tenants/${tenantId}/data-mode`,{headers:auth,data:{dataMode:'REAL'}});expect(removedModeRoute.status()).toBe(404);

  const deletion=await request.post(`${API}/tenants/${tenantId}/lifecycle/delete-request`,{headers:auth,data:{scope:'TENANT',reason:'E2E request only'}});expect(deletion.ok()).toBeTruthy();expect((await deletion.json()).status).toBe('REQUESTED');

  const finalSnapshot=await request.get(`${API}/admin/customers`,{headers:auth});expect(finalSnapshot.ok()).toBeTruthy();const finalAdmin=await finalSnapshot.json();expect(finalAdmin.aiBudgets.some((item:any)=>item.tenant_id===tenantId&&item.hard_limit_microunits===10_000_000)).toBe(true);expect(finalAdmin.deletions.some((item:any)=>item.tenant_id===tenantId)).toBe(true);expect(finalAdmin.subscriptions.some((item:any)=>item.tenant_id===tenantId&&item.provider==='manual'&&item.status==='active')).toBe(true);
});

test('non-admin cannot mutate manual customer controls',async({request})=>{
  const suffix=`${Date.now()}-${Math.random().toString(16).slice(2)}`;const register=await request.post(`${API}/auth/register`,{data:{name:'Not Admin',email:`not-admin-${suffix}@example.test`,password:'StrongPass!123'}});expect(register.ok()).toBeTruthy();const session=await register.json();const auth={authorization:`Bearer ${session.access_token}`,...jsonHeaders};const tenant=await request.post(`${API}/tenants`,{headers:auth,data:{name:'Tenant Guard',slug:`guard-${suffix}`}});const {tenantId}=await tenant.json();const attempt=await request.patch(`${API}/admin/tenants/${tenantId}/status`,{headers:auth,data:{status:'suspended'}});expect(attempt.status()).toBe(403);});
