-- Make never-started pending outreach eligible now.
-- Completed, failed, running, claimed, and retry rows are left unchanged.
update public.outreach_jobs as job
set
  scheduled_for = now(),
  available_at = now(),
  updated_at = now()
where job.status = 'pending'
  and job.started_at is null
  and job.scheduled_for > now()
  and not exists (
    select 1
    from public.outreach_jobs as sibling
    where sibling.prospect_id = job.prospect_id
      and (
        sibling.status in ('running', 'claimed', 'failed')
        or coalesce(sibling.result->>'confirmation', '') = 'uncertain'
        or coalesce(sibling.result->>'sendAttempted', '') = 'true'
      )
  )
  and not exists (
    select 1
    from public.prospects as prospect
    where prospect.id = job.prospect_id
      and prospect.status in ('contacted', 'replied', 'follow_up', 'demo_booked', 'converted', 'skipped', 'disqualified')
  );
