-- Strengthen relational tenant isolation by preventing cross-tenant foreign-key references.
-- RLS blocks row visibility; these composite FKs also protect data integrity when IDs are guessed or supplied directly.

-- Fix public plan read policy so anon never needs the admin helper privilege.
drop policy if exists plans_select_active on public.plans;
create policy plans_select_anon on public.plans
for select to anon
using (status = 'active');
create policy plans_select_authenticated on public.plans
for select to authenticated
using (status = 'active' or public.is_platform_admin());

-- Parent keys used by tenant-consistent composite foreign keys.
create unique index if not exists websites_tenant_id_id_uidx on public.websites(tenant_id, id);
create unique index if not exists website_scans_tenant_id_id_uidx on public.website_scans(tenant_id, id);
create unique index if not exists brand_profiles_tenant_id_id_uidx on public.brand_profiles(tenant_id, id);
create unique index if not exists brand_assets_tenant_id_id_uidx on public.brand_assets(tenant_id, id);
create unique index if not exists social_connections_tenant_id_id_uidx on public.social_connections(tenant_id, id);
create unique index if not exists competitors_tenant_id_id_uidx on public.competitors(tenant_id, id);
create unique index if not exists content_strategies_tenant_id_id_uidx on public.content_strategies(tenant_id, id);
create unique index if not exists content_pillars_tenant_id_id_uidx on public.content_pillars(tenant_id, id);
create unique index if not exists content_ideas_tenant_id_id_uidx on public.content_ideas(tenant_id, id);
create unique index if not exists posts_tenant_id_id_uidx on public.posts(tenant_id, id);
create unique index if not exists post_variants_tenant_id_id_uidx on public.post_variants(tenant_id, id);
create unique index if not exists publication_jobs_tenant_id_id_uidx on public.publication_jobs(tenant_id, id);
create unique index if not exists published_posts_tenant_id_id_uidx on public.published_posts(tenant_id, id);

-- Website graph.
alter table public.website_scans drop constraint if exists website_scans_website_id_fkey;
alter table public.website_scans
  add constraint website_scans_tenant_website_fkey
  foreign key (tenant_id, website_id) references public.websites(tenant_id, id) on delete cascade;

alter table public.website_pages drop constraint if exists website_pages_website_id_fkey;
alter table public.website_pages
  add constraint website_pages_tenant_website_fkey
  foreign key (tenant_id, website_id) references public.websites(tenant_id, id) on delete cascade;

alter table public.website_pages drop constraint if exists website_pages_scan_id_fkey;
alter table public.website_pages
  add constraint website_pages_tenant_scan_fkey
  foreign key (tenant_id, scan_id) references public.website_scans(tenant_id, id) on delete set null (scan_id);

-- Brand graph.
alter table public.brand_profile_locks drop constraint if exists brand_profile_locks_brand_profile_id_fkey;
alter table public.brand_profile_locks
  add constraint brand_profile_locks_tenant_profile_fkey
  foreign key (tenant_id, brand_profile_id) references public.brand_profiles(tenant_id, id) on delete cascade;

alter table public.brand_context_versions drop constraint if exists brand_context_versions_brand_profile_id_fkey;
alter table public.brand_context_versions
  add constraint brand_context_versions_tenant_profile_fkey
  foreign key (tenant_id, brand_profile_id) references public.brand_profiles(tenant_id, id) on delete cascade;

-- Social connection graph.
alter table public.social_accounts drop constraint if exists social_accounts_connection_id_fkey;
alter table public.social_accounts
  add constraint social_accounts_tenant_connection_fkey
  foreign key (tenant_id, connection_id) references public.social_connections(tenant_id, id) on delete cascade;

alter table app_private.integration_credentials drop constraint if exists integration_credentials_connection_id_fkey;
alter table app_private.integration_credentials
  add constraint integration_credentials_tenant_connection_fkey
  foreign key (tenant_id, connection_id) references public.social_connections(tenant_id, id) on delete cascade;

-- Competitor graph.
alter table public.competitor_snapshots drop constraint if exists competitor_snapshots_competitor_id_fkey;
alter table public.competitor_snapshots
  add constraint competitor_snapshots_tenant_competitor_fkey
  foreign key (tenant_id, competitor_id) references public.competitors(tenant_id, id) on delete cascade;

-- Strategy/content graph.
alter table public.content_pillars drop constraint if exists content_pillars_strategy_id_fkey;
alter table public.content_pillars
  add constraint content_pillars_tenant_strategy_fkey
  foreign key (tenant_id, strategy_id) references public.content_strategies(tenant_id, id) on delete cascade;

alter table public.content_ideas drop constraint if exists content_ideas_pillar_id_fkey;
alter table public.content_ideas
  add constraint content_ideas_tenant_pillar_fkey
  foreign key (tenant_id, pillar_id) references public.content_pillars(tenant_id, id) on delete set null (pillar_id);

alter table public.posts drop constraint if exists posts_pillar_id_fkey;
alter table public.posts
  add constraint posts_tenant_pillar_fkey
  foreign key (tenant_id, pillar_id) references public.content_pillars(tenant_id, id) on delete set null (pillar_id);

alter table public.posts drop constraint if exists posts_idea_id_fkey;
alter table public.posts
  add constraint posts_tenant_idea_fkey
  foreign key (tenant_id, idea_id) references public.content_ideas(tenant_id, id) on delete set null (idea_id);

alter table public.post_variants drop constraint if exists post_variants_post_id_fkey;
alter table public.post_variants
  add constraint post_variants_tenant_post_fkey
  foreign key (tenant_id, post_id) references public.posts(tenant_id, id) on delete cascade;

alter table public.post_assets drop constraint if exists post_assets_post_variant_id_fkey;
alter table public.post_assets
  add constraint post_assets_tenant_variant_fkey
  foreign key (tenant_id, post_variant_id) references public.post_variants(tenant_id, id) on delete cascade;

alter table public.post_assets drop constraint if exists post_assets_asset_id_fkey;
alter table public.post_assets
  add constraint post_assets_tenant_asset_fkey
  foreign key (tenant_id, asset_id) references public.brand_assets(tenant_id, id) on delete set null (asset_id);

alter table public.post_approvals drop constraint if exists post_approvals_post_variant_id_fkey;
alter table public.post_approvals
  add constraint post_approvals_tenant_variant_fkey
  foreign key (tenant_id, post_variant_id) references public.post_variants(tenant_id, id) on delete cascade;

alter table public.post_rejections drop constraint if exists post_rejections_post_variant_id_fkey;
alter table public.post_rejections
  add constraint post_rejections_tenant_variant_fkey
  foreign key (tenant_id, post_variant_id) references public.post_variants(tenant_id, id) on delete cascade;

-- Publishing graph.
alter table public.publication_jobs drop constraint if exists publication_jobs_post_variant_id_fkey;
alter table public.publication_jobs
  add constraint publication_jobs_tenant_variant_fkey
  foreign key (tenant_id, post_variant_id) references public.post_variants(tenant_id, id) on delete cascade;

alter table public.publication_attempts drop constraint if exists publication_attempts_publication_job_id_fkey;
alter table public.publication_attempts
  add constraint publication_attempts_tenant_job_fkey
  foreign key (tenant_id, publication_job_id) references public.publication_jobs(tenant_id, id) on delete cascade;

alter table public.published_posts drop constraint if exists published_posts_post_variant_id_fkey;
alter table public.published_posts
  add constraint published_posts_tenant_variant_fkey
  foreign key (tenant_id, post_variant_id) references public.post_variants(tenant_id, id) on delete cascade;

alter table public.published_posts drop constraint if exists published_posts_publication_job_id_fkey;
alter table public.published_posts
  add constraint published_posts_tenant_job_fkey
  foreign key (tenant_id, publication_job_id) references public.publication_jobs(tenant_id, id) on delete set null (publication_job_id);

alter table public.analytics_snapshots drop constraint if exists analytics_snapshots_published_post_id_fkey;
alter table public.analytics_snapshots
  add constraint analytics_snapshots_tenant_published_fkey
  foreign key (tenant_id, published_post_id) references public.published_posts(tenant_id, id) on delete cascade;

-- Feedback/memory graph.
alter table public.feedback_events drop constraint if exists feedback_events_post_variant_id_fkey;
alter table public.feedback_events
  add constraint feedback_events_tenant_variant_fkey
  foreign key (tenant_id, post_variant_id) references public.post_variants(tenant_id, id) on delete set null (post_variant_id);

alter table public.editorial_memory drop constraint if exists editorial_memory_post_id_fkey;
alter table public.editorial_memory
  add constraint editorial_memory_tenant_post_fkey
  foreign key (tenant_id, post_id) references public.posts(tenant_id, id) on delete set null (post_id);

alter table public.editorial_memory drop constraint if exists editorial_memory_pillar_id_fkey;
alter table public.editorial_memory
  add constraint editorial_memory_tenant_pillar_fkey
  foreign key (tenant_id, pillar_id) references public.content_pillars(tenant_id, id) on delete set null (pillar_id);

alter table public.content_fingerprints drop constraint if exists content_fingerprints_post_id_fkey;
alter table public.content_fingerprints
  add constraint content_fingerprints_tenant_post_fkey
  foreign key (tenant_id, post_id) references public.posts(tenant_id, id) on delete cascade;

alter table public.content_fingerprints drop constraint if exists content_fingerprints_post_variant_id_fkey;
alter table public.content_fingerprints
  add constraint content_fingerprints_tenant_variant_fkey
  foreign key (tenant_id, post_variant_id) references public.post_variants(tenant_id, id) on delete cascade;

-- Support graph. Public conversations have tenant_id NULL and messages are written server-side.
-- Tenant-scoped support messages must match their conversation tenant.
create or replace function app_private.enforce_support_message_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conversation_tenant uuid;
begin
  select tenant_id into v_conversation_tenant
  from public.support_conversations
  where id = new.conversation_id;

  if v_conversation_tenant is distinct from new.tenant_id then
    raise exception 'SUPPORT_TENANT_MISMATCH' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app_private.enforce_support_message_tenant() from anon, authenticated;

drop trigger if exists support_messages_enforce_tenant on public.support_messages;
create trigger support_messages_enforce_tenant
before insert or update on public.support_messages
for each row execute function app_private.enforce_support_message_tenant();

-- feedback_events uses an identity sequence and is client-editable by design.
grant usage, select on sequence public.feedback_events_id_seq to authenticated;
