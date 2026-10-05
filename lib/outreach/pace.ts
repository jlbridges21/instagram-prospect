import { localDateKey, startOfNextLocalDay } from "@/lib/outreach/time";

export const OUTREACH_HOUR_MS = 60 * 60 * 1000;

export type PaceReason = "ready" | "minimum_spacing" | "hourly_limit" | "daily_limit" | "scheduled_retry";

export function paceReasonLabel(reason: PaceReason) {
  if (reason === "minimum_spacing") return "Minimum spacing";
  if (reason === "hourly_limit") return "Hourly outreach limit reached";
  if (reason === "daily_limit") return "Daily limit reached";
  if (reason === "scheduled_retry") return "Scheduled retry";
  return "Ready";
}

export function formatEligibleIn(at: Date, now: Date) {
  const seconds = Math.max(0, Math.ceil((at.getTime() - now.getTime()) / 1000));
  if (seconds === 0) return "now";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remain = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remain}s`;
  return `${remain}s`;
}

export function nextProspectSlot(input: {
  now: Date;
  timeZone: string;
  minimumSpacingSeconds: number;
  hourlyMaximum: number;
  dailyMaximum: number;
  completedSendTimes: Date[];
  notBefore?: Date | null;
}) {
  const spacingMs = Math.max(0, input.minimumSpacingSeconds) * 1000;
  const hourlyMaximum = Math.max(1, input.hourlyMaximum);
  const dailyMaximum = Math.max(1, input.dailyMaximum);
  let candidate = new Date(input.now.getTime());
  let reason: PaceReason = "ready";

  const move = (at: Date, nextReason: PaceReason) => {
    if (at.getTime() > candidate.getTime()) {
      candidate = at;
      reason = nextReason;
    }
  };

  if (input.notBefore && input.notBefore.getTime() > candidate.getTime()) {
    move(input.notBefore, "scheduled_retry");
  }

  for (let guard = 0; guard < 24 * 21; guard += 1) {
    const latest = latestSend(input.completedSendTimes);
    if (latest) move(new Date(latest.getTime() + spacingMs), "minimum_spacing");

    const inHour = input.completedSendTimes
      .filter((value) => {
        const delta = candidate.getTime() - value.getTime();
        return delta >= 0 && delta < OUTREACH_HOUR_MS;
      })
      .sort((left, right) => left.getTime() - right.getTime());
    if (inHour.length >= hourlyMaximum) {
      const oldest = inHour[0];
      if (!oldest) break;
      move(new Date(oldest.getTime() + OUTREACH_HOUR_MS), "hourly_limit");
      continue;
    }

    const dayKey = localDateKey(candidate, input.timeZone);
    const onDay = input.completedSendTimes.filter((value) => localDateKey(value, input.timeZone) === dayKey);
    if (onDay.length >= dailyMaximum) {
      move(startOfNextLocalDay(candidate, input.timeZone), "daily_limit");
      continue;
    }
    break;
  }

  return { at: candidate, reason: candidate.getTime() - input.now.getTime() < 1000 ? "ready" : reason };
}

export type PaceJob = {
  id: string;
  prospectId: string;
  username?: string | null;
  jobType: string;
  status: string;
  scheduledFor: string;
  availableAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
  result?: unknown;
  lastError?: string | null;
};

export function jobIsUncertain(job: Pick<PaceJob, "status" | "result" | "lastError">) {
  if (job.status === "running" || job.status === "claimed" || job.status === "failed") return true;
  const result = job.result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const record = result as { confirmation?: string; error_code?: string; sendAttempted?: boolean };
    if (record.confirmation === "uncertain") return true;
    if (record.error_code === "follow_confirmation_uncertain" || record.error_code === "send_confirmation_uncertain") {
      return true;
    }
    if (record.sendAttempted === true && job.status !== "completed") return true;
  }
  return /uncertain/i.test(job.lastError ?? "");
}

export function prospectCanReflow(jobs: PaceJob[]) {
  const open = jobs.filter((job) => job.status !== "completed" && job.status !== "cancelled");
  if (open.length === 0) return false;
  return open.every((job) => job.status === "pending" && !job.startedAt && !jobIsUncertain(job));
}

export function reflowPlan(input: {
  now: Date;
  timeZone: string;
  minimumSpacingSeconds: number;
  hourlyMaximum: number;
  dailyMaximum: number;
  completedSendTimes: Date[];
  jobs: PaceJob[];
}) {
  const grouped = new Map<string, PaceJob[]>();
  for (const job of input.jobs) {
    const list = grouped.get(job.prospectId) ?? [];
    list.push(job);
    grouped.set(job.prospectId, list);
  }

  const prospects = [...grouped.entries()]
    .filter(([, jobs]) => prospectCanReflow(jobs))
    .sort((left, right) => {
      const leftAt = earliestStamp(left[1]);
      const rightAt = earliestStamp(right[1]);
      if (leftAt !== rightAt) return leftAt < rightAt ? -1 : 1;
      return left[0] < right[0] ? -1 : 1;
    });

  const virtual = [...input.completedSendTimes];
  let cursor = new Date(input.now.getTime());
  const updates: Array<{ id: string; prospectId: string; scheduledFor: string }> = [];
  for (const [prospectId, jobs] of prospects) {
    const slot = nextProspectSlot({
      now: cursor,
      timeZone: input.timeZone,
      minimumSpacingSeconds: input.minimumSpacingSeconds,
      hourlyMaximum: input.hourlyMaximum,
      dailyMaximum: input.dailyMaximum,
      completedSendTimes: virtual,
    });
    const iso = input.now.toISOString();
    for (const job of jobs) {
      if (job.status !== "pending" || job.startedAt || jobIsUncertain(job)) continue;
      if (job.scheduledFor !== iso) updates.push({ id: job.id, prospectId, scheduledFor: iso });
    }
    virtual.push(slot.at);
    cursor = slot.at;
  }

  const last = virtual.length > input.completedSendTimes.length ? virtual[virtual.length - 1] : null;
  return {
    updates,
    remaining: prospects.length,
    nextAt: prospects.length > 0 ? nextProspectSlot({
      now: input.now,
      timeZone: input.timeZone,
      minimumSpacingSeconds: input.minimumSpacingSeconds,
      hourlyMaximum: input.hourlyMaximum,
      dailyMaximum: input.dailyMaximum,
      completedSendTimes: input.completedSendTimes,
    }) : null,
    estimatedCompletion: last,
  };
}

export type ClaimPaceDecision = {
  action: "claim" | "wait" | "idle";
  prospectId: string | null;
  username: string | null;
  at: Date | null;
  reason: PaceReason;
  jobIds: string[];
};

export function queueHealth(jobs: PaceJob[]) {
  const grouped = new Map<string, PaceJob[]>();
  for (const job of jobs) grouped.set(job.prospectId, [...(grouped.get(job.prospectId) ?? []), job]);
  let fresh = 0;
  let retrying = 0;
  let failed = 0;
  for (const prospectJobs of grouped.values()) {
    const open = prospectJobs.filter((job) => job.status === "pending" || job.status === "retry_wait" || job.status === "claimed" || job.status === "running");
    if (open.some((job) => job.status === "retry_wait")) retrying += 1;
    else if (open.length > 0) fresh += 1;
    else if (prospectJobs.some((job) => job.status === "failed")) failed += 1;
  }
  return { remaining: fresh + retrying, fresh, retrying, failed };
}

export function claimPaceDecision(input: {
  now: Date;
  timeZone: string;
  minimumSpacingSeconds: number;
  hourlyMaximum: number;
  dailyMaximum: number;
  completedSendTimes: Date[];
  jobs: PaceJob[];
}): ClaimPaceDecision {
  const grouped = new Map<string, PaceJob[]>();
  for (const job of input.jobs) grouped.set(job.prospectId, [...(grouped.get(job.prospectId) ?? []), job]);
  const prospects = [...grouped.entries()].filter(([, jobs]) => !jobs.some((job) => jobIsUncertain(job) || job.status === "running" || job.status === "claimed"));

  const continuation = prospects
    .map(([prospectId, jobs]) => ({ prospectId, jobs, next: nextOpenJob(jobs) }))
    .filter((item) => item.next && item.next.status === "pending" && item.next.jobType !== "verify_profile" && item.jobs.some((job) => job.status === "completed"))
    .sort((left, right) => (left.next?.createdAt ?? "").localeCompare(right.next?.createdAt ?? ""));
  const firstContinuation = continuation[0];
  if (firstContinuation?.next) {
    return claim(firstContinuation.prospectId, firstContinuation.next, input.now);
  }

  const slot = nextProspectSlot(input);
  const fresh = prospects
    .filter(([, jobs]) => prospectCanReflow(jobs))
    .sort((left, right) => earliestStamp(left[1]) < earliestStamp(right[1]) ? -1 : 1);
  if (slot.at.getTime() > input.now.getTime() + 1000) {
    const waiting = fresh[0];
    return {
      action: "wait",
      prospectId: waiting?.[0] ?? null,
      username: waiting?.[1][0]?.username ?? null,
      at: slot.at,
      reason: slot.reason,
      jobIds: waiting?.[1].map((job) => job.id) ?? [],
    };
  }

  const readyFresh = fresh[0];
  if (readyFresh) return claim(readyFresh[0], readyFresh[1][0] ?? null, input.now);

  const dueRetries = prospects
    .map(([prospectId, jobs]) => ({ prospectId, jobs, next: nextOpenJob(jobs) }))
    .filter((item) => item.next?.status === "retry_wait" && availableAt(item.next, input.now).getTime() <= input.now.getTime())
    .sort((left, right) => availableAt(left.next, input.now).getTime() - availableAt(right.next, input.now).getTime());
  const due = dueRetries[0];
  if (due?.next) return claim(due.prospectId, due.next, input.now);

  const futureRetry = prospects
    .map(([, jobs]) => nextOpenJob(jobs))
    .filter((job): job is PaceJob => job?.status === "retry_wait")
    .map((job) => availableAt(job, input.now))
    .sort((left, right) => left.getTime() - right.getTime())[0];
  if (futureRetry && futureRetry.getTime() > input.now.getTime()) {
    return { action: "wait", prospectId: null, username: null, at: futureRetry, reason: "scheduled_retry", jobIds: [] };
  }
  if (fresh.length === 0 && dueRetries.length === 0) {
    return { action: "idle", prospectId: null, username: null, at: null, reason: "ready", jobIds: [] };
  }
  return { action: "idle", prospectId: null, username: null, at: null, reason: "ready", jobIds: [] };
}

function nextOpenJob(jobs: PaceJob[]) {
  return jobs
    .filter((job) => job.status === "pending" || job.status === "retry_wait")
    .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor))[0] ?? null;
}

function availableAt(job: PaceJob | null, now: Date) {
  if (!job) return now;
  return new Date(job.availableAt ?? job.scheduledFor);
}

function claim(prospectId: string, job: PaceJob | null, now: Date): ClaimPaceDecision {
  return {
    action: "claim",
    prospectId,
    username: job?.username ?? null,
    at: now,
    reason: "ready",
    jobIds: job ? [job.id] : [],
  };
}

function latestSend(times: Date[]) {
  return times.reduce<Date | null>((latest, value) => {
    if (!latest || value.getTime() > latest.getTime()) return value;
    return latest;
  }, null);
}

function earliestStamp(jobs: PaceJob[]) {
  return jobs.reduce((earliest, job) => (job.scheduledFor < earliest ? job.scheduledFor : earliest), jobs[0]?.scheduledFor ?? "");
}
