import { fallbackSettings, fallbackTargeting } from "@/lib/db/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWorkerAuthorized, workerError, workerUnauthorized } from "@/lib/worker/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isWorkerAuthorized(request)) return workerUnauthorized();

  const admin = createAdminClient();
  if (!admin) return workerError(500, "Worker API is not configured.");

  const settingsColumns = "worker_enabled, heartbeat_interval_seconds, max_active_workers, preferred_browser, automation_enabled, discovery_enabled, max_profiles_per_session, max_profiles_per_hour, discovery_scroll_delay_seconds, discovery_duplicate_cooldown_days, home_feed_enabled, suggested_accounts_enabled, discovery_source_priority, candidate_queue_target, profile_inspection_concurrency, discovery_review_target, discovery_session_inspection_cap, discovery_daily_inspection_cap, discovery_daily_ai_cap, discovery_stop_reason, discovery_run_mode, discovery_run_minutes, discovery_run_inspection_limit, discovery_run_started_at";
  let settingsResult = await admin.from("settings").select(settingsColumns).eq("id", 1).maybeSingle();
  if (settingsResult.error && /home_feed_enabled|discovery_source_priority|candidate_queue_target|discovery_review_target|discovery_run_mode/i.test(settingsResult.error.message)) {
    settingsResult = await admin
      .from("settings")
      .select("worker_enabled, heartbeat_interval_seconds, max_active_workers, preferred_browser, automation_enabled, discovery_enabled, max_profiles_per_session, max_profiles_per_hour, discovery_scroll_delay_seconds, discovery_duplicate_cooldown_days")
      .eq("id", 1)
      .maybeSingle();
  }
  const targetingResult = await admin
    .from("targeting_settings")
    .select("min_followers, max_followers, english_only, prefer_united_states, allow_unknown_location, exclude_already_following, exclude_already_contacted, exclude_hobby_accounts, exclude_meme_accounts, exclude_large_agencies, exclude_unrelated_drone")
    .eq("id", 1)
    .maybeSingle();

  if (settingsResult.error || targetingResult.error) {
    return workerError(500, "Could not read worker configuration.");
  }

  const settings = settingsResult.data;
  const targeting = targetingResult.data;
  const fallback = fallbackSettings();
  const fallbackRules = fallbackTargeting();

  return Response.json({
    workerEnabled: settings?.worker_enabled ?? fallback.workerEnabled,
    heartbeatIntervalSeconds:
      settings?.heartbeat_interval_seconds ?? fallback.heartbeatIntervalSeconds,
    maxActiveWorkers: settings?.max_active_workers ?? fallback.maxActiveWorkers,
    preferredBrowser: settings?.preferred_browser ?? fallback.preferredBrowser,
    minFollowers: targeting?.min_followers ?? fallbackRules.minFollowers,
    maxFollowers: targeting?.max_followers ?? fallbackRules.maxFollowers,
    englishOnly: targeting?.english_only ?? fallbackRules.englishOnly,
    preferUnitedStates: targeting?.prefer_united_states ?? fallbackRules.preferUnitedStates,
    allowUnknownLocation: targeting?.allow_unknown_location ?? fallbackRules.allowUnknownLocation,
    excludeAlreadyFollowing:
      targeting?.exclude_already_following ?? fallbackRules.excludeAlreadyFollowing,
    excludeAlreadyContacted:
      targeting?.exclude_already_contacted ?? fallbackRules.excludeAlreadyContacted,
    excludeHobbyAccounts: targeting?.exclude_hobby_accounts ?? fallbackRules.excludeHobbyAccounts,
    excludeMemeAccounts: targeting?.exclude_meme_accounts ?? fallbackRules.excludeMemeAccounts,
    excludeLargeAgencies: targeting?.exclude_large_agencies ?? fallbackRules.excludeLargeAgencies,
    excludeUnrelatedDrone:
      targeting?.exclude_unrelated_drone ?? fallbackRules.excludeUnrelatedDrone,
    automationEnabled: settings?.automation_enabled ?? false,
    discoveryEnabled: settings?.discovery_enabled ?? true,
    maxProfilesPerSession: settings?.max_profiles_per_session ?? 50,
    maxProfilesPerHour: settings?.max_profiles_per_hour ?? 30,
    discoveryScrollDelaySeconds: settings?.discovery_scroll_delay_seconds ?? 5,
    discoveryDuplicateCooldownDays: settings?.discovery_duplicate_cooldown_days ?? 30,
    homeFeedEnabled: settings?.home_feed_enabled ?? true,
    suggestedAccountsEnabled: settings?.suggested_accounts_enabled ?? true,
    discoverySourcePriority: settings?.discovery_source_priority === "home_first" ? "home_first" : "suggested_first",
    candidateQueueTarget: settings?.candidate_queue_target ?? 10,
    profileInspectionConcurrency: 2,
    reviewTarget: settings?.discovery_review_target ?? "unlimited",
    sessionInspectionCap: settings?.discovery_session_inspection_cap ?? 1000,
    dailyInspectionCap: settings?.discovery_daily_inspection_cap ?? 500,
    dailyAiCap: settings?.discovery_daily_ai_cap ?? 300,
    discoveryStopReason: settings?.discovery_stop_reason ?? null,
    discoveryRunMode: settings?.discovery_run_mode ?? "review_target",
    discoveryRunMinutes: settings?.discovery_run_minutes ?? null,
    discoveryRunInspectionLimit: settings?.discovery_run_inspection_limit ?? null,
    discoveryRunStartedAt: settings?.discovery_run_started_at ?? null,
    workerVersion: "6",
    minSupportedWorkerVersion: "6",
  });
}
