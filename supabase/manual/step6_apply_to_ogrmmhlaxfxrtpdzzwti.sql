-- Manual Step 6 schema apply for active GOPU OS Supabase project: ogrmmhlaxfxrtpdzzwti
-- Safe/idempotent: no DROP TABLE, no DELETE, no data overwrite.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  action_type text,
  module text not null default 'GOPU OS',
  related_table text,
  related_record_id uuid,
  actor text,
  description text,
  old_value jsonb,
  new_value jsonb,
  risk_level text default 'Low',
  action text,
  actor_role text,
  record_type text,
  record_id text,
  notes text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_logs
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade,
  add column if not exists action_type text,
  add column if not exists related_table text,
  add column if not exists related_record_id uuid,
  add column if not exists actor text,
  add column if not exists description text,
  add column if not exists old_value jsonb,
  add column if not exists new_value jsonb,
  add column if not exists risk_level text default 'Low',
  add column if not exists action text,
  add column if not exists actor_role text,
  add column if not exists record_type text,
  add column if not exists record_id text,
  add column if not exists notes text,
  add column if not exists metadata jsonb default '{}'::jsonb;

create table if not exists public.content_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  run_id text not null,
  platform text not null,
  platform_target text,
  content_type text not null default 'Post',
  campaign_name text,
  region_country text,
  topic text,
  caption text,
  hashtags jsonb not null default '[]'::jsonb,
  image_prompt text,
  poster_url text,
  image_url text,
  generated_text text,
  final_text text,
  final_approved_content text,
  approval_status text not null default 'pending_approval',
  approved_at timestamptz,
  approved_at_utc timestamptz,
  rejected_at timestamptz,
  rejected_at_utc timestamptz,
  slack_message_reference jsonb not null default '{}'::jsonb,
  platform_targets jsonb not null default '[]'::jsonb,
  publish_status text not null default 'not_published',
  live_post_url text,
  post_url text,
  audit_references jsonb not null default '[]'::jsonb,
  ai_quality_review jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  generated_at_utc timestamptz not null default now(),
  scheduled_at_utc timestamptz,
  published_at timestamptz,
  published_at_utc timestamptz,
  timezone text not null default 'Asia/Kolkata',
  country text not null default 'India',
  platform_integration_connected boolean not null default false,
  publish_attempt_count integer not null default 0,
  last_publish_attempt_at timestamptz,
  last_publish_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  approved_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_history_run_platform_unique unique (tenant_id, run_id, platform)
);

alter table public.content_history
  add column if not exists platform_target text,
  add column if not exists caption text,
  add column if not exists hashtags jsonb not null default '[]'::jsonb,
  add column if not exists image_prompt text,
  add column if not exists poster_url text,
  add column if not exists image_url text,
  add column if not exists generated_text text,
  add column if not exists final_text text,
  add column if not exists final_approved_content text,
  add column if not exists approval_status text not null default 'pending_approval',
  add column if not exists approved_at timestamptz,
  add column if not exists approved_at_utc timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_at_utc timestamptz,
  add column if not exists slack_message_reference jsonb not null default '{}'::jsonb,
  add column if not exists platform_targets jsonb not null default '[]'::jsonb,
  add column if not exists publish_status text not null default 'not_published',
  add column if not exists live_post_url text,
  add column if not exists post_url text,
  add column if not exists audit_references jsonb not null default '[]'::jsonb,
  add column if not exists ai_quality_review jsonb not null default '{}'::jsonb,
  add column if not exists generated_at timestamptz not null default now(),
  add column if not exists generated_at_utc timestamptz not null default now(),
  add column if not exists scheduled_at_utc timestamptz,
  add column if not exists published_at timestamptz,
  add column if not exists published_at_utc timestamptz,
  add column if not exists timezone text not null default 'Asia/Kolkata',
  add column if not exists country text not null default 'India',
  add column if not exists platform_integration_connected boolean not null default false,
  add column if not exists publish_attempt_count integer not null default 0,
  add column if not exists last_publish_attempt_at timestamptz,
  add column if not exists last_publish_error text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.content_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  content_history_id uuid not null references public.content_history(id) on delete cascade,
  run_id text,
  version_number integer not null default 1,
  version_type text not null default 'generated',
  caption text,
  hashtags jsonb not null default '[]'::jsonb,
  image_prompt text,
  poster_url text,
  draft_text text,
  final_text text,
  approval_status text,
  audit_references jsonb not null default '[]'::jsonb,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);

alter table public.content_versions
  add column if not exists caption text,
  add column if not exists hashtags jsonb not null default '[]'::jsonb,
  add column if not exists image_prompt text,
  add column if not exists poster_url text,
  add column if not exists draft_text text,
  add column if not exists final_text text,
  add column if not exists approval_status text,
  add column if not exists audit_references jsonb not null default '[]'::jsonb,
  add column if not exists notes text,
  add column if not exists created_by uuid;

create table if not exists public.content_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  content_history_id uuid not null references public.content_history(id) on delete cascade,
  run_id text,
  platform text not null,
  platform_target text,
  link_type text not null default 'poster',
  label text,
  url text not null,
  live_post_url text,
  poster_url text,
  publish_status text not null default 'not_published',
  published_at timestamptz,
  published_at_utc timestamptz,
  timezone text not null default 'Asia/Kolkata',
  country text not null default 'India',
  audit_references jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.content_approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  content_history_id uuid not null references public.content_history(id) on delete cascade,
  run_id text,
  approval_status text not null default 'pending_approval',
  status text not null default 'Pending',
  approved_by uuid,
  approved_at timestamptz,
  approved_at_utc timestamptz,
  rejected_at timestamptz,
  rejected_at_utc timestamptz,
  slack_approval_id text,
  slack_message_reference jsonb not null default '{}'::jsonb,
  audit_references jsonb not null default '[]'::jsonb,
  notes text,
  timezone text not null default 'Asia/Kolkata',
  country text not null default 'India',
  created_at timestamptz not null default now()
);

create table if not exists public.content_metrics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  content_history_id uuid not null references public.content_history(id) on delete cascade,
  platform text,
  metric_name text not null,
  metric_value numeric,
  metric_unit text,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.content_quality_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  content_history_id uuid not null references public.content_history(id) on delete cascade,
  run_id text not null,
  review_status text not null default 'pending_review',
  quality_score numeric check (quality_score is null or (quality_score >= 0 and quality_score <= 100)),
  brand_safety_score numeric check (brand_safety_score is null or (brand_safety_score >= 0 and brand_safety_score <= 100)),
  compliance_score numeric check (compliance_score is null or (compliance_score >= 0 and compliance_score <= 100)),
  risk_flags jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  reviewer text not null default 'AI Quality Review',
  audit_references jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.content_quality_reviews
  add column if not exists review_status text not null default 'pending_review',
  add column if not exists quality_score numeric check (quality_score is null or (quality_score >= 0 and quality_score <= 100)),
  add column if not exists brand_safety_score numeric check (brand_safety_score is null or (brand_safety_score >= 0 and brand_safety_score <= 100)),
  add column if not exists compliance_score numeric check (compliance_score is null or (compliance_score >= 0 and compliance_score <= 100)),
  add column if not exists risk_flags jsonb not null default '[]'::jsonb,
  add column if not exists recommendations jsonb not null default '[]'::jsonb,
  add column if not exists reviewer text not null default 'AI Quality Review',
  add column if not exists audit_references jsonb not null default '[]'::jsonb;

create table if not exists public.ai_content_memory (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  content_history_id uuid references public.content_history(id) on delete set null,
  platform text,
  prompt text,
  generated_version text,
  approved_version text,
  rejected_version text,
  rejection_reason text,
  performance_summary text,
  budget_impact text,
  campaign_impact text,
  ai_reasoning text,
  quality_review jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists content_history_run_idx on public.content_history(tenant_id, run_id);
create index if not exists content_history_platform_publish_idx on public.content_history(tenant_id, platform, publish_status);
create index if not exists content_history_approval_idx on public.content_history(tenant_id, approval_status, generated_at_utc desc);
create index if not exists content_history_campaign_idx on public.content_history(tenant_id, campaign_name, generated_at_utc desc);
create index if not exists content_versions_history_idx on public.content_versions(content_history_id);
create index if not exists content_links_history_idx on public.content_links(content_history_id);
create index if not exists content_links_run_idx on public.content_links(tenant_id, run_id);
create index if not exists content_approvals_history_idx on public.content_approvals(content_history_id);
create index if not exists content_approvals_run_idx on public.content_approvals(tenant_id, run_id);
create index if not exists content_metrics_history_idx on public.content_metrics(content_history_id);
create index if not exists content_quality_reviews_history_idx on public.content_quality_reviews(content_history_id);
create index if not exists content_quality_reviews_run_idx on public.content_quality_reviews(tenant_id, run_id);
create index if not exists ai_content_memory_tenant_history_idx on public.ai_content_memory(tenant_id, content_history_id, created_at desc);
create index if not exists idx_audit_logs_module on public.audit_logs(module);
create index if not exists idx_audit_logs_action_type on public.audit_logs(action_type);
create index if not exists idx_audit_logs_created_at on public.audit_logs(created_at);

drop trigger if exists set_content_history_updated_at on public.content_history;
create trigger set_content_history_updated_at
before update on public.content_history
for each row execute function public.set_updated_at();

alter table public.audit_logs enable row level security;
alter table public.content_history enable row level security;
alter table public.content_versions enable row level security;
alter table public.content_links enable row level security;
alter table public.content_approvals enable row level security;
alter table public.content_metrics enable row level security;
alter table public.content_quality_reviews enable row level security;
alter table public.ai_content_memory enable row level security;

revoke all on table public.content_history from anon;
revoke all on table public.content_versions from anon;
revoke all on table public.content_links from anon;
revoke all on table public.content_approvals from anon;
revoke all on table public.content_metrics from anon;
revoke all on table public.content_quality_reviews from anon;
revoke all on table public.ai_content_memory from anon;

grant usage on schema public to authenticated, service_role;
grant select, insert on table public.audit_logs to authenticated;
grant select, insert, update, delete on table public.audit_logs to service_role;
grant select, insert, update on table public.content_history to authenticated;
grant select, insert, update on table public.content_versions to authenticated;
grant select, insert, update on table public.content_links to authenticated;
grant select, insert, update on table public.content_approvals to authenticated;
grant select, insert, update on table public.content_metrics to authenticated;
grant select, insert, update on table public.content_quality_reviews to authenticated;
grant select, insert, update on table public.ai_content_memory to authenticated;
grant select, insert, update, delete on table public.content_history to service_role;
grant select, insert, update, delete on table public.content_versions to service_role;
grant select, insert, update, delete on table public.content_links to service_role;
grant select, insert, update, delete on table public.content_approvals to service_role;
grant select, insert, update, delete on table public.content_metrics to service_role;
grant select, insert, update, delete on table public.content_quality_reviews to service_role;
grant select, insert, update, delete on table public.ai_content_memory to service_role;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'content_history',
    'content_versions',
    'content_links',
    'content_approvals',
    'content_metrics',
    'content_quality_reviews',
    'ai_content_memory'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', target_table || '_select_member', target_table);
    execute format('drop policy if exists %I on public.%I', target_table || '_insert_member', target_table);
    execute format('drop policy if exists %I on public.%I', target_table || '_update_member', target_table);
    execute format('create policy %I on public.%I for select to authenticated using (auth.uid() is not null)', target_table || '_select_member', target_table);
    execute format('create policy %I on public.%I for insert to authenticated with check (auth.uid() is not null)', target_table || '_insert_member', target_table);
    execute format('create policy %I on public.%I for update to authenticated using (auth.uid() is not null) with check (auth.uid() is not null)', target_table || '_update_member', target_table);
  end loop;
end $$;

drop policy if exists audit_logs_select_member on public.audit_logs;
create policy audit_logs_select_member
on public.audit_logs for select
to authenticated
using (auth.uid() is not null);

drop policy if exists audit_logs_insert_member on public.audit_logs;
create policy audit_logs_insert_member
on public.audit_logs for insert
to authenticated
with check (auth.uid() is not null);

notify pgrst, 'reload schema';
