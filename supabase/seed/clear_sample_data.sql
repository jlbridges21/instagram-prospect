-- Removes fictional sample prospects inserted by `npm run db:seed`.
-- Safe to run more than once. It does not touch real prospects.

begin;

delete from public.follow_ups
where prospect_id in (select id from public.prospects where is_sample = true);

delete from public.activity_log
where prospect_id in (select id from public.prospects where is_sample = true);

delete from public.prospects
where is_sample = true;

commit;
