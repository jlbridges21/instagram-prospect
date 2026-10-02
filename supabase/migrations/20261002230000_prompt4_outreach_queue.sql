-- Prompt 4 incremental migration.
-- Earlier migrations have already been applied. Run this file once.
-- It adds the outreach job queue. It does not send Instagram messages.

alter table public.prospects
  add column if not exists queued_message_text text,
  add column if not exists outreach_cancelled_at timestamptz;

comment on column public.prospects.queued_message_text is
  'Message locked at approval. This is not proof that a message was sent.';
comment on column public.prospects.outreach_cancelled_at is
  'Set when remaining outreach was cancelled. Completed history is kept.';

alter table public.settings
  add column if not exists automation_enabled boolean not null default false,
  add column if not exists active_days text[] not null default array['mon','tue','wed','thu','fri','sat','sun']::text[],
  add column if not exists active_start_time time not null default '09:00',
  add column if not exists active_end_time time not null default '19:00',
  add column if not exists hourly_minimum integer not null default 10,
  add column if not exists hourly_maximum integer not null default 20,
  add column if not exists daily_maximum integer not null default 150,
  add column if not exists minimum_action_delay_seconds integer not null default 180,
  add column if not exists scheduling_spread_seconds integer not null default 360,
  add column if not exists job_claim_lease_seconds integer not null default 300;

alter table public.settings drop constraint if exists settings_outreach_check;
alter table public.settings
  add constraint settings_outreach_check
  check (
    active_days <@ array['mon','tue','wed','thu','fri','sat','sun']::text[]
    and cardinality(active_days) > 0
    and active_end_time > active_start_time
    and hourly_minimum between 1 and 100
    and hourly_maximum between 1 and 100
    and hourly_minimum <= hourly_maximum
    and daily_maximum between 1 and 5000
    and minimum_action_delay_seconds between 30 and 7200
    and scheduling_spread_seconds between 0 and 7200
    and job_claim_lease_seconds between 60 and 3600
  );

create table if not exists public.outreach_jobs (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  job_type text not null,
  status text not null default 'pending',
  priority integer not null default 0,
  sequence_order integer not null,
  depends_on_job_id uuid references public.outreach_jobs (id) on delete set null,
  scheduled_for timestamptz not null,
  available_at timestamptz not null,
  claimed_at timestamptz,
  claimed_by_worker_id text,
  claim_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  last_error text,
  result jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_jobs_type_check check (
    job_type in ('verify_profile', 'follow_profile', 'send_message')
  ),
  constraint outreach_jobs_status_check check (
    status in ('pending', 'claimed', 'running', 'completed', 'failed', 'cancelled', 'retry_wait')
  ),
  constraint outreach_jobs_sequence_check check (sequence_order between 1 and 3),
  constraint outreach_jobs_attempts_check check (
    attempt_count >= 0 and max_attempts between 1 and 10 and attempt_count <= max_attempts + 1
  ),
  constraint outreach_jobs_error_length_check check (
    last_error is null or char_length(last_error) <= 500
  )
);

create unique index if not exists outreach_jobs_idempotency_idx
  on public.outreach_jobs (idempotency_key);
create index if not exists outreach_jobs_prospect_idx on public.outreach_jobs (prospect_id);
create index if not exists outreach_jobs_schedule_idx
  on public.outreach_jobs (status, scheduled_for, available_at);
create index if not exists outreach_jobs_worker_idx
  on public.outreach_jobs (claimed_by_worker_id)
  where claimed_by_worker_id is not null;

drop trigger if exists outreach_jobs_set_updated_at on public.outreach_jobs;
create trigger outreach_jobs_set_updated_at
  before update on public.outreach_jobs
  for each row execute function public.set_updated_at();

alter table public.outreach_jobs enable row level security;

drop policy if exists outreach_jobs_select_authenticated on public.outreach_jobs;
drop policy if exists outreach_jobs_insert_authenticated on public.outreach_jobs;
drop policy if exists outreach_jobs_update_authenticated on public.outreach_jobs;

create policy outreach_jobs_select_authenticated on public.outreach_jobs
  for select to authenticated using (true);
create policy outreach_jobs_insert_authenticated on public.outreach_jobs
  for insert to authenticated with check (true);
create policy outreach_jobs_update_authenticated on public.outreach_jobs
  for update to authenticated using (true) with check (true);

revoke all on table public.outreach_jobs from anon;
grant select, insert, update on table public.outreach_jobs to authenticated;

comment on table public.outreach_jobs is
  'Queued outreach work. Completing send_message is what marks a prospect contacted.';

-- Atomic claim. Keep the eligibility rules aligned with lib/outreach/claim-rules.ts.
create or replace function public.claim_next_outreach_job(
  p_worker_id text,
  p_lease_seconds integer,
  p_now timestamptz,
  p_prospect_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  claimed public.outreach_jobs;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 or char_length(p_worker_id) > 120 then
    raise exception 'worker_id required';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 60 or p_lease_seconds > 3600 then
    raise exception 'invalid lease';
  end if;

  update public.outreach_jobs
  set
    status = 'failed',
    failed_at = p_now,
    last_error = 'The previous claim expired.',
    claimed_by_worker_id = null,
    claimed_at = null,
    claim_expires_at = null,
    updated_at = p_now
  where status in ('claimed', 'running')
    and claim_expires_at is not null
    and claim_expires_at < p_now
    and attempt_count + 1 >= max_attempts
    and (p_prospect_id is null or prospect_id = p_prospect_id);

  update public.outreach_jobs
  set
    status = 'pending',
    claimed_by_worker_id = null,
    claimed_at = null,
    claim_expires_at = null,
    started_at = null,
    attempt_count = attempt_count + 1,
    updated_at = p_now
  where status in ('claimed', 'running')
    and claim_expires_at is not null
    and claim_expires_at < p_now
    and attempt_count + 1 < max_attempts
    and (p_prospect_id is null or prospect_id = p_prospect_id);

  select j.id into target_id
  from public.outreach_jobs j
  join public.prospects p on p.id = j.prospect_id
  where j.status in ('pending', 'retry_wait')
    and j.available_at <= p_now
    and j.scheduled_for <= p_now
    and (p_prospect_id is null or j.prospect_id = p_prospect_id)
    and p.outreach_cancelled_at is null
    and p.status not in ('skipped', 'disqualified', 'contacted', 'replied', 'demo_booked', 'converted')
    and (
      j.job_type = 'verify_profile'
      or (p.already_following = false and p.already_contacted = false)
    )
    and (
      j.depends_on_job_id is null
      or exists (
        select 1
        from public.outreach_jobs parent
        where parent.id = j.depends_on_job_id
          and parent.status = 'completed'
      )
    )
  order by j.priority desc, j.scheduled_for asc, j.sequence_order asc, j.created_at asc
  limit 1
  for update of j skip locked;

  if target_id is null then
    return null;
  end if;

  update public.outreach_jobs
  set
    status = 'claimed',
    claimed_by_worker_id = p_worker_id,
    claimed_at = p_now,
    claim_expires_at = p_now + make_interval(secs => p_lease_seconds),
    updated_at = p_now
  where id = target_id
  returning * into claimed;

  return to_jsonb(claimed);
end;
$$;

revoke all on function public.claim_next_outreach_job(text, integer, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.claim_next_outreach_job(text, integer, timestamptz, uuid) to service_role;

create or replace function public.queue_outreach_sequence(
  p_prospect_id uuid,
  p_message text,
  p_verify_at timestamptz,
  p_follow_at timestamptz,
  p_send_at timestamptz
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  prospect public.prospects;
  verify_id uuid;
  follow_id uuid;
  send_id uuid;
  verify_key text;
  follow_key text;
  send_key text;
begin
  if p_message is null or length(trim(p_message)) = 0 or char_length(p_message) > 5000 then
    raise exception 'message required';
  end if;

  select * into prospect
  from public.prospects
  where id = p_prospect_id
  for update;

  if not found then
    return jsonb_build_object('created', false, 'reason', 'missing');
  end if;

  if prospect.already_following
    or prospect.already_contacted
    or prospect.outreach_cancelled_at is not null
    or prospect.status in ('contacted', 'replied', 'demo_booked', 'converted', 'skipped', 'disqualified')
  then
    return jsonb_build_object('created', false, 'reason', 'ineligible');
  end if;

  verify_key := p_prospect_id::text || ':verify_profile:outreach-v1';
  follow_key := p_prospect_id::text || ':follow_profile:outreach-v1';
  send_key := p_prospect_id::text || ':send_message:outreach-v1';

  if exists (
    select 1 from public.outreach_jobs
    where idempotency_key in (verify_key, follow_key, send_key)
  ) then
    return jsonb_build_object('created', false, 'reason', 'exists');
  end if;

  update public.prospects
  set queued_message_text = coalesce(queued_message_text, p_message)
  where id = p_prospect_id;

  insert into public.outreach_jobs (
    prospect_id, job_type, status, priority, sequence_order, scheduled_for, available_at, idempotency_key
  ) values (
    p_prospect_id, 'verify_profile', 'pending', 0, 1, p_verify_at, p_verify_at, verify_key
  )
  returning id into verify_id;

  insert into public.outreach_jobs (
    prospect_id, job_type, status, priority, sequence_order, depends_on_job_id,
    scheduled_for, available_at, idempotency_key
  ) values (
    p_prospect_id, 'follow_profile', 'pending', 0, 2, verify_id, p_follow_at, p_follow_at, follow_key
  )
  returning id into follow_id;

  insert into public.outreach_jobs (
    prospect_id, job_type, status, priority, sequence_order, depends_on_job_id,
    scheduled_for, available_at, idempotency_key
  ) values (
    p_prospect_id, 'send_message', 'pending', 0, 3, follow_id, p_send_at, p_send_at, send_key
  )
  returning id into send_id;

  return jsonb_build_object(
    'created', true,
    'verify_id', verify_id,
    'follow_id', follow_id,
    'send_id', send_id
  );
end;
$$;

revoke all on function public.queue_outreach_sequence(uuid, text, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.queue_outreach_sequence(uuid, text, timestamptz, timestamptz, timestamptz) to authenticated, service_role;
