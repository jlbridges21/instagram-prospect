-- Worker control commands. Run once in the Supabase SQL editor.
-- Does not turn Discovery or Outreach on.
-- Does not change existing prospect rows.

alter table public.settings
  add column if not exists discovery_run_mode text not null default 'review_target',
  add column if not exists discovery_run_minutes integer,
  add column if not exists discovery_run_inspection_limit integer,
  add column if not exists discovery_run_started_at timestamptz;

alter table public.settings drop constraint if exists settings_discovery_run_mode_check;
alter table public.settings
  add constraint settings_discovery_run_mode_check
  check (discovery_run_mode in ('review_target', 'duration', 'inspection_count', 'continuous'));

create table if not exists public.worker_commands (
  id uuid primary key default gen_random_uuid(),
  worker_id text,
  command_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  expires_at timestamptz,
  result jsonb,
  error_code text,
  error_message text,
  requested_by text,
  created_by_source text not null default 'dashboard',
  priority integer not null default 5,
  idempotency_key text,
  constraint worker_commands_type_check check (command_type in (
    'start_discovery', 'pause_discovery', 'stop_discovery', 'start_outreach', 'pause_outreach',
    'run_discovery_test', 'run_outreach_preview', 'run_one_outreach', 'recover_outreach',
    'inspect_dm', 'inspect_composer', 'refresh_instagram_auth_check', 'clear_worker_attention'
  )),
  constraint worker_commands_status_check check (status in (
    'queued', 'claimed', 'running', 'completed', 'failed', 'cancelled', 'expired'
  ))
);

create index if not exists worker_commands_worker_status_idx
  on public.worker_commands (worker_id, status, priority, created_at);

create index if not exists worker_commands_status_expires_idx
  on public.worker_commands (status, expires_at);

create unique index if not exists worker_commands_active_idempotency_idx
  on public.worker_commands (idempotency_key)
  where idempotency_key is not null and status in ('queued', 'claimed', 'running');

create table if not exists public.worker_events (
  id uuid primary key default gen_random_uuid(),
  worker_id text,
  event_type text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists worker_events_created_at_idx
  on public.worker_events (created_at desc);

create index if not exists worker_events_worker_created_idx
  on public.worker_events (worker_id, created_at desc);

alter table public.worker_commands enable row level security;
alter table public.worker_events enable row level security;

drop policy if exists worker_commands_authenticated on public.worker_commands;
create policy worker_commands_authenticated on public.worker_commands
  for all to authenticated using (true) with check (true);

drop policy if exists worker_events_authenticated on public.worker_events;
create policy worker_events_authenticated on public.worker_events
  for all to authenticated using (true) with check (true);
