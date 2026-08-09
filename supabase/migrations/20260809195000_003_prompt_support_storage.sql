-- Prompt registry, model routing, support knowledge and private Storage buckets.

create table if not exists public.ai_prompts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  task text not null,
  description text,
  active_version integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  prompt_id uuid not null references public.ai_prompts(id) on delete cascade,
  version integer not null,
  content text not null,
  content_sha256 text not null,
  schema_name text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (prompt_id, version)
);

create table if not exists public.model_routes (
  task text primary key,
  tier text not null check (tier in ('simple','medium','complex','image','embedding')),
  model_config_key text not null,
  fallback_config_key text,
  max_output_tokens integer,
  web_search_allowed boolean not null default false,
  image_generation_allowed boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.product_knowledge_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  content text not null,
  category text,
  is_public boolean not null default true,
  content_hash text,
  embedding vector,
  embedding_model text,
  published_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  mode text not null check (mode in ('public','authenticated','human_handoff')),
  public_session_hash text,
  status text not null default 'open' check (status in ('open','closed','human_handoff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((mode = 'public' and tenant_id is null) or mode <> 'public')
);

create table if not exists public.support_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade,
  role text not null check (role in ('user','assistant','system','human')),
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.ai_prompts enable row level security;
alter table public.prompt_versions enable row level security;
alter table public.model_routes enable row level security;
alter table public.product_knowledge_articles enable row level security;
alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;

create policy product_knowledge_public_read on public.product_knowledge_articles
for select to anon, authenticated
using (is_public = true);

grant select on public.product_knowledge_articles to anon, authenticated;

create policy support_conversations_tenant_read on public.support_conversations
for select to authenticated
using (
  public.is_platform_admin()
  or (tenant_id is not null and public.is_tenant_member(tenant_id) and (user_id = auth.uid() or public.has_tenant_role(tenant_id, array['owner','admin'])))
);
create policy support_messages_tenant_read on public.support_messages
for select to authenticated
using (
  public.is_platform_admin()
  or (tenant_id is not null and public.is_tenant_member(tenant_id))
);
grant select on public.support_conversations, public.support_messages to authenticated;

-- Public chatbot writes through a server endpoint only. No anon insert/update policies.
-- Prompt/model tables are server/admin managed only; no public write policies.

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('brand-assets', 'brand-assets', false, 52428800),
  ('post-assets', 'post-assets', false, 52428800),
  ('tenant-documents', 'tenant-documents', false, 52428800)
on conflict (id) do nothing;

create or replace function public.storage_path_tenant_id(p_name text)
returns uuid
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_first text;
begin
  v_first := split_part(p_name, '/', 1);
  if v_first !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return null;
  end if;
  return v_first::uuid;
exception when others then
  return null;
end;
$$;

grant execute on function public.storage_path_tenant_id(text) to authenticated;

create policy tenant_asset_read on storage.objects
for select to authenticated
using (
  bucket_id in ('brand-assets','post-assets','tenant-documents')
  and public.is_tenant_member(public.storage_path_tenant_id(name))
);

create policy tenant_asset_insert on storage.objects
for insert to authenticated
with check (
  bucket_id in ('brand-assets','post-assets','tenant-documents')
  and public.has_tenant_role(public.storage_path_tenant_id(name), array['owner','admin','editor'])
);

create policy tenant_asset_update on storage.objects
for update to authenticated
using (
  bucket_id in ('brand-assets','post-assets','tenant-documents')
  and public.has_tenant_role(public.storage_path_tenant_id(name), array['owner','admin','editor'])
)
with check (
  bucket_id in ('brand-assets','post-assets','tenant-documents')
  and public.has_tenant_role(public.storage_path_tenant_id(name), array['owner','admin','editor'])
);

create policy tenant_asset_delete on storage.objects
for delete to authenticated
using (
  bucket_id in ('brand-assets','post-assets','tenant-documents')
  and public.has_tenant_role(public.storage_path_tenant_id(name), array['owner','admin','editor'])
);
