-- Prompt 5 incremental migration.
-- Earlier migrations have already been applied. Run this file once.
-- It records discovery limits and worker attention. It does not launch a browser.

alter table public.settings
  add column if not exists discovery_enabled boolean not null default true,
  add column if not exists max_profiles_per_session integer not null default 50,
  add column if not exists max_profiles_per_hour integer not null default 30,
  add column if not exists discovery_scroll_delay_seconds integer not null default 5,
  add column if not exists discovery_duplicate_cooldown_days integer not null default 30;

alter table public.settings drop constraint if exists settings_discovery_check;
alter table public.settings
  add constraint settings_discovery_check
  check (
    max_profiles_per_session between 1 and 500
    and max_profiles_per_hour between 1 and 200
    and discovery_scroll_delay_seconds between 1 and 120
    and discovery_duplicate_cooldown_days between 1 and 365
  );

alter table public.worker_instances drop constraint if exists worker_instances_status_check;
alter table public.worker_instances
  add constraint worker_instances_status_check
  check (status in ('online', 'offline', 'error', 'attention_required'));

alter table public.worker_instances
  add column if not exists attention_reason text,
  add column if not exists profiles_seen integer not null default 0,
  add column if not exists profiles_ingested integer not null default 0,
  add column if not exists profiles_excluded_following integer not null default 0,
  add column if not exists profiles_qualified integer not null default 0;

create table if not exists public.worker_sessions (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  profiles_seen integer not null default 0,
  profiles_ingested integer not null default 0,
  profiles_excluded_following integer not null default 0,
  profiles_qualified integer not null default 0,
  errors integer not null default 0,
  status text not null default 'running',
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worker_sessions_status_check check (
    status in ('running', 'stopped', 'attention_required', 'error')
  )
);

create index if not exists worker_sessions_worker_idx
  on public.worker_sessions (worker_id, started_at desc);

drop trigger if exists worker_sessions_set_updated_at on public.worker_sessions;
create trigger worker_sessions_set_updated_at
  before update on public.worker_sessions
  for each row execute function public.set_updated_at();

alter table public.worker_sessions enable row level security;

drop policy if exists worker_sessions_select_authenticated on public.worker_sessions;
create policy worker_sessions_select_authenticated on public.worker_sessions
  for select to authenticated using (true);

revoke all on table public.worker_sessions from anon;
grant select on table public.worker_sessions to authenticated;

comment on table public.worker_sessions is
  'Local worker discovery counts. The worker does not write this table directly.';
