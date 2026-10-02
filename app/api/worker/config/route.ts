import { fallbackSettings, fallbackTargeting } from "@/lib/db/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWorkerAuthorized, workerError, workerUnauthorized } from "@/lib/worker/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isWorkerAuthorized(request)) return workerUnauthorized();

  const admin = createAdminClient();
  if (!admin) return workerError(500, "Worker API is not configured.");

  const [settingsResult, targetingResult] = await Promise.all([
    admin.from("settings").select("*").eq("id", 1).maybeSingle(),
    admin.from("targeting_settings").select("*").eq("id", 1).maybeSingle(),
  ]);

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
  });
}
