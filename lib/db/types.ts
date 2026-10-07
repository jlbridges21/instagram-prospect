import type {
  ActivityEventType,
  FitLabel,
  FollowUpStatus,
  ProspectSource,
  ProspectStatus,
} from "@/lib/constants/prospects";
import type { DateFormat, PreferredBrowser } from "@/lib/constants/settings";
import type { OutreachJobStatus, OutreachJobType } from "@/lib/outreach/types";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ProspectRow = {
  id: string;
  instagram_username: string;
  display_name: string | null;
  first_name: string | null;
  profile_url: string | null;
  profile_picture_url: string | null;
  bio: string | null;
  follower_count: number | null;
  following_count: number | null;
  location_text: string | null;
  language: string | null;
  category: string | null;
  fit_score: number | null;
  fit_label: FitLabel | null;
  qualification_reason: string | null;
  qualification_error?: string | null;
  qualified: boolean;
  already_following: boolean;
  follow_relationship?: "following" | "requested" | "not_following" | "unknown" | null;
  already_contacted: boolean;
  message_text: string | null;
  message_override: string | null;
  sent_message_text: string | null;
  status: ProspectStatus;
  notes: string | null;
  source: ProspectSource;
  source_seed_id?: string | null;
  source_seed_username?: string | null;
  discovery_priority_label?: string | null;
  discovery_priority_reason?: string | null;
  discovery_pre_score?: number | null;
  instagram_post_url: string | null;
  instagram_post_thumbnail_url: string | null;
  discovered_at: string | null;
  approved_at: string | null;
  contacted_at: string | null;
  replied_at: string | null;
  demo_booked_at: string | null;
  converted_at: string | null;
  last_status_changed_at: string | null;
  is_sample: boolean;
  ai_analysis: Json | null;
  ai_analyzed_at: string | null;
  ai_model: string | null;
  ai_input_hash: string | null;
  queued_message_text: string | null;
  outreach_cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SettingsRow = {
  id: number;
  message_template: string;
  app_name: string;
  timezone: string;
  date_format: DateFormat;
  worker_enabled: boolean;
  preferred_browser: PreferredBrowser;
  heartbeat_interval_seconds: number;
  max_active_workers: number;
  ai_enabled: boolean;
  strong_fit_minimum: number;
  possible_fit_minimum: number;
  automation_enabled?: boolean;
  /** @deprecated Ignored by outreach scheduling. */
  active_days?: string[] | null;
  /** @deprecated Ignored by outreach scheduling. */
  active_start_time?: string | null;
  /** @deprecated Ignored by outreach scheduling. */
  active_end_time?: string | null;
  hourly_minimum?: number;
  hourly_maximum?: number;
  daily_maximum?: number;
  minimum_action_delay_seconds?: number;
  scheduling_spread_seconds?: number;
  job_claim_lease_seconds?: number;
  discovery_enabled?: boolean;
  max_profiles_per_session?: number;
  max_profiles_per_hour?: number;
  discovery_scroll_delay_seconds?: number;
  discovery_duplicate_cooldown_days?: number;
  home_feed_enabled?: boolean;
  suggested_accounts_enabled?: boolean;
  discovery_source_priority?: "suggested_first" | "home_first";
  candidate_queue_target?: number;
  profile_inspection_concurrency?: number;
  discovery_review_target?: number | null;
  discovery_session_inspection_cap?: number;
  discovery_daily_inspection_cap?: number;
  discovery_daily_ai_cap?: number;
  discovery_stop_reason?: string | null;
  discovery_auto_paused?: boolean;
  discovery_run_mode?: "review_target" | "duration" | "inspection_count" | "continuous";
  discovery_run_minutes?: number | null;
  discovery_run_inspection_limit?: number | null;
  discovery_run_started_at?: string | null;
  discovery_auto_promote?: boolean;
  discovery_auto_promote_min_score?: number;
  discovery_promote_strong?: boolean;
  discovery_promote_possible?: boolean;
  discovery_promote_requires?: "review" | "approved";
  discovery_min_seed_sample?: number;
  discovery_favor_yield?: boolean;
  discovery_yield_strength?: "low" | "medium" | "high";
  discovery_home_feed_usage?: "low" | "medium" | "high";
  discovery_strategy?: "conservative" | "balanced" | "exploratory";
  discovery_seed_cooldown_cycles?: number;
  discovery_seed_network_enabled?: boolean;
  discovery_seed_network_sample?: number;
  discovery_min_pre_score?: number;
  discovery_positive_keywords?: string[] | null;
  discovery_negative_keywords?: string[] | null;
  discovery_tuning?: Json | null;
  discovery_ignored_keywords?: string[] | null;
  discovery_optimization_started_at?: string | null;
  updated_at: string;
};

export type DiscoverySeedRemovalRow = {
  instagram_username: string;
  removed_at: string;
};

export type DiscoverySeedRow = {
  id: string;
  instagram_username: string;
  display_name: string | null;
  profile_url: string | null;
  profile_picture_url: string | null;
  source_type: "manual" | "auto_promoted" | "system_imported";
  is_active: boolean;
  is_manual: boolean;
  auto_promoted_from_prospect_id: string | null;
  category: string | null;
  notes: string | null;
  priority: "low" | "normal" | "high";
  profiles_discovered: number;
  profiles_inspected: number;
  profiles_reaching_review: number;
  profiles_approved: number;
  profiles_contacted: number;
  candidates_seen: number;
  duplicates_skipped: number;
  consecutive_uses: number;
  cooldown_until: string | null;
  last_used_at: string | null;
  last_success_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkerCommandRow = {
  id: string;
  worker_id: string | null;
  command_type: string;
  payload: Json;
  status: string;
  created_at: string;
  claimed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  expires_at: string | null;
  result: Json | null;
  error_code: string | null;
  error_message: string | null;
  requested_by: string | null;
  created_by_source: string;
  priority: number;
  idempotency_key: string | null;
};

export type WorkerEventRow = {
  id: string;
  worker_id: string | null;
  event_type: string;
  message: string;
  metadata: Json;
  created_at: string;
};

export type DiscoverySuppressionRow = {
  id: string;
  instagram_username_normalized: string;
  reason: string;
  fit_score: number | null;
  follow_relationship: string | null;
  source: string | null;
  first_seen_at: string;
  last_seen_at: string;
  expires_at: string | null;
  permanent: boolean;
  created_at: string;
  updated_at: string;
};

export type DiscoverySessionRow = {
  id: string;
  started_at: string;
  starting_review_count: number;
  target: number | null;
  profiles_inspected: number;
  ai_qualifications: number;
  prospects_added_to_review: number;
  prospects_disqualified: number;
  suppressed_profiles: number;
  candidates_collected?: number;
  candidates_deferred?: number;
  last_candidate_at: string | null;
  stopped_at: string | null;
  stop_reason: string | null;
};

export type DiscoveryDailyUsageRow = {
  usage_date: string;
  inspections: number;
  ai_qualifications: number;
  updated_at: string;
};

export type OutreachJobRow = {
  id: string;
  prospect_id: string;
  job_type: OutreachJobType;
  status: OutreachJobStatus;
  priority: number;
  sequence_order: number;
  depends_on_job_id: string | null;
  scheduled_for: string;
  available_at: string;
  claimed_at: string | null;
  claimed_by_worker_id: string | null;
  claim_expires_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  cancelled_at: string | null;
  attempt_count: number;
  max_attempts: number;
  last_error: string | null;
  result: Json | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
};

export type CandidateInspectionSnapshotRow = {
  id: string;
  prospect_id: string;
  instagram_username: string;
  card_text: string | null;
  source: string;
  source_seed_id: string | null;
  source_seed_username: string | null;
  seed_support_count: number;
  supporting_seed_usernames: string[];
  pre_score: number | null;
  niche_component: number | null;
  commercial_component: number | null;
  network_component: number | null;
  source_review_yield: number | null;
  source_approval_yield: number | null;
  source_prior_points: number | null;
  seed_review_yield: number | null;
  seed_approval_yield: number | null;
  seed_mature: boolean;
  strategy: string | null;
  priority_band: string | null;
  priority_label: string | null;
  selection_reasons: string | null;
  runner_up_username: string | null;
  runner_up_pre_score: number | null;
  created_at: string;
};

export type TargetingSettingsRow = {
  id: number;
  categories: string[];
  min_followers: number;
  max_followers: number;
  english_only: boolean;
  prefer_united_states: boolean;
  allow_unknown_location: boolean;
  exclude_already_following: boolean;
  exclude_already_contacted: boolean;
  exclude_hobby_accounts: boolean;
  exclude_meme_accounts: boolean;
  exclude_large_agencies: boolean;
  exclude_unrelated_drone: boolean;
  updated_at: string;
};

export type WorkerInstanceRow = {
  id: string;
  worker_id: string;
  machine_name: string | null;
  platform: "darwin" | "win32" | "linux" | null;
  hostname: string | null;
  status: "online" | "offline" | "error" | "attention_required";
  last_heartbeat_at: string | null;
  current_task: string | null;
  browser_connected: boolean;
  instagram_authenticated: boolean;
  attention_reason?: string | null;
  profiles_seen?: number;
  profiles_ingested?: number;
  profiles_excluded_following?: number;
  profiles_qualified?: number;
  session_errors?: number;
  current_username?: string | null;
  last_event?: string | null;
  started_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkerSessionRow = {
  id: string;
  worker_id: string;
  started_at: string;
  ended_at: string | null;
  profiles_seen: number;
  profiles_ingested: number;
  profiles_excluded_following: number;
  profiles_qualified: number;
  errors: number;
  status: "running" | "stopped" | "attention_required" | "error";
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type FollowUpRow = {
  id: string;
  prospect_id: string;
  due_at: string | null;
  status: FollowUpStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type AiUsageRow = {
  id: string;
  prospect_id: string | null;
  model: string;
  operation: string;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  created_at: string;
};

export type ActivityLogRow = {
  id: string;
  prospect_id: string | null;
  event_type: ActivityEventType | string;
  description: string;
  metadata: Json;
  created_at: string;
};

type Insert<T extends Record<string, unknown>> = {
  [K in keyof T]?: T[K];
};

export type Database = {
  public: {
    Tables: {
      prospects: {
        Row: ProspectRow;
        Insert: Insert<ProspectRow> & { instagram_username: string };
        Update: Insert<ProspectRow>;
        Relationships: [
          {
            foreignKeyName: "follow_ups_prospect_id_fkey";
            columns: ["id"];
            isOneToOne: false;
            referencedRelation: "follow_ups";
            referencedColumns: ["prospect_id"];
          },
          {
            foreignKeyName: "activity_log_prospect_id_fkey";
            columns: ["id"];
            isOneToOne: false;
            referencedRelation: "activity_log";
            referencedColumns: ["prospect_id"];
          },
        ];
      };
      settings: {
        Row: SettingsRow;
        Insert: Insert<SettingsRow> & { message_template: string };
        Update: Insert<SettingsRow>;
        Relationships: [];
      };
      discovery_seeds: {
        Row: DiscoverySeedRow;
        Insert: Insert<DiscoverySeedRow> & { instagram_username: string };
        Update: Insert<DiscoverySeedRow>;
        Relationships: [];
      };
      discovery_seed_removals: {
        Row: DiscoverySeedRemovalRow;
        Insert: Insert<DiscoverySeedRemovalRow> & { instagram_username: string };
        Update: Insert<DiscoverySeedRemovalRow>;
        Relationships: [];
      };
      discovery_suppressions: {
        Row: DiscoverySuppressionRow;
        Insert: Insert<DiscoverySuppressionRow> & { instagram_username_normalized: string; reason: string };
        Update: Insert<DiscoverySuppressionRow>;
        Relationships: [];
      };
      candidate_inspection_snapshots: {
        Row: CandidateInspectionSnapshotRow;
        Insert: Insert<CandidateInspectionSnapshotRow> & { prospect_id: string; instagram_username: string; source: string };
        Update: Insert<CandidateInspectionSnapshotRow>;
        Relationships: [];
      };
      discovery_sessions: {
        Row: DiscoverySessionRow;
        Insert: Insert<DiscoverySessionRow>;
        Update: Insert<DiscoverySessionRow>;
        Relationships: [];
      };
      discovery_daily_usage: {
        Row: DiscoveryDailyUsageRow;
        Insert: Insert<DiscoveryDailyUsageRow> & { usage_date: string };
        Update: Insert<DiscoveryDailyUsageRow>;
        Relationships: [];
      };
      worker_commands: {
        Row: WorkerCommandRow;
        Insert: Insert<WorkerCommandRow> & { command_type: string };
        Update: Insert<WorkerCommandRow>;
        Relationships: [];
      };
      worker_events: {
        Row: WorkerEventRow;
        Insert: Insert<WorkerEventRow> & { event_type: string; message: string };
        Update: Insert<WorkerEventRow>;
        Relationships: [];
      };
      targeting_settings: {
        Row: TargetingSettingsRow;
        Insert: Insert<TargetingSettingsRow> & { categories: string[] };
        Update: Insert<TargetingSettingsRow>;
        Relationships: [];
      };
      worker_instances: {
        Row: WorkerInstanceRow;
        Insert: Insert<WorkerInstanceRow> & { worker_id: string };
        Update: Insert<WorkerInstanceRow>;
        Relationships: [];
      };
      worker_sessions: {
        Row: WorkerSessionRow;
        Insert: Insert<WorkerSessionRow> & { worker_id: string };
        Update: Insert<WorkerSessionRow>;
        Relationships: [];
      };
      follow_ups: {
        Row: FollowUpRow;
        Insert: Insert<FollowUpRow> & { prospect_id: string };
        Update: Insert<FollowUpRow>;
        Relationships: [
          {
            foreignKeyName: "follow_ups_prospect_id_fkey";
            columns: ["prospect_id"];
            isOneToOne: false;
            referencedRelation: "prospects";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_usage: {
        Row: AiUsageRow;
        Insert: Insert<AiUsageRow> & { model: string; operation: string };
        Update: Insert<AiUsageRow>;
        Relationships: [
          {
            foreignKeyName: "ai_usage_prospect_id_fkey";
            columns: ["prospect_id"];
            isOneToOne: false;
            referencedRelation: "prospects";
            referencedColumns: ["id"];
          },
        ];
      };
      outreach_jobs: {
        Row: OutreachJobRow;
        Insert: Insert<OutreachJobRow> & {
          prospect_id: string;
          job_type: OutreachJobType;
          sequence_order: number;
          scheduled_for: string;
          available_at: string;
          idempotency_key: string;
        };
        Update: Insert<OutreachJobRow>;
        Relationships: [
          {
            foreignKeyName: "outreach_jobs_prospect_id_fkey";
            columns: ["prospect_id"];
            isOneToOne: false;
            referencedRelation: "prospects";
            referencedColumns: ["id"];
          },
        ];
      };
      activity_log: {
        Row: ActivityLogRow;
        Insert: Insert<ActivityLogRow> & {
          event_type: string;
          description: string;
        };
        Update: Insert<ActivityLogRow>;
        Relationships: [
          {
            foreignKeyName: "activity_log_prospect_id_fkey";
            columns: ["prospect_id"];
            isOneToOne: false;
            referencedRelation: "prospects";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      claim_next_outreach_job: {
        Args: {
          p_worker_id: string;
          p_lease_seconds: number;
          p_now: string;
          p_prospect_id?: string | null;
        };
        Returns: Json | null;
      };
      queue_outreach_sequence: {
        Args: {
          p_prospect_id: string;
          p_message: string;
          p_verify_at: string;
          p_follow_at: string;
          p_send_at: string;
        };
        Returns: Json;
      };
      requeue_outreach_sequence: {
        Args: {
          p_prospect_id: string;
          p_message: string;
          p_verify_at: string;
          p_follow_at: string;
          p_send_at: string;
        };
        Returns: Json;
      };
      sync_discovery_seed_prospect: {
        Args: { p_prospect_id: string };
        Returns: { profiles_inspected: number; profiles_reaching_review: number }[];
      };
      record_discovery_seed_inspection: {
        Args: { p_seed_id: string; p_prospect_id: string };
        Returns: undefined;
      };
      bump_discovery_seed: {
        Args: {
          p_id: string;
          p_discovered?: number;
          p_inspected?: number;
          p_review?: number;
          p_approved?: number;
          p_contacted?: number;
          p_seen?: number;
          p_duplicates?: number;
          p_used?: boolean;
        };
        Returns: undefined;
      };
      bump_discovery_usage: {
        Args: {
          p_date: string;
          p_inspections: number;
          p_ai: number;
        };
        Returns: { inspections: number; ai_qualifications: number }[];
      };
    };
  };
};
