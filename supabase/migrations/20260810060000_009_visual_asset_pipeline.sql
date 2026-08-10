-- Persistent local visual/asset pipeline. Provider-neutral and safe for a future dedicated Supabase project.

alter table public.brand_assets
  add column if not exists asset_type text not null default 'generic_photo',
  add column if not exists source text not null default 'upload',
  add column if not exists description text,
  add column if not exists alt_text text,
  add column if not exists dominant_colors text[] not null default '{}',
  add column if not exists suitable_platforms text[] not null default '{}',
  add column if not exists suitable_topics text[] not null default '{}',
  add column if not exists quality_score numeric(5,4),
  add column if not exists is_brand_locked boolean not null default false,
  add column if not exists is_preferred boolean not null default false,
  add column if not exists status text not null default 'ACTIVE',
  add column if not exists thumbnail_path text,
  add column if not exists index_status text not null default 'not_applicable',
  add column if not exists usage_count integer not null default 0,
  add column if not exists last_used_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.brand_assets drop constraint if exists brand_assets_asset_type_check;
alter table public.brand_assets add constraint brand_assets_asset_type_check check (asset_type in (
  'logo','logo_alt','product','service','property','food','team','person','interior','exterior',
  'testimonial','screenshot','document','brochure','background','generic_photo','generated_visual'
));
alter table public.brand_assets drop constraint if exists brand_assets_source_check;
alter table public.brand_assets add constraint brand_assets_source_check check (source in ('upload','website','generated','imported'));
alter table public.brand_assets drop constraint if exists brand_assets_status_check;
alter table public.brand_assets add constraint brand_assets_status_check check (status in ('ACTIVE','ARCHIVED','BLOCKED'));
alter table public.brand_assets drop constraint if exists brand_assets_index_status_check;
alter table public.brand_assets add constraint brand_assets_index_status_check check (index_status in ('not_applicable','pending','ready','failed'));
alter table public.brand_assets drop constraint if exists brand_assets_quality_score_check;
alter table public.brand_assets add constraint brand_assets_quality_score_check check (quality_score is null or (quality_score >= 0 and quality_score <= 1));

create unique index if not exists brand_assets_tenant_content_hash_unique
  on public.brand_assets(tenant_id, content_hash) where content_hash is not null;
create index if not exists brand_assets_tenant_status_type_idx
  on public.brand_assets(tenant_id, status, asset_type, created_at desc);
create index if not exists brand_assets_tenant_usage_idx
  on public.brand_assets(tenant_id, last_used_at nulls first, usage_count);

alter table public.brand_profiles
  add column if not exists primary_logo_asset_id uuid,
  add column if not exists alternate_logo_asset_id uuid,
  add column if not exists preferred_visual_style jsonb not null default '{}'::jsonb;

alter table public.brand_profiles drop constraint if exists brand_profiles_primary_logo_tenant_fk;
alter table public.brand_profiles add constraint brand_profiles_primary_logo_tenant_fk
  foreign key (tenant_id, primary_logo_asset_id) references public.brand_assets(tenant_id, id)
  on delete set null (primary_logo_asset_id);
alter table public.brand_profiles drop constraint if exists brand_profiles_alt_logo_tenant_fk;
alter table public.brand_profiles add constraint brand_profiles_alt_logo_tenant_fk
  foreign key (tenant_id, alternate_logo_asset_id) references public.brand_assets(tenant_id, id)
  on delete set null (alternate_logo_asset_id);

create table if not exists public.visual_template_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  preferred_templates text[] not null default '{}',
  variants jsonb not null default '{}'::jsonb,
  spacing text not null default 'balanced' check (spacing in ('compact','balanced','airy')),
  image_ratio text not null default 'adaptive' check (image_ratio in ('adaptive','square','portrait','landscape')),
  text_density text not null default 'medium' check (text_density in ('low','medium','high')),
  logo_position text not null default 'top_right' check (logo_position in ('top_left','top_right','bottom_left','bottom_right','hidden')),
  border_style text not null default 'soft' check (border_style in ('none','soft','strong')),
  cta_style text not null default 'pill' check (cta_style in ('pill','underline','boxed','minimal')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.asset_usage_history (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  asset_id uuid not null,
  post_variant_id uuid,
  platform text,
  template_key text,
  visual_type text,
  visual_fingerprint text,
  used_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint asset_usage_asset_tenant_fk foreign key (tenant_id, asset_id)
    references public.brand_assets(tenant_id, id) on delete cascade,
  constraint asset_usage_variant_tenant_fk foreign key (tenant_id, post_variant_id)
    references public.post_variants(tenant_id, id) on delete set null (post_variant_id)
);
create index if not exists asset_usage_recent_idx on public.asset_usage_history(tenant_id, used_at desc);
create index if not exists asset_usage_asset_recent_idx on public.asset_usage_history(tenant_id, asset_id, used_at desc);

create table if not exists public.visual_renders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  post_variant_id uuid not null,
  selected_asset_id uuid,
  render_version integer not null,
  visual_type text not null,
  template_key text not null,
  format text not null check (format in ('square','portrait','landscape')),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  storage_bucket text not null default 'post-assets',
  storage_paths text[] not null default '{}',
  preview_path text,
  status text not null default 'ready' check (status in ('ready','qa_failed','superseded')),
  visual_spec jsonb not null default '{}'::jsonb,
  qa_result jsonb not null default '{}'::jsonb,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  unique (post_variant_id, render_version),
  constraint visual_renders_variant_tenant_fk foreign key (tenant_id, post_variant_id)
    references public.post_variants(tenant_id, id) on delete cascade,
  constraint visual_renders_asset_tenant_fk foreign key (tenant_id, selected_asset_id)
    references public.brand_assets(tenant_id, id) on delete set null (selected_asset_id)
);
create unique index if not exists visual_renders_tenant_id_id_uidx on public.visual_renders(tenant_id, id);
create index if not exists visual_renders_tenant_recent_idx on public.visual_renders(tenant_id, created_at desc);
create index if not exists visual_renders_fingerprint_idx on public.visual_renders(tenant_id, fingerprint, created_at desc);

create table if not exists public.content_component_versions (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  post_variant_id uuid not null,
  component text not null check (component in ('hook','caption','hashtags','cta','visual','fact_claim')),
  version integer not null,
  value jsonb not null,
  reason text,
  repair_action text,
  is_current boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (post_variant_id, component, version),
  constraint component_versions_variant_tenant_fk foreign key (tenant_id, post_variant_id)
    references public.post_variants(tenant_id, id) on delete cascade
);
create index if not exists component_versions_current_idx
  on public.content_component_versions(tenant_id, post_variant_id, component) where is_current;

create table if not exists public.visual_qa_issues (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  post_variant_id uuid not null,
  visual_render_id uuid,
  issue_code text not null,
  affected_component text not null,
  severity text not null check (severity in ('warning','error','blocker')),
  repair_action text,
  status text not null default 'open' check (status in ('open','repaired','blocked','accepted')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint visual_qa_variant_tenant_fk foreign key (tenant_id, post_variant_id)
    references public.post_variants(tenant_id, id) on delete cascade,
  constraint visual_qa_render_tenant_fk foreign key (tenant_id, visual_render_id)
    references public.visual_renders(tenant_id, id) on delete cascade
);

alter table public.visual_template_profiles enable row level security;
alter table public.asset_usage_history enable row level security;
alter table public.visual_renders enable row level security;
alter table public.content_component_versions enable row level security;
alter table public.visual_qa_issues enable row level security;

create policy visual_template_profiles_read on public.visual_template_profiles
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy visual_template_profiles_insert on public.visual_template_profiles
  for insert to authenticated with check (public.has_tenant_role(tenant_id, array['owner','admin','editor']));
create policy visual_template_profiles_update on public.visual_template_profiles
  for update to authenticated using (public.has_tenant_role(tenant_id, array['owner','admin','editor']))
  with check (public.has_tenant_role(tenant_id, array['owner','admin','editor']));
create policy visual_template_profiles_delete on public.visual_template_profiles
  for delete to authenticated using (public.has_tenant_role(tenant_id, array['owner','admin','editor']));

create policy asset_usage_history_read on public.asset_usage_history
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy visual_renders_read on public.visual_renders
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy component_versions_read on public.content_component_versions
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy visual_qa_issues_read on public.visual_qa_issues
  for select to authenticated using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete on public.visual_template_profiles to authenticated;
grant select on public.asset_usage_history, public.visual_renders, public.content_component_versions, public.visual_qa_issues to authenticated;
grant usage, select on sequence public.asset_usage_history_id_seq, public.content_component_versions_id_seq, public.visual_qa_issues_id_seq to service_role;
grant all on public.visual_template_profiles, public.asset_usage_history, public.visual_renders, public.content_component_versions, public.visual_qa_issues to service_role;

update storage.buckets
set public = false
where id in ('brand-assets','post-assets','tenant-documents');
