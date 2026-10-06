alter table public.settings
  add column if not exists discovery_ignored_keywords text[] not null default '{}',
  add column if not exists discovery_optimization_started_at timestamptz;

comment on column public.settings.discovery_ignored_keywords is
  'Keyword suggestions a person chose to ignore. Accepted terms are stored in discovery_positive_keywords.';

comment on column public.settings.discovery_optimization_started_at is
  'Timestamp used to compare Discovery quality before and after the scoring changes.';
