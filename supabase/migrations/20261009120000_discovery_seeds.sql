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
  check (source in ('home_feed', 'suggested_accounts', 'manual', 'seed_suggestion'));

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
  add column if not exists discovery_positive_keywords text[] not null default array['drone','aerial','photography','photographer','real estate','realestate','media','video','videography','videographer','fpv','uav','aerial media','property media','real estate media','content creator','production'],
  add column if not exists discovery_negative_keywords text[] not null default array[]::text[];

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
