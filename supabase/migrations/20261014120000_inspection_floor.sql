alter table public.settings alter column discovery_min_pre_score set default 18;

update public.settings
set discovery_min_pre_score = 18
where id = 1
  and discovery_min_pre_score = 35;
