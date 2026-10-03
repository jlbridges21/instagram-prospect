const ACTIVE_JOB_STATUSES = new Set(["pending", "retry_wait", "claimed", "running"]);

export type OutreachJobSnapshot = {
  status: string;
  idempotencyKey?: string | null;
  scheduledFor?: string | null;
  jobType?: string | null;
  createdAt?: string | null;
};

export function nextOutreachVersion(keys: Array<string | null | undefined>) {
  let max = 0;
  for (const key of keys) {
    const match = key?.match(/:outreach-v(\d+)$/);
    if (!match) continue;
    max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

export function requeueDecision(input: {
  status: string;
  alreadyContacted: boolean;
  jobs: OutreachJobSnapshot[];
}) {
  if (input.alreadyContacted || input.status === "contacted") {
    return { allowed: false as const, reason: "already contacted" };
  }
  if (input.status !== "approved") {
    return { allowed: false as const, reason: "not approved" };
  }
  if (input.jobs.some((job) => ACTIVE_JOB_STATUSES.has(job.status))) {
    return { allowed: false as const, reason: "already queued" };
  }
  if (!input.jobs.some((job) => job.status === "cancelled")) {
    return { allowed: false as const, reason: "nothing to requeue" };
  }
  return {
    allowed: true as const,
    version: nextOutreachVersion(input.jobs.map((job) => job.idempotencyKey)),
  };
}

export function automationChange(enabled: boolean, cancelPending: boolean) {
  return {
    automationEnabled: enabled,
    cancelPendingJobs: !enabled && cancelPending,
    changesProspectStatus: false,
  };
}

export function requeueSummary(input: { requeued: number; skipped: number }) {
  return `${input.requeued} requeued. ${input.skipped} skipped.`;
}

export function bulkProspectActions(
  rows: Array<{ id: string; status: string; canRequeue: boolean; canSkip: boolean; canApprove: boolean }>,
) {
  const approve = rows.filter((row) => row.canApprove);
  const requeue = rows.filter((row) => row.canRequeue);
  const skip = rows.filter((row) => row.canSkip);
  return {
    approveIds: approve.map((row) => row.id),
    requeueIds: requeue.map((row) => row.id),
    skipIds: skip.map((row) => row.id),
  };
}

export function latestJobsByType<T extends { job_type: string; created_at: string }>(jobs: T[]) {
  const latest = new Map<string, T>();
  for (const job of jobs) {
    const current = latest.get(job.job_type);
    if (!current || job.created_at > current.created_at) latest.set(job.job_type, job);
  }
  return [...latest.values()];
}

export function prospectOutreachFlags(jobs: OutreachJobSnapshot[]) {
  const active = jobs.some((job) => ACTIVE_JOB_STATUSES.has(job.status));
  const cancelled = jobs.some((job) => job.status === "cancelled");
  const nextScheduled = jobs
    .filter((job) => ACTIVE_JOB_STATUSES.has(job.status) && job.scheduledFor)
    .map((job) => job.scheduledFor as string)
    .sort()[0] ?? null;
  return {
    active,
    canRequeue: !active && cancelled,
    nextScheduled,
  };
}
