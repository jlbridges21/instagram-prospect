export const FOLLOW_CONFIRM_WINDOW_MS = 12_000;
export const FOLLOW_VERIFY_WINDOW_MS = 20_000;
export const FOLLOW_CONFIRM_POLL_MS = 1_000;
export const FOLLOW_VERIFY_DELAYS_MS = [0, 1_000, 2_000, 4_000, 7_000];
export const FOLLOW_VERIFY_BACKOFF_MINUTES = [8, 25] as const;

const latchedFollowClicks = new Set<string>();
const announcedUncertainFollows = new Set<string>();

export function latchFollowClick(jobId: string) {
  latchedFollowClicks.add(jobId);
}

export function followClickLatched(jobId: string) {
  return latchedFollowClicks.has(jobId);
}

export function clearFollowLatch(jobId: string) {
  latchedFollowClicks.delete(jobId);
}

export function shouldAnnounceUncertainFollow(jobId: string) {
  if (announcedUncertainFollows.has(jobId)) return false;
  announcedUncertainFollows.add(jobId);
  return true;
}

export function clearUncertainFollowAnnouncement(jobId: string) {
  announcedUncertainFollows.delete(jobId);
}

const verificationStarts = new Map<string, number>();

export function shouldAnnounceVerificationStart(jobId: string, now = Date.now()) {
  const previous = verificationStarts.get(jobId);
  if (previous != null && now - previous < 60_000) return false;
  verificationStarts.set(jobId, now);
  return true;
}

export type FollowRelationship = "following" | "not_following" | "requested" | "unknown";

export function isConfirmedFollow(relationship: string) {
  return relationship === "following" || relationship === "requested";
}

export function uncertainFollowResult() {
  return {
    followClickAttempted: true,
    confirmation: "uncertain" as const,
    error_code: "follow_confirmation_uncertain",
  };
}

export function followClickWasAttempted(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  return (result as { followClickAttempted?: boolean }).followClickAttempted === true;
}

export function followVerificationAttempts(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return 0;
  const value = (result as { verificationAttempts?: unknown }).verificationAttempts;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export function followStartupVerified(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  return (result as { startupVerified?: boolean }).startupVerified === true;
}

function storedFollowRelationship(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const record = result as { evidence?: { relationship?: unknown }; relationshipStatus?: unknown };
  const evidence = record.evidence;
  if (evidence && typeof evidence === "object" && typeof evidence.relationship === "string") return evidence.relationship;
  return typeof record.relationshipStatus === "string" ? record.relationshipStatus : null;
}

export function followReconciliationReadAt(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const value = (result as { reconciliationReadAt?: unknown }).reconciliationReadAt;
  return typeof value === "string" ? value : null;
}

export function staleFollowReadReady(
  job: { jobType: string; status: string; result?: unknown },
  now: Date,
) {
  if (job.jobType !== "follow_profile" || job.status !== "failed" || !followStartupVerified(job.result)) return false;
  if (storedFollowRelationship(job.result) === "not_following") return false;
  return orphanedFollowAction({
    status: job.status,
    followClickAttempted: followClickWasAttempted(job.result),
    claimExpiresAt: null,
    reconciliationReadAt: followReconciliationReadAt(job.result),
    localTaskAlive: false,
    now: now.getTime(),
  }) === "read";
}

export function orphanedFollowAction(input: {
  status: string;
  followClickAttempted: boolean;
  claimExpiresAt: string | null;
  reconciliationReadAt: string | null;
  localTaskAlive: boolean;
  now: number;
}) {
  const lease = input.claimExpiresAt ? new Date(input.claimExpiresAt).getTime() : 0;
  if (input.localTaskAlive && lease > input.now) return "active" as const;
  if (input.reconciliationReadAt) return "terminal" as const;
  if (!input.followClickAttempted) return "ignore" as const;
  const expired = lease <= input.now;
  const stale = input.status === "failed" || ((input.status === "claimed" || input.status === "running") && expired);
  return stale ? "read" as const : "ignore" as const;
}

export function staleFollowRecovery(input: { followClickAttempted: boolean; relationship: string; attempts: number }) {
  if (!input.followClickAttempted) return { action: "ignore" as const, click: false as const };
  if (input.relationship === "following" || input.relationship === "requested") {
    return { action: "confirm" as const, click: false as const, advance: "direct" as const };
  }
  if (input.relationship === "not_following" || input.attempts >= 3) {
    return { action: "needs_review" as const, click: false as const };
  }
  return { action: "retry" as const, click: false as const };
}

export function followAttemptPlan(input: { followClickAttempted: boolean; relationship: string }) {
  if (input.followClickAttempted && isConfirmedFollow(input.relationship)) {
    return { click: false as const, action: "complete" as const };
  }
  if (input.followClickAttempted) return { click: false as const, action: "verify" as const };
  if (input.relationship === "not_following") return { click: true as const, action: "click" as const };
  return { click: false as const, action: "stop" as const };
}

export function nextFollowVerification(input: {
  attemptsSoFar: number;
  now: number;
  manual?: boolean;
}) {
  const verificationAttempts = input.manual ? input.attemptsSoFar : input.attemptsSoFar + 1;
  if (input.manual || verificationAttempts >= 3) {
    return {
      action: "needs_review" as const,
      state: "follow_verification_uncertain" as const,
      status: "failed" as const,
      verificationAttempts: Math.max(verificationAttempts, 3),
      availableAt: new Date(input.now).toISOString(),
      minutes: null as number | null,
      startupVerified: true,
    };
  }
  const minutes = FOLLOW_VERIFY_BACKOFF_MINUTES[verificationAttempts - 1] ?? 25;
  return {
    action: "retry_later" as const,
    state: "follow_verification_uncertain" as const,
    status: "retry_wait" as const,
    verificationAttempts,
    availableAt: new Date(input.now + minutes * 60_000).toISOString(),
    minutes,
    startupVerified: false,
  };
}

export function isFollowVerificationJob(job: { jobType: string; status: string; result?: unknown }) {
  if (job.jobType !== "follow_profile") return false;
  if (job.status === "completed" || job.status === "cancelled") return false;
  return followClickWasAttempted(job.result);
}

export function followNeedsManualReview(job: { job_type: string; status: string; result?: unknown }) {
  if (job.job_type !== "follow_profile" || !followClickWasAttempted(job.result)) return false;
  return job.status === "failed" || followVerificationAttempts(job.result) >= 3 || followStartupVerified(job.result);
}

export function shouldCompleteFollowWithoutClick(input: {
  relationship: string;
  followClickAttempted: boolean;
  verifyNotFollowing: boolean;
  executionStarted: boolean;
}) {
  if (!isConfirmedFollow(input.relationship)) return false;
  if (input.followClickAttempted) return true;
  return input.executionStarted && input.verifyNotFollowing;
}

export function isPreexistingFollow(input: {
  relationship: string;
  followClickAttempted: boolean;
  verifyNotFollowing: boolean;
  executionStarted: boolean;
}) {
  if (!isConfirmedFollow(input.relationship)) return false;
  return !shouldCompleteFollowWithoutClick(input);
}

export function relationshipEvidenceLabel(relationship: string) {
  if (relationship === "following") return "Following";
  if (relationship === "requested") return "Requested";
  if (relationship === "not_following") return "Follow";
  return "unknown";
}

export function relationshipSourceLabel(strategy: string | null | undefined) {
  if (
    strategy === "global-exact-action-near-profile-header" ||
    strategy === "exact header relationship button" ||
    strategy === "header-button"
  ) {
    return "exact header relationship button";
  }
  return strategy && strategy !== "none" ? strategy : "no exact header relationship control";
}

export function advanceAfterFollow(result: { followed?: boolean; confirmation?: string; relationshipStatus?: string }) {
  if (result.confirmation === "uncertain") return "wait" as const;
  if (result.followed === true && (result.relationshipStatus === "following" || result.relationshipStatus === "requested")) {
    return "send" as const;
  }
  return "stop" as const;
}

export function followVerificationFacts(job: {
  status: string;
  job_type: string;
  result?: unknown;
}) {
  if (job.job_type !== "follow_profile" || !followClickWasAttempted(job.result)) return null;
  const result = job.result && typeof job.result === "object" && !Array.isArray(job.result)
    ? job.result as { confirmation?: string; relationshipStatus?: string; nextVerificationAt?: string; evidence?: { relationship?: string } }
    : {};
  const relationship = result.evidence?.relationship || result.relationshipStatus || "unknown";
  return {
    state: followNeedsManualReview(job) ? "Needs Review" : "Follow verification",
    clickRecorded: true,
    relationship,
    attempt: Math.max(1, followVerificationAttempts(job.result)),
    maxAttempts: 3,
    nextCheck: typeof result.nextVerificationAt === "string" ? result.nextVerificationAt : null,
  };
}

export async function confirmFollowAfterClick(input: {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  readRelationship: () => Promise<string>;
  refresh: () => Promise<void>;
  windowMs?: number;
  pollMs?: number;
  delaysMs?: number[];
}) {
  if (input.delaysMs && input.delaysMs.length > 0) {
    const started = input.now();
    const windowMs = input.windowMs ?? FOLLOW_VERIFY_WINDOW_MS;
    let relationship = "unknown";
    let refreshed = false;
    for (const mark of input.delaysMs) {
      if (mark > windowMs) break;
      const wait = started + mark - input.now();
      if (wait > 0) await input.sleep(wait);
      relationship = await input.readRelationship();
      if (relationship === "restricted") return { confirmed: false as const, relationship, clicks: 1 as const };
      if (isConfirmedFollow(relationship)) {
        return { confirmed: true as const, relationship, clicks: 1 as const };
      }
      if (!refreshed && mark >= 4_000) {
        refreshed = true;
        await input.refresh();
        relationship = await input.readRelationship();
        if (relationship === "restricted") return { confirmed: false as const, relationship, clicks: 1 as const };
        if (isConfirmedFollow(relationship)) {
          return { confirmed: true as const, relationship, clicks: 1 as const };
        }
      }
    }
    return { confirmed: false as const, relationship, clicks: 1 as const };
  }
  const windowMs = input.windowMs ?? FOLLOW_CONFIRM_WINDOW_MS;
  const pollMs = input.pollMs ?? FOLLOW_CONFIRM_POLL_MS;
  const started = input.now();
  const deadline = started + windowMs;
  let refreshed = false;
  let relationship = "unknown";
  while (input.now() <= deadline) {
    relationship = await input.readRelationship();
    if (isConfirmedFollow(relationship)) {
      return { confirmed: true as const, relationship, clicks: 1 as const };
    }
    const elapsed = input.now() - started;
    if (!refreshed && elapsed >= Math.floor(windowMs / 2)) {
      refreshed = true;
      await input.refresh();
      continue;
    }
    if (input.now() >= deadline) break;
    await input.sleep(pollMs);
  }
  return { confirmed: false as const, relationship, clicks: 1 as const };
}

export function queueFollowStatusLabel(job: {
  status: string;
  job_type: string;
  started_at?: string | null;
  result?: unknown;
}) {
  if (job.job_type !== "follow_profile") return null;
  if (followNeedsManualReview(job)) return "Needs Review";
  if ((job.status === "running" || job.status === "claimed") && job.started_at && !followClickWasAttempted(job.result)) return "Confirming";
  if (followClickWasAttempted(job.result)) return "Needs verification";
  return null;
}

export type LeaseJob = {
  id: string;
  status: string;
  claimedBy: string | null;
  claimedAt: string | null;
  claimExpiresAt: string | null;
};

export function staleReclaimDecision(job: LeaseJob, now: Date, workerId: string) {
  if (job.status === "completed" || job.status === "cancelled" || job.status === "failed") {
    return { ok: false as const, reason: "finished" as const };
  }
  if (job.status !== "running" && job.status !== "claimed") {
    return { ok: false as const, reason: "not_open" as const };
  }
  const expires = job.claimExpiresAt ? new Date(job.claimExpiresAt).getTime() : 0;
  if (expires > now.getTime()) {
    if (job.claimedBy === workerId) return { ok: true as const, action: "keep" as const };
    return { ok: false as const, reason: "lease_active" as const };
  }
  return { ok: true as const, action: "reclaim" as const };
}

export function atomicReclaim(job: LeaseJob, workerId: string, now: Date, leaseSeconds: number) {
  const decision = staleReclaimDecision(job, now, workerId);
  if (!decision.ok || decision.action !== "reclaim") return null;
  if (job.claimExpiresAt && new Date(job.claimExpiresAt).getTime() > now.getTime()) return null;
  return {
    ...job,
    status: "claimed",
    claimedBy: workerId,
    claimedAt: now.toISOString(),
    claimExpiresAt: new Date(now.getTime() + leaseSeconds * 1000).toISOString(),
  };
}

export function recoverFollowDecision(input: {
  relationship: string;
  followClickAttempted: boolean;
  verifyNotFollowing: boolean;
  executionStarted: boolean;
}) {
  if (shouldCompleteFollowWithoutClick(input)) {
    return { action: "complete" as const, clicks: 0 as const, stopBeforeSend: true as const };
  }
  return { action: "review" as const, clicks: 0 as const, stopBeforeSend: true as const };
}

export function expiredFollowNeedsStamp(job: {
  job_type: string;
  status: string;
  started_at: string | null;
  claim_expires_at: string | null;
  result: unknown;
  now: Date;
}) {
  if (job.job_type !== "follow_profile") return false;
  if (job.status !== "running" && job.status !== "claimed") return false;
  if (!job.started_at || !job.claim_expires_at) return false;
  if (new Date(job.claim_expires_at).getTime() > job.now.getTime()) return false;
  return !followClickWasAttempted(job.result);
}
