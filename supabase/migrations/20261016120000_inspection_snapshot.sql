create table if not exists public.candidate_inspection_snapshots (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null unique references public.prospects(id) on delete cascade,
  instagram_username text not null,
  card_text text,
  source text not null,
  source_seed_id uuid,
  source_seed_username text,
  seed_support_count integer not null default 0,
  supporting_seed_usernames text[] not null default '{}',
  pre_score integer,
  niche_component integer,
  commercial_component integer,
  network_component integer,
  source_review_yield numeric,
  source_approval_yield numeric,
  source_prior_points integer,
  seed_review_yield numeric,
  seed_approval_yield numeric,
  seed_mature boolean not null default false,
  strategy text,
  priority_band text,
  priority_label text,
  selection_reasons text,
  runner_up_username text,
  runner_up_pre_score integer,
  created_at timestamptz not null default now()
);

comment on table public.candidate_inspection_snapshots is
  'Immutable pre-open evidence saved when a profile is inspected. Later seed finds, qualification, and yield changes must not update this row.';

create or replace function public.reject_snapshot_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'candidate_inspection_snapshots are immutable';
end;
$$;

drop trigger if exists candidate_inspection_snapshots_immutable on public.candidate_inspection_snapshots;
create trigger candidate_inspection_snapshots_immutable
  before update on public.candidate_inspection_snapshots
  for each row execute function public.reject_snapshot_update();

alter table public.candidate_inspection_snapshots enable row level security;
drop policy if exists candidate_inspection_snapshots_read on public.candidate_inspection_snapshots;
create policy candidate_inspection_snapshots_read on public.candidate_inspection_snapshots
  for select to authenticated using (true);

grant select on public.candidate_inspection_snapshots to authenticated;
grant insert on public.candidate_inspection_snapshots to service_role;
