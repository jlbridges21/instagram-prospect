-- Prompt 2 incremental migration.
-- The initial migration has already been applied. Run this file once in the Supabase SQL editor.
-- It does not rebuild existing tables.

alter table public.prospects drop constraint if exists prospects_source_check;

alter table public.prospects
  add constraint prospects_source_check
  check (source in ('home_feed', 'manual'));

alter table public.prospects
  add column if not exists message_override text,
  add column if not exists sent_message_text text,
  add column if not exists last_status_changed_at timestamptz;

comment on column public.prospects.message_override is
  'Optional message for this prospect only. Null means render the current settings template.';
comment on column public.prospects.sent_message_text is
  'Exact message text captured when outreach is actually sent. Unused until sending exists.';
comment on column public.prospects.last_status_changed_at is
  'When the prospect status last changed.';

update public.prospects
set last_status_changed_at = updated_at
where last_status_changed_at is null;

update public.follow_ups
set status = 'pending'
where status in ('needs_follow_up', 'follow_up_due', 'replied', 'demo_booked');

alter table public.follow_ups drop constraint if exists follow_ups_status_check;

alter table public.follow_ups
  add constraint follow_ups_status_check
  check (status in ('pending', 'completed', 'cancelled'));

alter table public.follow_ups alter column status set default 'pending';

alter table public.targeting_settings
  add column if not exists exclude_unrelated_drone boolean not null default true;
