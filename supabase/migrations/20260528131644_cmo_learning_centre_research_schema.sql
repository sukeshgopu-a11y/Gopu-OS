-- Safe CMO Learning Centre research schema.
-- Creates auditable research-memory tables only. No fake findings or demo research rows are inserted.

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

do $$
begin
  if not exists (select 1 from pg_type where typname = 'executive_research_role') then
    create type public.executive_research_role as enum ('COO', 'CFO', 'CTO', 'CMO', 'CIO');
  end if;
  if not exists (select 1 from pg_type where typname = 'research_ingestion_status') then
    create type public.research_ingestion_status as enum ('idle', 'running', 'completed', 'stopped', 'failed');
  end if;
  if not exists (select 1 from pg_type where typname = 'research_audit_level') then
    create type public.research_audit_level as enum ('info', 'warn', 'error');
  end if;
end $$;

create table if not exists public.research_ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  run_key text,
  started_at timestamptz not null default now(),
  ends_at timestamptz,
  duration_hours integer not null default 12,
  status public.research_ingestion_status not null default 'idle',
  current_phase text,
  current_role public.executive_research_role,
  total_items_learned integer not null default 0,
  total_sources_scanned integer not null default 0,
  total_memory_saved integer not null default 0,
  total_errors integer not null default 0,
  blocked_sources integer not null default 0,
  source_metadata jsonb not null default '{}'::jsonb,
  ai_analysis jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.research_ingestion_runs
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade,
  add column if not exists run_key text,
  add column if not exists ends_at timestamptz,
  add column if not exists blocked_sources integer not null default 0,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb,
  add column if not exists ai_analysis jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists research_ingestion_single_active_idx
on public.research_ingestion_runs ((status))
where status = 'running';

create index if not exists research_ingestion_runs_created_idx on public.research_ingestion_runs(created_at desc);
create index if not exists research_ingestion_runs_started_idx on public.research_ingestion_runs(started_at desc);
create index if not exists research_ingestion_runs_role_status_idx on public.research_ingestion_runs(current_role, status, created_at desc);

drop trigger if exists set_research_ingestion_runs_updated_at on public.research_ingestion_runs;
create trigger set_research_ingestion_runs_updated_at
before update on public.research_ingestion_runs
for each row execute function public.set_updated_at();

create table if not exists public.executive_topics (
  id uuid primary key default gen_random_uuid(),
  role public.executive_research_role not null,
  topic text not null,
  category text,
  platform text,
  priority integer not null default 1,
  last_researched_at timestamptz,
  times_researched integer not null default 0,
  active boolean not null default true,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (role, topic)
);

alter table public.executive_topics
  add column if not exists category text,
  add column if not exists platform text,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists executive_topics_role_active_idx on public.executive_topics(role, active, priority desc);
create index if not exists executive_topics_platform_idx on public.executive_topics(platform);
create index if not exists executive_topics_category_idx on public.executive_topics(category);
create index if not exists executive_topics_created_idx on public.executive_topics(created_at desc);

drop trigger if exists set_executive_topics_updated_at on public.executive_topics;
create trigger set_executive_topics_updated_at
before update on public.executive_topics
for each row execute function public.set_updated_at();

create table if not exists public.research_findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.research_ingestion_runs(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade,
  role public.executive_research_role not null default 'CMO',
  topic text not null,
  platform text,
  category text,
  company_name text,
  learning_summary text not null,
  key_insights jsonb not null default '[]'::jsonb,
  hashtags jsonb not null default '[]'::jsonb,
  engagement_signals jsonb not null default '[]'::jsonb,
  learning_notes jsonb not null default '[]'::jsonb,
  avoid_rules jsonb not null default '[]'::jsonb,
  source_type text,
  source_url text not null,
  source_domain text,
  confidence_score numeric(5,4) not null default 0 check (confidence_score >= 0 and confidence_score <= 1),
  status text not null default 'stored',
  memory_saved boolean not null default false,
  tokens_processed integer not null default 0,
  source_metadata jsonb not null default '{}'::jsonb,
  ai_analysis jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.research_findings
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade,
  add column if not exists platform text,
  add column if not exists category text,
  add column if not exists company_name text,
  add column if not exists hashtags jsonb not null default '[]'::jsonb,
  add column if not exists engagement_signals jsonb not null default '[]'::jsonb,
  add column if not exists learning_notes jsonb not null default '[]'::jsonb,
  add column if not exists avoid_rules jsonb not null default '[]'::jsonb,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb,
  add column if not exists ai_analysis jsonb not null default '{}'::jsonb,
  add column if not exists recorded_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists research_findings_run_source_unique_idx
on public.research_findings(run_id, source_url)
where run_id is not null;

create index if not exists research_findings_run_role_created_idx on public.research_findings(run_id, role, created_at desc);
create index if not exists research_findings_created_idx on public.research_findings(created_at desc);
create index if not exists research_findings_recorded_idx on public.research_findings(recorded_at desc);
create index if not exists research_findings_platform_idx on public.research_findings(platform);
create index if not exists research_findings_category_idx on public.research_findings(category);
create index if not exists research_findings_confidence_idx on public.research_findings(confidence_score desc);
create index if not exists research_findings_source_url_idx on public.research_findings(source_url);
create index if not exists research_findings_role_platform_idx on public.research_findings(role, platform, created_at desc);
create index if not exists research_findings_metadata_platform_idx on public.research_findings((metadata->>'platform'));
create index if not exists research_findings_metadata_category_idx on public.research_findings((metadata->>'category'));

drop trigger if exists set_research_findings_updated_at on public.research_findings;
create trigger set_research_findings_updated_at
before update on public.research_findings
for each row execute function public.set_updated_at();

create table if not exists public.executive_knowledge (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  role public.executive_research_role not null,
  platform text,
  category text,
  topic_cluster text not null,
  knowledge_key text not null,
  knowledge_value text not null,
  source_finding_ids jsonb not null default '[]'::jsonb,
  hashtags jsonb not null default '[]'::jsonb,
  engagement_signals jsonb not null default '[]'::jsonb,
  learning_notes jsonb not null default '[]'::jsonb,
  avoid_rules jsonb not null default '[]'::jsonb,
  source_metadata jsonb not null default '{}'::jsonb,
  ai_analysis jsonb not null default '{}'::jsonb,
  confidence_score numeric(5,4) not null default 0 check (confidence_score >= 0 and confidence_score <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (role, knowledge_key)
);

alter table public.executive_knowledge
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade,
  add column if not exists platform text,
  add column if not exists category text,
  add column if not exists hashtags jsonb not null default '[]'::jsonb,
  add column if not exists engagement_signals jsonb not null default '[]'::jsonb,
  add column if not exists learning_notes jsonb not null default '[]'::jsonb,
  add column if not exists avoid_rules jsonb not null default '[]'::jsonb,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb,
  add column if not exists ai_analysis jsonb not null default '{}'::jsonb;

create index if not exists executive_knowledge_role_topic_idx on public.executive_knowledge(role, topic_cluster);
create index if not exists executive_knowledge_platform_idx on public.executive_knowledge(platform);
create index if not exists executive_knowledge_category_idx on public.executive_knowledge(category);
create index if not exists executive_knowledge_confidence_idx on public.executive_knowledge(confidence_score desc);
create index if not exists executive_knowledge_created_idx on public.executive_knowledge(created_at desc);

drop trigger if exists set_executive_knowledge_updated_at on public.executive_knowledge;
create trigger set_executive_knowledge_updated_at
before update on public.executive_knowledge
for each row execute function public.set_updated_at();

create table if not exists public.executive_intelligence_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  run_id uuid references public.research_ingestion_runs(id) on delete cascade,
  role public.executive_research_role default 'CMO',
  platform text,
  category text,
  report_markdown text not null default '',
  report_json jsonb not null default '{}'::jsonb,
  source_metadata jsonb not null default '{}'::jsonb,
  ai_analysis jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.executive_intelligence_reports
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade,
  add column if not exists role public.executive_research_role default 'CMO',
  add column if not exists platform text,
  add column if not exists category text,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb,
  add column if not exists ai_analysis jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

create index if not exists executive_intelligence_reports_run_idx on public.executive_intelligence_reports(run_id);
create index if not exists executive_intelligence_reports_generated_idx on public.executive_intelligence_reports(generated_at desc);
create index if not exists executive_intelligence_reports_platform_idx on public.executive_intelligence_reports(platform);
create index if not exists executive_intelligence_reports_category_idx on public.executive_intelligence_reports(category);

create table if not exists public.cmo_strategy_memory (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  run_id uuid references public.research_ingestion_runs(id) on delete set null,
  platform text,
  category text,
  strategy_key text not null,
  strategy_summary text not null,
  source_url text,
  confidence_score numeric(5,4) not null default 0 check (confidence_score >= 0 and confidence_score <= 1),
  hashtags jsonb not null default '[]'::jsonb,
  engagement_signals jsonb not null default '[]'::jsonb,
  learning_notes jsonb not null default '[]'::jsonb,
  avoid_rules jsonb not null default '[]'::jsonb,
  source_metadata jsonb not null default '{}'::jsonb,
  ai_analysis jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists cmo_strategy_memory_unique_idx on public.cmo_strategy_memory(strategy_key, coalesce(platform, ''), coalesce(category, ''));
create index if not exists cmo_strategy_memory_run_idx on public.cmo_strategy_memory(run_id);
create index if not exists cmo_strategy_memory_platform_idx on public.cmo_strategy_memory(platform);
create index if not exists cmo_strategy_memory_category_idx on public.cmo_strategy_memory(category);
create index if not exists cmo_strategy_memory_confidence_idx on public.cmo_strategy_memory(confidence_score desc);
create index if not exists cmo_strategy_memory_source_url_idx on public.cmo_strategy_memory(source_url);
create index if not exists cmo_strategy_memory_recorded_idx on public.cmo_strategy_memory(recorded_at desc);
create index if not exists cmo_strategy_memory_created_idx on public.cmo_strategy_memory(created_at desc);

drop trigger if exists set_cmo_strategy_memory_updated_at on public.cmo_strategy_memory;
create trigger set_cmo_strategy_memory_updated_at
before update on public.cmo_strategy_memory
for each row execute function public.set_updated_at();

create table if not exists public.content_research_findings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  run_id uuid references public.research_ingestion_runs(id) on delete set null,
  research_finding_id uuid references public.research_findings(id) on delete set null,
  platform text,
  category text,
  company_name text,
  source_url text not null,
  caption_style text,
  visual_style text,
  why_performed_well text,
  gopu_learning text,
  confidence_score numeric(5,4) not null default 0 check (confidence_score >= 0 and confidence_score <= 1),
  hashtags jsonb not null default '[]'::jsonb,
  engagement_signals jsonb not null default '[]'::jsonb,
  learning_notes jsonb not null default '[]'::jsonb,
  avoid_rules jsonb not null default '[]'::jsonb,
  source_metadata jsonb not null default '{}'::jsonb,
  ai_analysis jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists content_research_findings_source_unique_idx on public.content_research_findings(source_url, coalesce(platform, ''), coalesce(category, ''));
create index if not exists content_research_findings_run_idx on public.content_research_findings(run_id);
create index if not exists content_research_findings_platform_idx on public.content_research_findings(platform);
create index if not exists content_research_findings_category_idx on public.content_research_findings(category);
create index if not exists content_research_findings_confidence_idx on public.content_research_findings(confidence_score desc);
create index if not exists content_research_findings_source_url_idx on public.content_research_findings(source_url);
create index if not exists content_research_findings_recorded_idx on public.content_research_findings(recorded_at desc);
create index if not exists content_research_findings_created_idx on public.content_research_findings(created_at desc);

drop trigger if exists set_content_research_findings_updated_at on public.content_research_findings;
create trigger set_content_research_findings_updated_at
before update on public.content_research_findings
for each row execute function public.set_updated_at();

create table if not exists public.content_pattern_library (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  run_id uuid references public.research_ingestion_runs(id) on delete set null,
  platform text,
  category text,
  pattern_name text not null,
  caption_style text,
  visual_style text,
  recommended_use text,
  avoid_reason text,
  confidence_score numeric(5,4) not null default 0 check (confidence_score >= 0 and confidence_score <= 1),
  hashtags jsonb not null default '[]'::jsonb,
  engagement_signals jsonb not null default '[]'::jsonb,
  learning_notes jsonb not null default '[]'::jsonb,
  avoid_rules jsonb not null default '[]'::jsonb,
  source_metadata jsonb not null default '{}'::jsonb,
  ai_analysis jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists content_pattern_library_unique_idx on public.content_pattern_library(pattern_name, coalesce(platform, ''), coalesce(category, ''));
create index if not exists content_pattern_library_run_idx on public.content_pattern_library(run_id);
create index if not exists content_pattern_library_platform_idx on public.content_pattern_library(platform);
create index if not exists content_pattern_library_category_idx on public.content_pattern_library(category);
create index if not exists content_pattern_library_confidence_idx on public.content_pattern_library(confidence_score desc);
create index if not exists content_pattern_library_recorded_idx on public.content_pattern_library(recorded_at desc);
create index if not exists content_pattern_library_created_idx on public.content_pattern_library(created_at desc);

drop trigger if exists set_content_pattern_library_updated_at on public.content_pattern_library;
create trigger set_content_pattern_library_updated_at
before update on public.content_pattern_library
for each row execute function public.set_updated_at();

create table if not exists public.ai_content_memory (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
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
  recommended_next_caption_style text,
  recommended_hashtags jsonb not null default '[]'::jsonb,
  recommended_posting_time text,
  audience_learning text,
  platform_learning text,
  quality_review jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.ai_content_memory
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade,
  add column if not exists content_history_id uuid references public.content_history(id) on delete set null,
  add column if not exists platform text,
  add column if not exists performance_summary text,
  add column if not exists budget_impact text,
  add column if not exists campaign_impact text,
  add column if not exists ai_reasoning text,
  add column if not exists recommended_next_caption_style text,
  add column if not exists recommended_hashtags jsonb not null default '[]'::jsonb,
  add column if not exists recommended_posting_time text,
  add column if not exists audience_learning text,
  add column if not exists platform_learning text,
  add column if not exists quality_review jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists ai_content_memory_created_idx on public.ai_content_memory(created_at desc);
create index if not exists ai_content_memory_platform_idx on public.ai_content_memory(platform);
create index if not exists ai_content_memory_history_idx on public.ai_content_memory(content_history_id);

alter table if exists public.audit_logs
  add column if not exists run_id uuid,
  add column if not exists step text,
  add column if not exists level public.research_audit_level,
  add column if not exists message text,
  add column if not exists payload_json jsonb not null default '{}'::jsonb;

create index if not exists audit_logs_learning_centre_run_idx
on public.audit_logs(run_id, created_at desc)
where module = 'Learning Centre';

create index if not exists audit_logs_learning_centre_level_idx
on public.audit_logs(run_id, level, created_at desc)
where module = 'Learning Centre';

insert into public.executive_topics (role, topic, category, platform, priority)
values
  ('CMO','LinkedIn founder authority posts','Founder posts','LinkedIn',5),
  ('CMO','Instagram export education visuals','Export companies','Instagram',4),
  ('CMO','Facebook buyer trust posts','Buyer trust posts','Facebook',4),
  ('CMO','spice and agriculture exporter content','Spice/agriculture companies',null,5),
  ('CMO','manufacturing proof and process content','Manufacturing companies',null,4),
  ('CMO','shipment and logistics trust content','Shipment/logistics content',null,5),
  ('CMO','buyer trust and documentation education','Buyer trust posts',null,5)
on conflict (role, topic) do update
set category = excluded.category,
    platform = excluded.platform,
    priority = excluded.priority,
    active = true,
    updated_at = now();

alter table public.research_ingestion_runs enable row level security;
alter table public.research_findings enable row level security;
alter table public.executive_knowledge enable row level security;
alter table public.executive_topics enable row level security;
alter table public.executive_intelligence_reports enable row level security;
alter table public.cmo_strategy_memory enable row level security;
alter table public.content_research_findings enable row level security;
alter table public.content_pattern_library enable row level security;
alter table public.ai_content_memory enable row level security;

revoke all on table public.research_ingestion_runs from anon;
revoke all on table public.research_findings from anon;
revoke all on table public.executive_knowledge from anon;
revoke all on table public.executive_topics from anon;
revoke all on table public.executive_intelligence_reports from anon;
revoke all on table public.cmo_strategy_memory from anon;
revoke all on table public.content_research_findings from anon;
revoke all on table public.content_pattern_library from anon;
revoke all on table public.ai_content_memory from anon;

grant select on table public.research_ingestion_runs to authenticated;
grant select on table public.research_findings to authenticated;
grant select on table public.executive_knowledge to authenticated;
grant select on table public.executive_topics to authenticated;
grant select on table public.executive_intelligence_reports to authenticated;
grant select on table public.cmo_strategy_memory to authenticated;
grant select on table public.content_research_findings to authenticated;
grant select on table public.content_pattern_library to authenticated;
grant select on table public.ai_content_memory to authenticated;

grant select, insert, update, delete on table public.research_ingestion_runs to service_role;
grant select, insert, update, delete on table public.research_findings to service_role;
grant select, insert, update, delete on table public.executive_knowledge to service_role;
grant select, insert, update, delete on table public.executive_topics to service_role;
grant select, insert, update, delete on table public.executive_intelligence_reports to service_role;
grant select, insert, update, delete on table public.cmo_strategy_memory to service_role;
grant select, insert, update, delete on table public.content_research_findings to service_role;
grant select, insert, update, delete on table public.content_pattern_library to service_role;
grant select, insert, update, delete on table public.ai_content_memory to service_role;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'research_ingestion_runs',
    'research_findings',
    'executive_knowledge',
    'executive_topics',
    'executive_intelligence_reports',
    'cmo_strategy_memory',
    'content_research_findings',
    'content_pattern_library',
    'ai_content_memory'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', target_table || '_select_authenticated', target_table);
    execute format('create policy %I on public.%I for select to authenticated using (auth.uid() is not null)', target_table || '_select_authenticated', target_table);
  end loop;
end $$;

notify pgrst, 'reload schema';
