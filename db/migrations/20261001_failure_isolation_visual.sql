-- Failure isolation: preserve completed copy when visual generation fails.
-- A visual retry must not rerun research/fact-check/copy.

alter table public.content_variants
  add column if not exists visual_generation_status text not null default 'NOT_STARTED',
  add column if not exists visual_generation_error text,
  add column if not exists visual_generation_operation_id text,
  add column if not exists visual_generation_started_at timestamptz,
  add column if not exists visual_generation_updated_at timestamptz;

do $$ begin
  alter table public.content_variants
    add constraint content_variants_visual_generation_status_check
    check (visual_generation_status in ('NOT_STARTED','GENERATING','PASS','FAIL'));
exception when duplicate_object then null; end $$;

create index if not exists content_variants_profile_visual_generation_idx
  on public.content_variants(profile_id, visual_generation_status, updated_at desc);

alter table public.content_carousel_slides
  add column if not exists visual_generation_status text not null default 'NOT_STARTED',
  add column if not exists visual_generation_error text,
  add column if not exists visual_generation_operation_id text,
  add column if not exists visual_generation_started_at timestamptz,
  add column if not exists visual_generation_updated_at timestamptz;

do $$ begin
  alter table public.content_carousel_slides
    add constraint content_carousel_slides_visual_generation_status_check
    check (visual_generation_status in ('NOT_STARTED','GENERATING','PASS','FAIL'));
exception when duplicate_object then null; end $$;

create index if not exists content_carousel_slides_profile_visual_generation_idx
  on public.content_carousel_slides(profile_id, visual_generation_status, updated_at desc);
