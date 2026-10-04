import type { OutreachSettings } from "@/lib/outreach/types";
import { localDateKey, localHourKey } from "@/lib/outreach/time";

export function claimBlockMessage(reason: string) {
  if (reason === "automation_paused") return "Outreach automation is paused.";
  if (reason === "worker_disabled") return "The worker is disabled.";
  if (reason === "heartbeat_required") return "The worker heartbeat is missing.";
  if (reason === "another_worker_active") return "Another worker is already active.";
  return reason;
}

export type IdleQueueReason =
  | "no_queued_jobs"
  | "hourly_limit_reached"
  | "daily_limit_reached"
  | "next_job_scheduled_for"
  | "dependency_not_complete"
  | "job_in_progress"
  | "retry_wait";

export type IdleJob = {
  status: string;
  jobType: string;
  scheduledFor: string;
  availableAt?: string | null;
  dependsOnStatus?: string | null;
  dependsOnType?: string | null;
  username?: string | null;
  claimExpiresAt?: string | null;
};

export function explainIdleQueue(input: {
  now: Date;
  timeZone: string;
  settings: OutreachSettings;
  pendingScheduledFor?: string[];
  jobs?: IdleJob[];
  completedSendTimes: Date[];
}) {
  const jobs: IdleJob[] =
    input.jobs ??
    (input.pendingScheduledFor ?? []).map((scheduledFor) => ({
      status: "pending",
      jobType: "send_message",
      scheduledFor,
      dependsOnStatus: "completed",
    }));
  const open = jobs.filter((job) =>
    job.status === "pending" || job.status === "retry_wait" || job.status === "running" || job.status === "claimed",
  );
  if (open.length === 0) {
    return {
      reason: "no_queued_jobs" as const,
      message: "No approved outreach jobs are currently queued.",
      nextAt: null as string | null,
    };
  }

  const nowMs = input.now.getTime();
  const inProgress = open.find((job) => {
    if (job.status !== "running" && job.status !== "claimed") return false;
    if (!job.claimExpiresAt) return true;
    return new Date(job.claimExpiresAt).getTime() > nowMs;
  });
  if (inProgress) {
    const who = inProgress.username ? ` for @${inProgress.username}` : "";
    return {
      reason: "job_in_progress" as const,
      message: `${stepName(inProgress.jobType)} is still in progress${who}.`,
      nextAt: null,
    };
  }

  const blocked = open.filter(
    (job) =>
      (job.status === "pending" || job.status === "retry_wait") &&
      job.dependsOnStatus != null &&
      job.dependsOnStatus !== "completed",
  );
  const ready = open.filter(
    (job) =>
      (job.status === "pending" || job.status === "retry_wait") &&
      (job.dependsOnStatus == null || job.dependsOnStatus === "completed"),
  );
  if (ready.length === 0 && blocked.length > 0) {
    const blocker = blocked[0];
    const who = blocker?.username ? ` for @${blocker.username}` : "";
    return {
      reason: "dependency_not_complete" as const,
      message: `Waiting for ${stepName(blocker?.dependsOnType)} to complete${who}.`,
      nextAt: null,
    };
  }

  const futureReady = ready
    .map((job) => job.scheduledFor)
    .filter((iso) => new Date(iso).getTime() > nowMs)
    .sort();
  const retryAt = ready
    .filter((job) => job.status === "retry_wait" && job.availableAt && new Date(job.availableAt).getTime() > nowMs)
    .map((job) => job.availableAt as string)
    .sort()[0] ?? null;
  const due = ready.some((job) => {
    const scheduled = new Date(job.scheduledFor).getTime();
    const available = job.availableAt ? new Date(job.availableAt).getTime() : scheduled;
    return scheduled <= nowMs && available <= nowMs;
  });
  if (due) {
    return {
      reason: "job_in_progress" as const,
      message: "An outreach step is still open and is not ready to claim.",
      nextAt: null,
    };
  }

  const today = localDateKey(input.now, input.timeZone);
  const hour = localHourKey(input.now, input.timeZone);
  const sendsToday = input.completedSendTimes.filter((value) => localDateKey(value, input.timeZone) === today).length;
  const sendsThisHour = input.completedSendTimes.filter((value) => localHourKey(value, input.timeZone) === hour).length;
  if (sendsToday >= input.settings.dailyMaximum) {
    return {
      reason: "daily_limit_reached" as const,
      message: "The daily outreach limit has been reached.",
      nextAt: futureStamp(futureReady[0] ?? null, nowMs),
    };
  }
  if (sendsThisHour >= input.settings.hourlyMaximum) {
    return {
      reason: "hourly_limit_reached" as const,
      message: "The hourly outreach limit has been reached.",
      nextAt: futureStamp(futureReady[0] ?? null, nowMs),
    };
  }
  if (retryAt) {
    return {
      reason: "retry_wait" as const,
      message: "The next outreach step is waiting to retry.",
      nextAt: futureStamp(retryAt, nowMs),
    };
  }
  const nextAt = futureStamp(futureReady[0] ?? null, nowMs);
  if (nextAt) {
    return {
      reason: "next_job_scheduled_for" as const,
      message: "The next outreach job is not due yet.",
      nextAt,
    };
  }
  if (blocked.length > 0) {
    const blocker = blocked[0];
    const who = blocker?.username ? ` for @${blocker.username}` : "";
    return {
      reason: "dependency_not_complete" as const,
      message: `Waiting for ${stepName(blocker?.dependsOnType)} to complete${who}.`,
      nextAt: null,
    };
  }
  return {
    reason: "no_queued_jobs" as const,
    message: "No approved outreach jobs are currently queued.",
    nextAt: null,
  };
}

function futureStamp(iso: string | null, nowMs: number) {
  if (!iso) return null;
  return new Date(iso).getTime() > nowMs ? iso : null;
}

function stepName(type: string | null | undefined) {
  if (type === "follow_profile") return "Follow account";
  if (type === "verify_profile") return "Verify profile";
  if (type === "send_message") return "Send message";
  return "the previous step";
}
