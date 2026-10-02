-- Prompt 6 incremental migration.
-- Earlier migrations have already been applied. Run this file once.

alter table public.prospects
  add column if not exists qualification_error text;

alter table public.worker_instances
  add column if not exists current_username text,
  add column if not exists last_event text,
  add column if not exists session_errors integer not null default 0;
