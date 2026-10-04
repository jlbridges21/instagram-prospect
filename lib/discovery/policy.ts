export const SESSION_INSPECTION_CAP = 1000;
export const DAILY_INSPECTION_CAP = 500;
export const DAILY_AI_CAP = 300;
export const DRY_SPELL_MS = 10 * 60 * 1000;
export const DRY_SPELL_EMPTY_CYCLES = 5;

export const SUPPRESSION_DAYS = {
  already_following: null,
  already_contacted: null,
  low_fit: 90,
  below_follower_minimum: 90,
  above_follower_maximum: 180,
  non_english: 180,
  wrong_niche: 180,
  unknown_relationship: 7,
  temporary_profile_error: 7,
} as const;

export type SuppressionReason = keyof typeof SUPPRESSION_DAYS;
export type ReviewTarget = number | "unlimited";

export type DiscoveryStopReason =
  | "review_target_reached"
  | "manual_pause"
  | "inspection_session_cap"
  | "daily_inspection_cap"
  | "daily_ai_cap"
  | "candidate_dry_spell"
  | "instagram_checkpoint"
  | "worker_stopped"
  | "error";

export function reviewTargetReached(currentReview: number, target: ReviewTarget) {
  if (target === "unlimited") return false;
  return currentReview >= target;
}

export function discoveryStopDecision(input: {
  currentReview: number;
  target: ReviewTarget;
  sessionInspections: number;
  sessionCap?: number;
  dailyInspections: number;
  dailyInspectionCap?: number;
  dailyAi: number;
  dailyAiCap?: number;
  minutesWithoutNewCandidate?: number;
  emptyCollectionCycles?: number;
  manualPause?: boolean;
  checkpoint?: boolean;
}) {
  const sessionCap = input.sessionCap ?? SESSION_INSPECTION_CAP;
  const dailyInspectionCap = input.dailyInspectionCap ?? DAILY_INSPECTION_CAP;
  const dailyAiCap = input.dailyAiCap ?? DAILY_AI_CAP;
  let reason: DiscoveryStopReason | null = null;
  if (input.checkpoint) reason = "instagram_checkpoint";
  else if (input.manualPause) reason = "manual_pause";
  else if (reviewTargetReached(input.currentReview, input.target)) reason = "review_target_reached";
  else if (input.sessionInspections >= sessionCap) reason = "inspection_session_cap";
  else if (input.dailyInspections >= dailyInspectionCap) reason = "daily_inspection_cap";
  else if (input.dailyAi >= dailyAiCap) reason = "daily_ai_cap";
  else if (
    (input.minutesWithoutNewCandidate ?? 0) * 60_000 >= DRY_SPELL_MS ||
    (input.emptyCollectionCycles ?? 0) >= DRY_SPELL_EMPTY_CYCLES
  ) {
    reason = "candidate_dry_spell";
  }
  return {
    pauseDiscovery: reason !== null,
    pauseOutreach: false,
    reason,
    autoRestart: false as const,
  };
}

export function discoveryRestartAllowed(input: { explicitStart: boolean; reviewFellBelowTarget: boolean }) {
  return input.explicitStart;
}

export function fillReviewDecision(currentReview: number, target: number) {
  if (currentReview >= target) {
    return {
      start: false as const,
      message: `Review already contains ${currentReview} prospects. Target ${target} is already satisfied.`,
    };
  }
  return { start: true as const, target, discoveryEnabled: true as const, outreachUnchanged: true as const };
}

export function preAiStorage(input: {
  relationship: "following" | "requested" | "not_following" | "unknown";
  followers: number | null;
  minFollowers: number;
  maxFollowers: number;
  duplicate?: boolean;
  unavailable?: boolean;
  nonEnglish?: boolean;
  alreadyContacted?: boolean;
}) {
  if (input.duplicate) return { path: "skip" as const };
  if (input.unavailable) return suppression("temporary_profile_error");
  if (input.alreadyContacted) return suppression("already_contacted");
  if (input.relationship === "following" || input.relationship === "requested") return suppression("already_following");
  if (input.relationship === "unknown") return suppression("unknown_relationship");
  if (input.followers != null && input.followers < input.minFollowers) return suppression("below_follower_minimum");
  if (input.followers != null && input.followers > input.maxFollowers) return suppression("above_follower_maximum");
  if (input.nonEnglish) return suppression("non_english");
  return { path: "full_prospect" as const };
}

export function aiEvaluatedStorage() {
  return { path: "full_prospect" as const };
}

function suppression(reason: SuppressionReason) {
  const days = SUPPRESSION_DAYS[reason];
  return {
    path: "suppression" as const,
    reason,
    permanent: days === null,
    expiresInDays: days,
  };
}

export function suppressionActive(input: { permanent: boolean; expiresAt: string | null; now: Date }) {
  if (input.permanent || !input.expiresAt) return input.permanent;
  return new Date(input.expiresAt).getTime() > input.now.getTime();
}

export function continuousOutreachStep(input: {
  paused: boolean;
  checkpoint: boolean;
  jobReady: boolean;
  nextAt: string | null;
  now: Date;
}) {
  if (input.checkpoint) return { action: "stop" as const, waitMs: 0, reason: "instagram_checkpoint" };
  if (input.paused) return { action: "idle" as const, waitMs: 60_000, reason: "outreach_paused" };
  if (input.jobReady) return { action: "run" as const, waitMs: 0, reason: null };
  if (input.nextAt) {
    const waitMs = Math.max(1_000, Math.min(new Date(input.nextAt).getTime() - input.now.getTime(), 60_000));
    return { action: "wait" as const, waitMs, reason: "next_job_scheduled_for" };
  }
  return { action: "idle" as const, waitMs: 60_000, reason: "no_queued_jobs" };
}

export function singleOutreachMayContinue(sequencesStarted: number) {
  return sequencesStarted < 1;
}

export function livePollDelay(visible: boolean) {
  return visible ? 4_000 : 30_000;
}

export function pageRefreshNeeded(changed: boolean) {
  return changed;
}

export const PROSPECT_DELETE_TABLES = ["outreach_jobs", "follow_ups", "activity_log", "ai_usage", "prospects"] as const;
export const PRESERVED_ON_DELETE = ["settings", "worker_instances", "targeting_settings", "worker_sessions"] as const;

export function deleteTouchesSharedConfig(table: string) {
  return (PRESERVED_ON_DELETE as readonly string[]).includes(table);
}

export function bulkSelection(input: { pageIds: string[]; filteredCount: number; allFiltered: boolean }) {
  if (input.allFiltered) return { mode: "filtered" as const, count: input.filteredCount };
  return { mode: "page" as const, count: input.pageIds.length, ids: input.pageIds };
}

export function discoveryProgressLabel(input: {
  running: boolean;
  currentReview: number;
  target: ReviewTarget;
  reason: DiscoveryStopReason | null;
}) {
  const targetLabel = input.target === "unlimited" ? "Unlimited" : `${input.currentReview} / ${input.target}`;
  if (!input.running && input.reason === "review_target_reached" && input.target !== "unlimited") {
    return `Review target reached\n${targetLabel}\nDiscovery paused automatically.`;
  }
  if (!input.running && input.reason === "inspection_session_cap") {
    return `Discovery stopped.\nReview target:\n${targetLabel}\nReason:\n1,000-profile session inspection limit reached.`;
  }
  if (!input.running && input.reason === "candidate_dry_spell") {
    return `Discovery paused.\nTarget:\n${targetLabel}\nReason:\nNo new unique candidates were found.`;
  }
  if (!input.running && input.reason === "daily_inspection_cap") {
    return `Discovery paused.\n${targetLabel}\nReason:\nDaily profile inspection limit reached.`;
  }
  if (!input.running && input.reason === "daily_ai_cap") {
    return `Discovery paused.\n${targetLabel}\nReason:\nDaily AI qualification limit reached.`;
  }
  return input.running ? `Discovery\nRUNNING\nReview target\n${targetLabel}` : `Discovery\nPAUSED\n${targetLabel}`;
}
