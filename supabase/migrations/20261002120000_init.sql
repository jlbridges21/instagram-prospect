-- ShootPortal Outreach
-- Initial schema, row level security, and default settings.
--
-- Run this once in the Supabase SQL editor (or with the Supabase CLI).
-- It does not store Instagram passwords or browser sessions.
--
-- Status and fit values are stable keys. Display labels live in the app,
-- so copy can change without a migration. Adding a new status later means
-- updating the check constraint and the TypeScript union together.
-- Activity event types are free text so new events can be recorded without
-- a schema change.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  instagram_username text not null,
  display_name text,
  first_name text,
  profile_url text,
  profile_picture_url text,
  bio text,
  follower_count integer,
  following_count integer,
  location_text text,
  language text,
  category text,
  fit_score integer,
  fit_label text,
  qualification_reason text,
  qualified boolean not null default false,
  already_following boolean not null default false,
  already_contacted boolean not null default false,
  message_text text,
  status text not null default 'discovered',
  notes text,
  source text not null default 'home_feed',
  instagram_post_url text,
  instagram_post_thumbnail_url text,
  discovered_at timestamptz,
  approved_at timestamptz,
  contacted_at timestamptz,
  replied_at timestamptz,
  demo_booked_at timestamptz,
  converted_at timestamptz,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prospects_username_lowercase check (instagram_username = lower(instagram_username)),
  constraint prospects_username_not_blank check (length(trim(instagram_username)) > 0),
  constraint prospects_fit_score_range check (fit_score is null or (fit_score >= 0 and fit_score <= 100)),
  constraint prospects_follower_count_nonnegative check (follower_count is null or follower_count >= 0),
  constraint prospects_following_count_nonnegative check (following_count is null or following_count >= 0),
  constraint prospects_status_check check (
    status in (
      'discovered',
      'qualified',
      'review',
      'approved',
      'contacted',
      'replied',
      'follow_up',
      'demo_booked',
      'converted',
      'skipped',
      'disqualified'
    )
  ),
  constraint prospects_fit_label_check check (
    fit_label is null or fit_label in ('strong_fit', 'possible_fit', 'skip')
  ),
  constraint prospects_source_check check (source in ('home_feed'))
);

create unique index prospects_username_unique_idx
  on public.prospects (lower(instagram_username));

create index prospects_status_idx on public.prospects (status);
create index prospects_fit_label_idx on public.prospects (fit_label);
create index prospects_fit_score_idx on public.prospects (fit_score desc);
create index prospects_discovered_at_idx on public.prospects (discovered_at desc);
create index prospects_follower_count_idx on public.prospects (follower_count);
create index prospects_category_idx on public.prospects (category);
create index prospects_qualified_idx on public.prospects (qualified);
create index prospects_sample_idx on public.prospects (is_sample) where is_sample;
create index prospects_review_queue_idx
  on public.prospects (fit_score desc)
  where status in ('qualified', 'review');

create trigger prospects_set_updated_at
  before update on public.prospects
  for each row execute function public.set_updated_at();

create table public.settings (
  id smallint primary key default 1,
  message_template text not null,
  app_name text not null default 'ShootPortal Outreach',
  timezone text not null default 'America/Chicago',
  date_format text not null default 'MMM d, yyyy',
  worker_enabled boolean not null default false,
  preferred_browser text not null default 'chromium',
  heartbeat_interval_seconds integer not null default 30,
  max_active_workers integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint settings_singleton check (id = 1),
  constraint settings_app_name_not_blank check (length(trim(app_name)) > 0),
  constraint settings_timezone_not_blank check (length(trim(timezone)) > 0),
  constraint settings_date_format_check check (
    date_format in ('MMM d, yyyy', 'MM/dd/yyyy', 'dd/MM/yyyy', 'yyyy-MM-dd')
  ),
  constraint settings_heartbeat_check check (heartbeat_interval_seconds between 5 and 600),
  constraint settings_max_workers_check check (max_active_workers = 1),
  constraint settings_browser_check check (preferred_browser in ('chromium', 'chrome', 'msedge')),
  constraint settings_template_not_blank check (length(trim(message_template)) > 0)
);

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

insert into public.settings (id, message_template)
values (
  1,
  $msg$Hi {{name}}. I’m Jackson, the founder and developer behind ShootPortal. Curious what you’re using right now for media delivery and client management. Google Drive, Dropbox, or something else?

I’d love to connect, show you around ShootPortal, and see if it could make your workflow a little easier. Open to a quick demo?$msg$
);

create table public.targeting_settings (
  id smallint primary key default 1,
  categories text[] not null,
  min_followers integer not null default 500,
  max_followers integer not null default 250000,
  english_only boolean not null default true,
  prefer_united_states boolean not null default true,
  allow_unknown_location boolean not null default true,
  exclude_already_following boolean not null default true,
  exclude_already_contacted boolean not null default true,
  exclude_hobby_accounts boolean not null default true,
  exclude_meme_accounts boolean not null default true,
  exclude_large_agencies boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint targeting_settings_singleton check (id = 1),
  constraint targeting_followers_check check (
    min_followers >= 0 and max_followers >= min_followers
  )
);

create trigger targeting_settings_set_updated_at
  before update on public.targeting_settings
  for each row execute function public.set_updated_at();

insert into public.targeting_settings (id, categories)
values (
  1,
  array[
    'Drone photographers / drone operators doing paid work',
    'Real estate photographers',
    'Real estate media companies',
    'Videographers doing commercial or real estate work',
    'Solo operators',
    'Small teams'
  ]
);

create table public.worker_instances (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null,
  machine_name text,
  platform text,
  hostname text,
  status text not null default 'offline',
  last_heartbeat_at timestamptz,
  current_task text,
  browser_connected boolean not null default false,
  instagram_authenticated boolean not null default false,
  started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worker_instances_worker_id_not_blank check (length(trim(worker_id)) > 0),
  constraint worker_instances_platform_check check (
    platform is null or platform in ('darwin', 'win32', 'linux')
  ),
  constraint worker_instances_status_check check (status in ('online', 'offline', 'error'))
);

create unique index worker_instances_worker_id_idx on public.worker_instances (worker_id);
create index worker_instances_heartbeat_idx on public.worker_instances (last_heartbeat_at desc);

create trigger worker_instances_set_updated_at
  before update on public.worker_instances
  for each row execute function public.set_updated_at();

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  due_at timestamptz,
  status text not null default 'needs_follow_up',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint follow_ups_status_check check (
    status in ('needs_follow_up', 'follow_up_due', 'replied', 'demo_booked', 'completed')
  )
);

create index follow_ups_prospect_id_idx on public.follow_ups (prospect_id);
create index follow_ups_due_at_idx on public.follow_ups (due_at);
create index follow_ups_status_idx on public.follow_ups (status);

create trigger follow_ups_set_updated_at
  before update on public.follow_ups
  for each row execute function public.set_updated_at();

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid references public.prospects (id) on delete set null,
  event_type text not null,
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint activity_log_event_type_not_blank check (length(trim(event_type)) > 0),
  constraint activity_log_description_not_blank check (length(trim(description)) > 0)
);

create index activity_log_created_at_idx on public.activity_log (created_at desc);
create index activity_log_prospect_id_idx on public.activity_log (prospect_id);
create index activity_log_event_type_idx on public.activity_log (event_type);

alter table public.prospects enable row level security;
alter table public.settings enable row level security;
alter table public.targeting_settings enable row level security;
alter table public.worker_instances enable row level security;
alter table public.follow_ups enable row level security;
alter table public.activity_log enable row level security;

-- Authenticated workspace members can operate the internal dashboard.
-- Anonymous visitors have no policies, so they cannot read or write these tables.
-- The service role key bypasses RLS and is reserved for server-side scripts.

create policy prospects_select_authenticated on public.prospects
  for select to authenticated using (true);
create policy prospects_insert_authenticated on public.prospects
  for insert to authenticated with check (true);
create policy prospects_update_authenticated on public.prospects
  for update to authenticated using (true) with check (true);
create policy prospects_delete_authenticated on public.prospects
  for delete to authenticated using (true);

create policy settings_select_authenticated on public.settings
  for select to authenticated using (true);
create policy settings_insert_authenticated on public.settings
  for insert to authenticated with check (true);
create policy settings_update_authenticated on public.settings
  for update to authenticated using (true) with check (true);

create policy targeting_select_authenticated on public.targeting_settings
  for select to authenticated using (true);
create policy targeting_insert_authenticated on public.targeting_settings
  for insert to authenticated with check (true);
create policy targeting_update_authenticated on public.targeting_settings
  for update to authenticated using (true) with check (true);

create policy workers_select_authenticated on public.worker_instances
  for select to authenticated using (true);
create policy workers_insert_authenticated on public.worker_instances
  for insert to authenticated with check (true);
create policy workers_update_authenticated on public.worker_instances
  for update to authenticated using (true) with check (true);
create policy workers_delete_authenticated on public.worker_instances
  for delete to authenticated using (true);

create policy follow_ups_select_authenticated on public.follow_ups
  for select to authenticated using (true);
create policy follow_ups_insert_authenticated on public.follow_ups
  for insert to authenticated with check (true);
create policy follow_ups_update_authenticated on public.follow_ups
  for update to authenticated using (true) with check (true);
create policy follow_ups_delete_authenticated on public.follow_ups
  for delete to authenticated using (true);

create policy activity_select_authenticated on public.activity_log
  for select to authenticated using (true);
create policy activity_insert_authenticated on public.activity_log
  for insert to authenticated with check (true);
create policy activity_delete_authenticated on public.activity_log
  for delete to authenticated using (true);

revoke all on table public.prospects from anon;
revoke all on table public.settings from anon;
revoke all on table public.targeting_settings from anon;
revoke all on table public.worker_instances from anon;
revoke all on table public.follow_ups from anon;
revoke all on table public.activity_log from anon;

grant select, insert, update, delete on table public.prospects to authenticated;
grant select, insert, update on table public.settings to authenticated;
grant select, insert, update on table public.targeting_settings to authenticated;
grant select, insert, update, delete on table public.worker_instances to authenticated;
grant select, insert, update, delete on table public.follow_ups to authenticated;
grant select, insert, delete on table public.activity_log to authenticated;

comment on table public.prospects is
  'Instagram profiles considered for ShootPortal outreach. Usernames are unique.';
comment on table public.settings is
  'Singleton app settings, including the fixed outreach message template.';
comment on table public.targeting_settings is
  'Qualification rules. AI qualification is not implemented yet.';
comment on table public.worker_instances is
  'Local Playwright worker heartbeats. One active worker is supported.';
comment on table public.follow_ups is
  'Manual follow-up records. Nothing is scheduled or sent automatically.';
comment on table public.activity_log is
  'Append-only history of prospect and worker events.';
