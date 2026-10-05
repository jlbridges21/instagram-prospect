create table if not exists public.discovery_seeds (
  id uuid primary key default gen_random_uuid(),
  instagram_username text not null,
  display_name text,
  profile_url text,
  profile_picture_url text,
  source_type text not null default 'manual',
  is_active boolean not null default true,
  is_manual boolean not null default true,
  auto_promoted_from_prospect_id uuid references public.prospects(id) on delete set null,
  category text,
  notes text,
  priority text not null default 'normal',
  profiles_discovered integer not null default 0,
  profiles_inspected integer not null default 0,
  profiles_reaching_review integer not null default 0,
  profiles_approved integer not null default 0,
  profiles_contacted integer not null default 0,
  candidates_seen integer not null default 0,
  duplicates_skipped integer not null default 0,
  consecutive_uses integer not null default 0,
  cooldown_until timestamptz,
  last_used_at timestamptz,
  last_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discovery_seeds_username_unique unique (instagram_username),
  constraint discovery_seeds_username_check check (instagram_username ~ '^[a-z0-9._]{1,30}$'),
  constraint discovery_seeds_source_check check (source_type in ('manual', 'auto_promoted', 'system_imported')),
  constraint discovery_seeds_priority_check check (priority in ('low', 'normal', 'high'))
);

create index if not exists discovery_seeds_active_idx on public.discovery_seeds (is_active, priority);
create index if not exists discovery_seeds_username_idx on public.discovery_seeds (instagram_username);

alter table public.prospects drop constraint if exists prospects_source_check;
alter table public.prospects
  add constraint prospects_source_check
  check (source in ('home_feed', 'suggested_accounts', 'manual', 'seed_suggestion', 'seed_network'));

alter table public.prospects
  add column if not exists source_seed_id uuid references public.discovery_seeds(id) on delete set null,
  add column if not exists source_seed_username text,
  add column if not exists discovery_priority_label text,
  add column if not exists discovery_priority_reason text;

create index if not exists prospects_source_seed_idx on public.prospects (source_seed_id);
create index if not exists prospects_source_discovered_idx on public.prospects (source, discovered_at);

alter table public.settings
  add column if not exists discovery_auto_promote boolean not null default false,
  add column if not exists discovery_auto_promote_min_score integer not null default 75,
  add column if not exists discovery_promote_strong boolean not null default true,
  add column if not exists discovery_promote_possible boolean not null default false,
  add column if not exists discovery_promote_requires text not null default 'review',
  add column if not exists discovery_min_seed_sample integer not null default 10,
  add column if not exists discovery_favor_yield boolean not null default true,
  add column if not exists discovery_yield_strength text not null default 'medium',
  add column if not exists discovery_home_feed_usage text not null default 'low',
  add column if not exists discovery_strategy text not null default 'balanced',
  add column if not exists discovery_seed_cooldown_cycles integer not null default 2,
  add column if not exists discovery_seed_network_enabled boolean not null default true,
  add column if not exists discovery_seed_network_sample integer not null default 15,
  add column if not exists discovery_positive_keywords text[] not null default array['drone','aerial','photography','photographer','real estate','realestate','media','video','videography','videographer','fpv','uav','aerial media','property media','real estate media','content creator','production'],
  add column if not exists discovery_negative_keywords text[] not null default array[]::text[],
  add column if not exists discovery_tuning jsonb not null default '{
    "positiveKeywordBonus": 6,
    "negativeKeywordPenalty": 8,
    "manualPriorityLow": -16,
    "manualPriorityNormal": 0,
    "manualPriorityHigh": 16,
    "recentUsePenalty": 10,
    "explorationConservative": 15,
    "explorationBalanced": 25,
    "explorationExploratory": 40,
    "homeFeedLow": 10,
    "homeFeedMedium": 25,
    "homeFeedHigh": 45,
    "seedShareConservative": 85,
    "seedShareBalanced": 70,
    "seedShareExploratory": 50,
    "yieldWeightLow": 12,
    "yieldWeightMedium": 24,
    "yieldWeightHigh": 40,
    "highYieldCandidateBonus": 16,
    "sourceBaseSeed": 18,
    "sourceBaseSuggested": 8,
    "sourceBaseHome": 2
  }'::jsonb;

alter table public.settings drop constraint if exists settings_discovery_promote_requires_check;
alter table public.settings
  add constraint settings_discovery_promote_requires_check
  check (discovery_promote_requires in ('review', 'approved'));

alter table public.discovery_seeds enable row level security;
drop policy if exists discovery_seeds_authenticated on public.discovery_seeds;
create policy discovery_seeds_authenticated on public.discovery_seeds
  for all to authenticated using (true) with check (true);

create or replace function public.bump_discovery_seed(
  p_id uuid,
  p_discovered integer default 0,
  p_inspected integer default 0,
  p_review integer default 0,
  p_approved integer default 0,
  p_contacted integer default 0,
  p_seen integer default 0,
  p_duplicates integer default 0,
  p_used boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.discovery_seeds
  set
    profiles_discovered = profiles_discovered + greatest(p_discovered, 0),
    profiles_inspected = profiles_inspected + greatest(p_inspected, 0),
    profiles_reaching_review = profiles_reaching_review + greatest(p_review, 0),
    profiles_approved = profiles_approved + greatest(p_approved, 0),
    profiles_contacted = profiles_contacted + greatest(p_contacted, 0),
    candidates_seen = candidates_seen + greatest(p_seen, 0),
    duplicates_skipped = duplicates_skipped + greatest(p_duplicates, 0),
    consecutive_uses = case
      when not p_used then consecutive_uses
      when last_used_at is null or last_used_at < now() - interval '30 minutes' then 1
      else consecutive_uses + 1
    end,
    last_used_at = case when p_used or p_inspected > 0 then now() else last_used_at end,
    last_success_at = case when p_review > 0 or p_approved > 0 then now() else last_success_at end,
    updated_at = now()
  where id = p_id;
end;
$$;

revoke all on function public.bump_discovery_seed(uuid, integer, integer, integer, integer, integer, integer, integer, boolean) from public;
grant execute on function public.bump_discovery_seed(uuid, integer, integer, integer, integer, integer, integer, integer, boolean) to service_role;

create table if not exists public.discovery_seed_events (
  seed_id uuid not null references public.discovery_seeds(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  event_type text not null check (event_type in ('inspected', 'review', 'approved', 'contacted')),
  created_at timestamptz not null default now(),
  primary key (prospect_id, event_type)
);

create index if not exists discovery_seed_events_seed_idx on public.discovery_seed_events (seed_id);

alter table public.discovery_seed_events enable row level security;
drop policy if exists discovery_seed_events_authenticated on public.discovery_seed_events;
create policy discovery_seed_events_authenticated on public.discovery_seed_events
  for all to authenticated using (true) with check (true);

create or replace function public.adjust_discovery_seed_counter(p_seed_id uuid, p_event text, p_delta integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.discovery_seeds
  set
    profiles_inspected = greatest(0, profiles_inspected + case when p_event = 'inspected' then p_delta else 0 end),
    profiles_reaching_review = greatest(0, profiles_reaching_review + case when p_event = 'review' then p_delta else 0 end),
    profiles_approved = greatest(0, profiles_approved + case when p_event = 'approved' then p_delta else 0 end),
    profiles_contacted = greatest(0, profiles_contacted + case when p_event = 'contacted' then p_delta else 0 end),
    updated_at = now()
  where id = p_seed_id;
end;
$$;

create or replace function public.record_discovery_seed_inspection(p_seed_id uuid, p_prospect_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.discovery_seed_events (seed_id, prospect_id, event_type)
  values (p_seed_id, p_prospect_id, 'inspected');
  perform public.adjust_discovery_seed_counter(p_seed_id, 'inspected', 1);
exception when unique_violation then
  return;
end;
$$;

create or replace function public.sync_discovery_seed_prospect(p_prospect_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seed uuid;
  v_status text;
  v_event text;
  v_wanted text[] := array[]::text[];
  rec record;
begin
  select source_seed_id, status into v_seed, v_status
  from public.prospects
  where id = p_prospect_id;
  if v_seed is null then
    return;
  end if;
  if v_status in ('review', 'approved', 'contacted', 'replied', 'follow_up', 'demo_booked', 'converted') then
    v_wanted := v_wanted || 'review';
  end if;
  if v_status in ('approved', 'contacted', 'replied', 'follow_up', 'demo_booked', 'converted') then
    v_wanted := v_wanted || 'approved';
  end if;
  if v_status in ('contacted', 'replied', 'follow_up', 'demo_booked', 'converted') then
    v_wanted := v_wanted || 'contacted';
  end if;

  for rec in
    select seed_id, event_type from public.discovery_seed_events
    where prospect_id = p_prospect_id
      and event_type <> 'inspected'
      and not (event_type = any (v_wanted))
  loop
    delete from public.discovery_seed_events
    where prospect_id = p_prospect_id and event_type = rec.event_type;
    perform public.adjust_discovery_seed_counter(rec.seed_id, rec.event_type, -1);
  end loop;

  foreach v_event in array v_wanted loop
    begin
      insert into public.discovery_seed_events (seed_id, prospect_id, event_type)
      values (v_seed, p_prospect_id, v_event);
      perform public.adjust_discovery_seed_counter(v_seed, v_event, 1);
    exception when unique_violation then
      null;
    end;
  end loop;
end;
$$;

create or replace function public.release_discovery_seed_prospect()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  for rec in
    select seed_id, event_type from public.discovery_seed_events where prospect_id = old.id
  loop
    perform public.adjust_discovery_seed_counter(rec.seed_id, rec.event_type, -1);
  end loop;
  delete from public.discovery_seed_events where prospect_id = old.id;
  return old;
end;
$$;

drop trigger if exists prospects_release_discovery_seed on public.prospects;
create trigger prospects_release_discovery_seed
  before delete on public.prospects
  for each row execute function public.release_discovery_seed_prospect();

revoke all on function public.adjust_discovery_seed_counter(uuid, text, integer) from public;
revoke all on function public.record_discovery_seed_inspection(uuid, uuid) from public;
revoke all on function public.sync_discovery_seed_prospect(uuid) from public;
revoke all on function public.release_discovery_seed_prospect() from public;
grant execute on function public.adjust_discovery_seed_counter(uuid, text, integer) to service_role;
grant execute on function public.record_discovery_seed_inspection(uuid, uuid) to service_role;
grant execute on function public.sync_discovery_seed_prospect(uuid) to service_role, authenticated;
grant execute on function public.release_discovery_seed_prospect() to service_role;
