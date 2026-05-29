-- CMO 24-hour training mode
alter table public.cmo_posting_settings
  add column if not exists training_mode_until timestamptz,
  add column if not exists training_mode_enabled_at timestamptz,
  add column if not exists training_mode_enabled_by text;
create index if not exists cmo_posting_settings_training_mode_idx
  on public.cmo_posting_settings(tenant_id, training_mode_until)
  where training_mode_until is not null;
