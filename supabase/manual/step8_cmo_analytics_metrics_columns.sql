create table if not exists public.content_metrics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  content_history_id uuid not null references public.content_history(id) on delete cascade,
  run_id text,
  platform text,
  impressions integer not null default 0,
  clicks integer not null default 0,
  likes integer not null default 0,
  comments integer not null default 0,
  shares integer not null default 0,
  engagement_rate numeric not null default 0,
  source text not null default 'unknown',
  metadata jsonb not null default '{}'::jsonb,
  collected_at_utc timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.content_metrics
  add column if not exists run_id text,
  add column if not exists impressions integer not null default 0,
  add column if not exists clicks integer not null default 0,
  add column if not exists likes integer not null default 0,
  add column if not exists comments integer not null default 0,
  add column if not exists shares integer not null default 0,
  add column if not exists engagement_rate numeric not null default 0,
  add column if not exists source text not null default 'unknown',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists collected_at_utc timestamptz not null default now();

create index if not exists content_metrics_run_idx on public.content_metrics(tenant_id, run_id, collected_at_utc desc);
create index if not exists content_metrics_source_idx on public.content_metrics(source, collected_at_utc desc);

grant select, insert, update on table public.content_metrics to authenticated;
grant select, insert, update, delete on table public.content_metrics to service_role;

notify pgrst, 'reload schema';
