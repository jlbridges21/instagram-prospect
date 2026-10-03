-- Discovery V3. Run once in the Supabase SQL editor.
-- Adds the review target, session/daily caps, lightweight suppressions, and sessions.
-- Does not delete or rewrite existing prospect rows.
-- Does not turn Discovery or Outreach on.

alter table public.settings
  add column if not exists discovery_review_target integer,
  add column if not exists discovery_session_inspection_cap integer not null default 1000,
  add column if not exists discovery_daily_inspection_cap integer not null default 500,
  add column if not exists discovery_daily_ai_cap integer not null default 300,
  add column if not exists discovery_stop_reason text,
  add column if not exists discovery_auto_paused boolean not null default false;

alter table public.settings drop constraint if exists settings_discovery_v3_check;
alter table public.settings
  add constraint settings_discovery_v3_check
  check (
    discovery_review_target is null
    or discovery_review_target between 1 and 5000
  );

create table if not exists public.discovery_suppressions (
  id uuid primary key default gen_random_uuid(),
  instagram_username_normalized text not null unique,
  reason text not null,
  fit_score integer,
  follow_relationship text,
  source text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz,
  permanent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists discovery_suppressions_expires_at_idx
  on public.discovery_suppressions (expires_at);

create table if not exists public.discovery_sessions (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  starting_review_count integer not null default 0,
  target integer,
  profiles_inspected integer not null default 0,
  ai_qualifications integer not null default 0,
  prospects_added_to_review integer not null default 0,
  prospects_disqualified integer not null default 0,
  suppressed_profiles integer not null default 0,
  last_candidate_at timestamptz,
  stopped_at timestamptz,
  stop_reason text
);

create table if not exists public.discovery_daily_usage (
  usage_date text primary key,
  inspections integer not null default 0,
  ai_qualifications integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists prospects_status_fit_idx
  on public.prospects (status, fit_label);

create index if not exists prospects_updated_at_idx
  on public.prospects (updated_at desc);

create or replace function public.bump_discovery_usage(
  p_date text,
  p_inspections integer,
  p_ai integer
)
returns table (inspections integer, ai_qualifications integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.discovery_daily_usage (usage_date, inspections, ai_qualifications)
  values (p_date, greatest(p_inspections, 0), greatest(p_ai, 0))
  on conflict (usage_date) do update
    set inspections = public.discovery_daily_usage.inspections + greatest(p_inspections, 0),
        ai_qualifications = public.discovery_daily_usage.ai_qualifications + greatest(p_ai, 0),
        updated_at = now();
  return query
    select usage.inspections, usage.ai_qualifications
    from public.discovery_daily_usage usage
    where usage.usage_date = p_date;
end;
$$;

revoke all on function public.bump_discovery_usage(text, integer, integer) from public;
grant execute on function public.bump_discovery_usage(text, integer, integer) to service_role;

alter table public.discovery_suppressions enable row level security;
alter table public.discovery_sessions enable row level security;
alter table public.discovery_daily_usage enable row level security;

drop policy if exists discovery_suppressions_authenticated on public.discovery_suppressions;
create policy discovery_suppressions_authenticated on public.discovery_suppressions
  for all to authenticated using (true) with check (true);

drop policy if exists discovery_sessions_authenticated on public.discovery_sessions;
create policy discovery_sessions_authenticated on public.discovery_sessions
  for all to authenticated using (true) with check (true);

drop policy if exists discovery_daily_usage_authenticated on public.discovery_daily_usage;
create policy discovery_daily_usage_authenticated on public.discovery_daily_usage
  for all to authenticated using (true) with check (true);
