-- Discovery V2 incremental migration.
-- Earlier migrations have already been applied. Run this file once.
-- It stores follow relationship, discovery source settings, and one missing index.
-- It does not mark unchecked accounts as not-following.

alter table public.prospects
  add column if not exists follow_relationship text;

update public.prospects
set follow_relationship = case
  when already_following then 'following'
  else 'unknown'
end
where follow_relationship is null;

alter table public.prospects drop constraint if exists prospects_follow_relationship_check;
alter table public.prospects
  add constraint prospects_follow_relationship_check
  check (
    follow_relationship is null
    or follow_relationship in ('following', 'requested', 'not_following', 'unknown')
  );

alter table public.prospects drop constraint if exists prospects_source_check;
alter table public.prospects
  add constraint prospects_source_check
  check (source in ('home_feed', 'suggested_accounts', 'manual'));

alter table public.settings
  add column if not exists home_feed_enabled boolean not null default true,
  add column if not exists suggested_accounts_enabled boolean not null default true,
  add column if not exists discovery_source_priority text not null default 'suggested_first',
  add column if not exists candidate_queue_target integer not null default 10,
  add column if not exists profile_inspection_concurrency integer not null default 2;

alter table public.settings drop constraint if exists settings_discovery_v2_check;
alter table public.settings
  add constraint settings_discovery_v2_check
  check (
    discovery_source_priority in ('suggested_first', 'home_first')
    and candidate_queue_target between 5 and 25
    and profile_inspection_concurrency = 2
  );

create index if not exists prospects_already_following_idx
  on public.prospects (already_following);

comment on column public.prospects.follow_relationship is
  'Observed Instagram relationship. Null or unknown means it was not confirmed. False already_following is not not_following.';
