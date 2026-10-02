import type { OutreachJobStatus, OutreachJobType } from "@/lib/outreach/types";

const BLOCKED_PROSPECT_STATUSES = new Set([
  "skipped",
  "disqualified",
  "contacted",
  "replied",
  "demo_booked",
  "converted",
]);

export type ClaimCandidate = {
  status: OutreachJobStatus;
  availableAt: string;
  scheduledFor: string;
  dependsOnStatus: OutreachJobStatus | null;
  prospectStatus: string;
  outreachCancelled: boolean;
  alreadyFollowing: boolean;
  alreadyContacted: boolean;
  jobType: OutreachJobType;
};

export function isJobClaimable(job: ClaimCandidate, now: Date) {
  if (job.status !== "pending" && job.status !== "retry_wait") return false;
  if (new Date(job.availableAt).getTime() > now.getTime()) return false;
  if (new Date(job.scheduledFor).getTime() > now.getTime()) return false;
  if (job.outreachCancelled) return false;
  if (BLOCKED_PROSPECT_STATUSES.has(job.prospectStatus)) return false;
  if (job.jobType !== "verify_profile" && (job.alreadyFollowing || job.alreadyContacted)) {
    return false;
  }
  if (job.dependsOnStatus !== null && job.dependsOnStatus !== "completed") return false;
  return true;
}

export function expiredClaimResolution(input: {
  status: OutreachJobStatus;
  claimExpiresAt: string | null;
  attemptCount: number;
  maxAttempts: number;
  now: Date;
}) {
  if (input.status !== "claimed" && input.status !== "running") return "keep" as const;
  if (!input.claimExpiresAt) return "keep" as const;
  if (new Date(input.claimExpiresAt).getTime() >= input.now.getTime()) return "keep" as const;
  if (input.attemptCount + 1 >= input.maxAttempts) return "fail" as const;
  return "requeue" as const;
}
