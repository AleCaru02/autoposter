-- Post Automatici - private assets and visual renders on Neon.
-- Binary files stay server-only in app_private; metadata remains tenant-scoped via RLS.

create table if not exists app_private.binary_objects(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bucket text not null check(bucket in ('brand-assets','post-assets','tenant-documents')),
  object_path text not null,
  mime_type text not null,
  object_bytes bytea not null,
  byte_size bigint not null check(byte_size>=0),
  content_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(bucket,object_path),
  unique(tenant_id,bucket,content_hash,object_path)
);
create index if not exists binary_objects_tenant_bucket_idx on app_private.binary_objects(tenant_id,bucket,created_at desc);
revoke all on app_private.binary_objects from public,anonymous,authenticated;

create table if not exists public.brand_assets(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null,
  storage_bucket text not null default 'brand-assets',
  storage_path text not null,
  original_filename text,
  mime_type text,
  bytes bigint check(bytes is null or bytes>=0),
  width integer,height integer,
  tags text[] not null default '{}',
  classification_confidence numeric(5,4),
  content_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  asset_type text not null default 'generic_photo' check(asset_type in ('logo','logo_alt','product','service','property','food','team','person','interior','exterior','testimonial','screenshot','document','brochure','background','generic_photo','generated_visual')),
  source text not null default 'upload' check(source in ('upload','website','generated','imported')),
  description text,alt_text text,
  dominant_colors text[] not null default '{}',
  suitable_platforms text[] not null default '{}',
  suitable_topics text[] not null default '{}',
  quality_score numeric(5,4) check(quality_score is null or quality_score between 0 and 1),
  is_brand_locked boolean not null default false,
  is_preferred boolean not null default false,
  status text not null default 'ACTIVE' check(status in ('ACTIVE','ARCHIVED','BLOCKED')),
  thumbnail_path text,
  thumbnail_small_path text,
  thumbnail_medium_path text,
  thumbnail_status text not null default 'pending' check(thumbnail_status in ('pending','processing','ready','failed','not_applicable')),
  thumbnail_metadata jsonb not null default '{}'::jsonb,
  index_status text not null default 'not_applicable' check(index_status in ('not_applicable','pending','ready','failed')),
  usage_count integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,storage_bucket,storage_path),
  unique(tenant_id,id)
);
create unique index if not exists brand_assets_tenant_content_hash_uidx on public.brand_assets(tenant_id,content_hash) where content_hash is not null;
create index if not exists brand_assets_status_type_idx on public.brand_assets(tenant_id,status,asset_type,created_at desc);

alter table public.brand_profiles
  add constraint brand_profiles_primary_logo_tenant_fk foreign key(tenant_id,primary_logo_asset_id) references public.brand_assets(tenant_id,id) on delete set null(primary_logo_asset_id);
alter table public.brand_profiles
  add constraint brand_profiles_alt_logo_tenant_fk foreign key(tenant_id,alternate_logo_asset_id) references public.brand_assets(tenant_id,id) on delete set null(alternate_logo_asset_id);

create table if not exists public.post_assets(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  post_variant_id uuid not null,
  asset_id uuid,
  source_type text not null check(source_type in ('real_asset','deterministic_graphic','ai_generated')),
  storage_bucket text,
  storage_path text,
  role text not null default 'primary',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key(tenant_id,post_variant_id) references public.post_variants(tenant_id,id) on delete cascade,
  foreign key(tenant_id,asset_id) references public.brand_assets(tenant_id,id) on delete set null(asset_id)
);

create table if not exists public.visual_template_profiles(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  preferred_templates text[] not null default '{}',variants jsonb not null default '{}'::jsonb,
  spacing text not null default 'balanced' check(spacing in ('compact','balanced','airy')),
  image_ratio text not null default 'adaptive' check(image_ratio in ('adaptive','square','portrait','landscape')),
  text_density text not null default 'medium' check(text_density in ('low','medium','high')),
  logo_position text not null default 'top_right' check(logo_position in ('top_left','top_right','bottom_left','bottom_right','hidden')),
  border_style text not null default 'soft' check(border_style in ('none','soft','strong')),
  cta_style text not null default 'pill' check(cta_style in ('pill','underline','boxed','minimal')),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.asset_usage_history(
  id bigint generated always as identity primary key,tenant_id uuid not null references public.tenants(id) on delete cascade,asset_id uuid not null,post_variant_id uuid,platform text,template_key text,visual_type text,visual_fingerprint text,used_at timestamptz not null default now(),metadata jsonb not null default '{}'::jsonb,
  foreign key(tenant_id,asset_id) references public.brand_assets(tenant_id,id) on delete cascade,
  foreign key(tenant_id,post_variant_id) references public.post_variants(tenant_id,id) on delete set null(post_variant_id)
);
create table if not exists public.visual_renders(
  id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id) on delete cascade,post_variant_id uuid not null,selected_asset_id uuid,render_version integer not null,visual_type text not null,template_key text not null,format text not null check(format in ('square','portrait','landscape')),width integer not null check(width>0),height integer not null check(height>0),storage_bucket text not null default 'post-assets',storage_paths text[] not null default '{}',preview_path text,status text not null default 'ready' check(status in ('ready','qa_failed','superseded')),visual_spec jsonb not null default '{}'::jsonb,qa_result jsonb not null default '{}'::jsonb,fingerprint text not null,created_at timestamptz not null default now(),unique(post_variant_id,render_version),unique(tenant_id,id),
  foreign key(tenant_id,post_variant_id) references public.post_variants(tenant_id,id) on delete cascade,
  foreign key(tenant_id,selected_asset_id) references public.brand_assets(tenant_id,id) on delete set null(selected_asset_id)
);
create table if not exists public.content_component_versions(
  id bigint generated always as identity primary key,tenant_id uuid not null references public.tenants(id) on delete cascade,post_variant_id uuid not null,component text not null check(component in ('hook','caption','hashtags','cta','visual','fact_claim')),version integer not null,value jsonb not null,reason text,repair_action text,is_current boolean not null default true,created_by uuid,created_at timestamptz not null default now(),unique(post_variant_id,component,version),foreign key(tenant_id,post_variant_id) references public.post_variants(tenant_id,id) on delete cascade
);
create table if not exists public.visual_qa_issues(
  id bigint generated always as identity primary key,tenant_id uuid not null references public.tenants(id) on delete cascade,post_variant_id uuid not null,visual_render_id uuid,issue_code text not null,affected_component text not null,severity text not null check(severity in ('warning','error','blocker')),repair_action text,status text not null default 'open' check(status in ('open','repaired','blocked','accepted')),details jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),resolved_at timestamptz,
  foreign key(tenant_id,post_variant_id) references public.post_variants(tenant_id,id) on delete cascade,
  foreign key(tenant_id,visual_render_id) references public.visual_renders(tenant_id,id) on delete cascade
);

create trigger brand_assets_set_updated_at before update on public.brand_assets for each row execute function public.set_updated_at();
create trigger visual_template_profiles_set_updated_at before update on public.visual_template_profiles for each row execute function public.set_updated_at();

alter table public.brand_assets enable row level security;
alter table public.post_assets enable row level security;
alter table public.visual_template_profiles enable row level security;
alter table public.asset_usage_history enable row level security;
alter table public.visual_renders enable row level security;
alter table public.content_component_versions enable row level security;
alter table public.visual_qa_issues enable row level security;

create policy brand_assets_member_read on public.brand_assets for select to authenticated using(public.is_tenant_member(tenant_id));
create policy brand_assets_editor_insert on public.brand_assets for insert to authenticated with check(public.has_tenant_role(tenant_id,array['owner','admin','editor']));
create policy brand_assets_editor_update on public.brand_assets for update to authenticated using(public.has_tenant_role(tenant_id,array['owner','admin','editor'])) with check(public.has_tenant_role(tenant_id,array['owner','admin','editor']));
create policy brand_assets_editor_delete on public.brand_assets for delete to authenticated using(public.has_tenant_role(tenant_id,array['owner','admin','editor']));
create policy post_assets_member_read on public.post_assets for select to authenticated using(public.is_tenant_member(tenant_id));
create policy visual_template_member_read on public.visual_template_profiles for select to authenticated using(public.is_tenant_member(tenant_id));
create policy visual_template_editor_insert on public.visual_template_profiles for insert to authenticated with check(public.has_tenant_role(tenant_id,array['owner','admin','editor']));
create policy visual_template_editor_update on public.visual_template_profiles for update to authenticated using(public.has_tenant_role(tenant_id,array['owner','admin','editor'])) with check(public.has_tenant_role(tenant_id,array['owner','admin','editor']));
create policy asset_usage_member_read on public.asset_usage_history for select to authenticated using(public.is_tenant_member(tenant_id));
create policy visual_renders_member_read on public.visual_renders for select to authenticated using(public.is_tenant_member(tenant_id));
create policy component_versions_member_read on public.content_component_versions for select to authenticated using(public.is_tenant_member(tenant_id));
create policy visual_qa_member_read on public.visual_qa_issues for select to authenticated using(public.is_tenant_member(tenant_id));

grant select,insert,update,delete on public.brand_assets,public.visual_template_profiles to authenticated;
grant select on public.post_assets,public.asset_usage_history,public.visual_renders,public.content_component_versions,public.visual_qa_issues to authenticated;
