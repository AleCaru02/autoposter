-- One-time Telegram pairing tokens are server-only and never exposed through the client API.

create table if not exists app_private.telegram_pairing_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token_hash text not null unique,
  requested_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists telegram_pairing_requests_tenant_idx
  on app_private.telegram_pairing_requests(tenant_id, created_at desc);

revoke all on app_private.telegram_pairing_requests from anon, authenticated;
