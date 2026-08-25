-- Master platform configuration. Secrets are server-only and encrypted before storage.

create schema if not exists app_private;

create table if not exists app_private.platform_api_settings (
  provider text primary key check (provider in ('openai','meta','linkedin','google_business_profile','telegram')),
  secret_ciphertext bytea not null,
  key_version integer not null default 1,
  cipher_algorithm text not null default 'aes-256-gcm',
  configured_fields jsonb not null default '[]'::jsonb,
  public_config jsonb not null default '{}'::jsonb,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on app_private.platform_api_settings from anon, authenticated;
grant all on app_private.platform_api_settings to service_role;
