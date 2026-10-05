alter table public.prospects drop constraint if exists prospects_source_check;
alter table public.prospects
  add constraint prospects_source_check
  check (source in ('home_feed', 'suggested_accounts', 'manual', 'seed_suggestion', 'seed_network'));

alter table public.settings
  add column if not exists discovery_seed_network_enabled boolean not null default true,
  add column if not exists discovery_seed_network_sample integer not null default 15;

alter table public.settings drop constraint if exists settings_seed_network_sample_check;
alter table public.settings
  add constraint settings_seed_network_sample_check
  check (discovery_seed_network_sample between 5 and 30);
