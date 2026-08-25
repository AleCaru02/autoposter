-- Findings from the first reproducible local Supabase validation run.
-- Keep trusted server code functional under explicit Data API grants, remove
-- advisor warnings, and preserve deny-by-default client access.

-- The service role bypasses RLS, but PostgreSQL table/function/schema grants
-- are still required. Keep these grants server-only.
grant usage on schema app_private to service_role;
grant all privileges on all tables in schema public, app_private to service_role;
grant all privileges on all sequences in schema public, app_private to service_role;
grant execute on all functions in schema public, app_private to service_role;

alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant all privileges on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
alter default privileges in schema app_private grant all privileges on tables to service_role;
alter default privileges in schema app_private grant all privileges on sequences to service_role;
alter default privileges in schema app_private grant execute on functions to service_role;

-- Supabase Security Advisor: extensions should not live in public.
alter extension vector set schema extensions;

-- Supabase Performance Advisor: initialize auth.uid() once per statement for
-- these policies instead of re-evaluating it for every row.
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
for select to authenticated
using (user_id = (select auth.uid()) or public.is_platform_admin());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists support_conversations_tenant_read on public.support_conversations;
create policy support_conversations_tenant_read on public.support_conversations
for select to authenticated
using (
  public.is_platform_admin()
  or (
    tenant_id is not null
    and public.is_tenant_member(tenant_id)
    and (
      user_id = (select auth.uid())
      or public.has_tenant_role(tenant_id, array['owner','admin'])
    )
  )
);
