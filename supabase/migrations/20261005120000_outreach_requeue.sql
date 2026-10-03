-- Outreach requeue.
-- Earlier migrations have already been applied. Run this file once.
-- Cancelled jobs stay in history. A new sequence uses a new idempotency version.

create or replace function public.requeue_outreach_sequence(
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
  version integer;
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

  if prospect.status <> 'approved'
    or prospect.already_contacted
    or prospect.status in ('contacted', 'replied', 'demo_booked', 'converted', 'skipped', 'disqualified')
  then
    return jsonb_build_object('created', false, 'reason', 'ineligible');
  end if;

  if exists (
    select 1
    from public.outreach_jobs
    where prospect_id = p_prospect_id
      and status in ('pending', 'retry_wait', 'claimed', 'running')
  ) then
    return jsonb_build_object('created', false, 'reason', 'active');
  end if;

  if not exists (
    select 1
    from public.outreach_jobs
    where prospect_id = p_prospect_id
      and status = 'cancelled'
  ) then
    return jsonb_build_object('created', false, 'reason', 'nothing_to_requeue');
  end if;

  select coalesce(max((regexp_match(idempotency_key, ':outreach-v([0-9]+)$'))[1]::integer), 1) + 1
  into version
  from public.outreach_jobs
  where prospect_id = p_prospect_id;

  verify_key := p_prospect_id::text || ':verify_profile:outreach-v' || version::text;
  follow_key := p_prospect_id::text || ':follow_profile:outreach-v' || version::text;
  send_key := p_prospect_id::text || ':send_message:outreach-v' || version::text;

  update public.prospects
  set
    queued_message_text = p_message,
    outreach_cancelled_at = null
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
    'version', version,
    'verify_id', verify_id,
    'follow_id', follow_id,
    'send_id', send_id
  );
exception
  when unique_violation then
    return jsonb_build_object('created', false, 'reason', 'exists');
end;
$$;

revoke all on function public.requeue_outreach_sequence(uuid, text, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.requeue_outreach_sequence(uuid, text, timestamptz, timestamptz, timestamptz) to authenticated, service_role;
