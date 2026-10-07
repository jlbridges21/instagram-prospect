import { clampCandidateFloor } from "@/lib/discovery/candidate-priority";
import { DEFAULT_NEGATIVE_KEYWORDS, LEGACY_POSITIVE_KEYWORDS, clampTuning, effectiveKeywordList } from "@/lib/discovery/defaults";
import { exampleFromProspect, learnQualityModel } from "@/lib/discovery/learned-quality";
import { fallbackSettings, fallbackTargeting } from "@/lib/db/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { isWorkerAuthorized, workerError, workerUnauthorized } from "@/lib/worker/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isWorkerAuthorized(request)) return workerUnauthorized();

  const admin = createAdminClient();
  if (!admin) return workerError(500, "Worker API is not configured.");

  const settingsColumns = "worker_enabled, heartbeat_interval_seconds, max_active_workers, preferred_browser, automation_enabled, discovery_enabled, max_profiles_per_session, max_profiles_per_hour, discovery_scroll_delay_seconds, discovery_duplicate_cooldown_days, home_feed_enabled, suggested_accounts_enabled, discovery_source_priority, candidate_queue_target, profile_inspection_concurrency, discovery_review_target, discovery_session_inspection_cap, discovery_daily_inspection_cap, discovery_daily_ai_cap, discovery_stop_reason, discovery_run_mode, discovery_run_minutes, discovery_run_inspection_limit, discovery_run_started_at, timezone";
  let settingsResult = await admin.from("settings").select(settingsColumns).eq("id", 1).maybeSingle();
  if (settingsResult.error && /home_feed_enabled|discovery_source_priority|candidate_queue_target|discovery_review_target|discovery_run_mode/i.test(settingsResult.error.message)) {
    settingsResult = await admin
      .from("settings")
      .select("worker_enabled, heartbeat_interval_seconds, max_active_workers, preferred_browser, automation_enabled, discovery_enabled, max_profiles_per_session, max_profiles_per_hour, discovery_scroll_delay_seconds, discovery_duplicate_cooldown_days")
      .eq("id", 1)
      .maybeSingle();
  }
  const [seedResult, keywordResult, networkResult, floorResult] = await Promise.all([
    admin.from("discovery_seeds").select("id, instagram_username, source_type, priority, profiles_inspected, profiles_reaching_review, profiles_approved, consecutive_uses, is_active").eq("is_active", true).order("profiles_reaching_review", { ascending: false }).limit(100),
    admin.from("settings").select("discovery_positive_keywords, discovery_negative_keywords, discovery_home_feed_usage, discovery_strategy, discovery_yield_strength, discovery_favor_yield, discovery_min_seed_sample, discovery_seed_cooldown_cycles, discovery_tuning, discovery_ignored_keywords").eq("id", 1).maybeSingle(),
    admin.from("settings").select("discovery_seed_network_enabled, discovery_seed_network_sample").eq("id", 1).maybeSingle(),
    admin.from("settings").select("discovery_min_pre_score").eq("id", 1).maybeSingle(),
  ]);
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
  const sourceYields = await sourceOutcomeYields(admin);
  const learnedQuality = await learnedQualityPayload(admin, keywordResult.data?.discovery_tuning, keywordResult.data?.discovery_ignored_keywords);

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
    timezone: settings && "timezone" in settings && typeof settings.timezone === "string" ? settings.timezone : fallback.timezone,
    discoverySeeds: seedResult.error ? [] : (seedResult.data ?? []).map((seed) => ({
      id: seed.id,
      username: seed.instagram_username,
      sourceType: seed.source_type,
      priority: seed.priority,
      inspected: seed.profiles_inspected,
      review: seed.profiles_reaching_review,
      approved: seed.profiles_approved ?? 0,
      consecutiveUses: seed.consecutive_uses,
    })),
    positiveKeywords: effectiveKeywordList(keywordResult.data?.discovery_positive_keywords, fallback.optimization.positiveKeywords, LEGACY_POSITIVE_KEYWORDS),
    negativeKeywords: effectiveKeywordList(keywordResult.data?.discovery_negative_keywords, DEFAULT_NEGATIVE_KEYWORDS),
    homeFeedUsage: keywordResult.data?.discovery_home_feed_usage ?? fallback.optimization.homeFeedUsage,
    discoveryStrategy: keywordResult.data?.discovery_strategy ?? fallback.optimization.strategy,
    yieldStrength: keywordResult.data?.discovery_yield_strength ?? fallback.optimization.yieldStrength,
    favorYield: keywordResult.data?.discovery_favor_yield ?? fallback.optimization.favorYield,
    minSeedSample: keywordResult.data?.discovery_min_seed_sample ?? fallback.optimization.minSeedSample,
    seedCooldownCycles: keywordResult.data?.discovery_seed_cooldown_cycles ?? fallback.optimization.seedCooldownCycles,
    seedNetworkEnabled: networkResult.error ? fallback.optimization.seedNetworkEnabled : networkResult.data?.discovery_seed_network_enabled !== false,
    seedNetworkSample: networkResult.error ? fallback.optimization.seedNetworkSample : networkResult.data?.discovery_seed_network_sample ?? fallback.optimization.seedNetworkSample,
    minCandidatePreScore: floorResult.error ? fallback.optimization.minCandidatePreScore : clampCandidateFloor(floorResult.data?.discovery_min_pre_score ?? fallback.optimization.minCandidatePreScore),
    tuning: keywordResult.data?.discovery_tuning ?? fallback.optimization.tuning,
    sourceYields: sourceYields.review,
    sourceApprovalYields: sourceYields.approval,
    learnedQuality,
    workerVersion: "6",
    minSupportedWorkerVersion: "6",
  });
}

async function sourceOutcomeYields(admin: ReturnType<typeof createAdminClient>) {
  const review: Record<string, number> = {};
  const approval: Record<string, number> = {};
  if (!admin) return { review, approval };
  const rows = await admin.from("prospects").select("source, status").order("discovered_at", { ascending: false }).limit(1000);
  if (rows.error || !rows.data) return { review, approval };
  const reviewStatuses = new Set(["review", "approved", "contacted", "replied", "follow_up", "demo_booked", "converted"]);
  const approvedStatuses = new Set(["approved", "contacted", "replied", "follow_up", "demo_booked", "converted"]);
  const totals = new Map<string, { inspected: number; review: number; approved: number }>();
  for (const row of rows.data) {
    const source = row.source;
    if (!source) continue;
    const current = totals.get(source) ?? { inspected: 0, review: 0, approved: 0 };
    current.inspected += 1;
    if (reviewStatuses.has(row.status)) current.review += 1;
    if (approvedStatuses.has(row.status)) current.approved += 1;
    totals.set(source, current);
  }
  for (const [source, counts] of totals) {
    if (counts.inspected < 10) continue;
    review[source] = counts.review / counts.inspected;
    approval[source] = counts.approved / counts.inspected;
  }
  return { review, approval };
}

async function learnedQualityPayload(
  admin: ReturnType<typeof createAdminClient>,
  tuning: unknown,
  ignored: string[] | null | undefined,
) {
  if (!admin) return null;
  const settings = clampTuning(tuning);
  const rows = [];
  let from = 0;
  for (;;) {
    const page = await admin
      .from("prospects")
      .select("instagram_username, status, discovery_priority_reason, is_sample")
      .order("discovered_at", { ascending: false })
      .range(from, from + 999);
    if (page.error || !page.data) return null;
    rows.push(...page.data);
    if (page.data.length < 1000) break;
    from += 1000;
  }
  const examples = rows.flatMap((row) => {
    const example = exampleFromProspect(row);
    return example ? [example] : [];
  });
  const model = learnQualityModel({
    examples,
    minimum: settings.learnedTokenMinimum,
    strength: settings.learnedSmoothing,
    ignored: ignored ?? [],
  });
  return {
    ...model,
    tokens: model.tokens.filter((token) => token.sampleSize >= 3).slice(0, 80),
  };
}
