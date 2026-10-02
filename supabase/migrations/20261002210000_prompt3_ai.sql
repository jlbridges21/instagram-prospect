-- Prompt 3 incremental migration.
-- Earlier migrations have already been applied. Run this file once.
-- It stores structured qualification results and AI usage. It does not rebuild tables.

alter table public.prospects
  add column if not exists ai_analysis jsonb,
  add column if not exists ai_analyzed_at timestamptz,
  add column if not exists ai_model text,
  add column if not exists ai_input_hash text;

comment on column public.prospects.ai_analysis is
  'Structured qualification result. Does not include model reasoning.';
comment on column public.prospects.ai_input_hash is
  'Fingerprint of the fields and targeting rules used for the last analysis.';

alter table public.settings
  add column if not exists ai_enabled boolean not null default true,
  add column if not exists strong_fit_minimum integer not null default 75,
  add column if not exists possible_fit_minimum integer not null default 60;

alter table public.settings drop constraint if exists settings_fit_thresholds_check;
alter table public.settings
  add constraint settings_fit_thresholds_check
  check (
    strong_fit_minimum between 1 and 100
    and possible_fit_minimum between 0 and 99
    and strong_fit_minimum > possible_fit_minimum
  );

create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid references public.prospects (id) on delete set null,
  model text not null,
  operation text not null,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric(12, 6),
  created_at timestamptz not null default now(),
  constraint ai_usage_operation_not_blank check (length(trim(operation)) > 0),
  constraint ai_usage_model_not_blank check (length(trim(model)) > 0)
);

create index if not exists ai_usage_created_at_idx on public.ai_usage (created_at desc);
create index if not exists ai_usage_prospect_id_idx on public.ai_usage (prospect_id);

alter table public.ai_usage enable row level security;

drop policy if exists ai_usage_select_authenticated on public.ai_usage;
drop policy if exists ai_usage_insert_authenticated on public.ai_usage;

create policy ai_usage_select_authenticated on public.ai_usage
  for select to authenticated using (true);
create policy ai_usage_insert_authenticated on public.ai_usage
  for insert to authenticated with check (true);

revoke all on table public.ai_usage from anon;
grant select, insert on table public.ai_usage to authenticated;

comment on table public.ai_usage is
  'One row per OpenAI qualification call. Cached analyses are not recorded here.';
