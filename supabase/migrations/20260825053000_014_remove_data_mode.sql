-- Post Automatici has one product state. Test fixtures belong only to the test harness,
-- never to a tenant-selectable DEMO/REAL mode.

alter table public.tenants
  drop constraint if exists tenants_data_mode_check;

alter table public.tenants
  drop column if exists data_mode;
