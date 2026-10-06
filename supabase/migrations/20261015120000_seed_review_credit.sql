drop function if exists public.sync_discovery_seed_prospect(uuid);

create function public.sync_discovery_seed_prospect(p_prospect_id uuid)
returns table (profiles_inspected integer, profiles_reaching_review integer)
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
    v_wanted := array_append(v_wanted, 'review');
  end if;
  if v_status in ('approved', 'contacted', 'replied', 'follow_up', 'demo_booked', 'converted') then
    v_wanted := array_append(v_wanted, 'approved');
  end if;
  if v_status in ('contacted', 'replied', 'follow_up', 'demo_booked', 'converted') then
    v_wanted := array_append(v_wanted, 'contacted');
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

  return query
  select s.profiles_inspected, s.profiles_reaching_review
  from public.discovery_seeds s
  where s.id = v_seed;
end;
$$;

revoke all on function public.sync_discovery_seed_prospect(uuid) from public;
grant execute on function public.sync_discovery_seed_prospect(uuid) to service_role, authenticated;
