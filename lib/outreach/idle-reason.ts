import type { OutreachSettings } from "@/lib/outreach/types";
import { nextOpenInstant } from "@/lib/outreach/time";
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
  | "outside_active_hours"
  | "hourly_limit_reached"
  | "daily_limit_reached"
  | "next_job_scheduled_for";

export function explainIdleQueue(input: {
  now: Date;
  timeZone: string;
  settings: OutreachSettings;
  pendingScheduledFor: string[];
  completedSendTimes: Date[];
}) {
  if (input.pendingScheduledFor.length === 0) {
    return {
      reason: "no_queued_jobs" as const,
      message: "No approved outreach jobs are currently queued.",
      nextAt: null as string | null,
    };
  }

  const nextAt = [...input.pendingScheduledFor].sort()[0] ?? null;
  const windowOpens = nextOpenInstant(input.now, input.timeZone, input.settings);
  const insideWindow = Math.abs(windowOpens.getTime() - input.now.getTime()) < 1000;
  if (!insideWindow) {
    return {
      reason: "outside_active_hours" as const,
      message: "Outside active outreach hours.",
      nextAt: windowOpens.toISOString(),
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
      nextAt,
    };
  }
  if (sendsThisHour >= input.settings.hourlyMaximum) {
    return {
      reason: "hourly_limit_reached" as const,
      message: "The hourly outreach limit has been reached.",
      nextAt,
    };
  }

  return {
    reason: "next_job_scheduled_for" as const,
    message: "The next outreach job is not due yet.",
    nextAt,
  };
}
