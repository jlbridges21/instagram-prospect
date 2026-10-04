-- Adds the safe browser restart command type.
-- Does not enable Discovery or Outreach.
-- Does not change prospect rows.

alter table public.worker_commands drop constraint if exists worker_commands_type_check;
alter table public.worker_commands
  add constraint worker_commands_type_check check (command_type in (
    'start_discovery', 'pause_discovery', 'stop_discovery', 'start_outreach', 'pause_outreach',
    'run_discovery_test', 'run_outreach_preview', 'run_one_outreach', 'recover_outreach',
    'inspect_dm', 'inspect_composer', 'refresh_instagram_auth_check', 'clear_worker_attention',
    'restart_browser_session_if_safe'
  ));
