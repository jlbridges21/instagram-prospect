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
