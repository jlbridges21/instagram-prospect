export const FOLLOW_CONFIRM_WINDOW_MS = 12_000;
export const FOLLOW_CONFIRM_POLL_MS = 1_000;

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

export async function confirmFollowAfterClick(input: {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  readRelationship: () => Promise<string>;
  refresh: () => Promise<void>;
  windowMs?: number;
  pollMs?: number;
}) {
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
  if ((job.status === "running" || job.status === "claimed") && job.started_at) return "Confirming";
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
