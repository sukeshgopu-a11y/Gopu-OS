alter table public.ai_content_memory
  add column if not exists recommended_next_caption_style text,
  add column if not exists recommended_hashtags jsonb not null default '[]'::jsonb,
  add column if not exists recommended_posting_time text,
  add column if not exists audience_learning text,
  add column if not exists platform_learning text;

create index if not exists ai_content_memory_optimization_idx
  on public.ai_content_memory(content_history_id, created_at desc);

grant select, insert, update on table public.ai_content_memory to authenticated;
grant select, insert, update, delete on table public.ai_content_memory to service_role;

notify pgrst, 'reload schema';
