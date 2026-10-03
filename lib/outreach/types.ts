export const OUTREACH_JOB_TYPES = ["verify_profile", "follow_profile", "send_message"] as const;

export type OutreachJobType = (typeof OUTREACH_JOB_TYPES)[number];

export const OUTREACH_JOB_STATUSES = [
  "pending",
  "claimed",
  "running",
  "completed",
  "failed",
  "cancelled",
  "retry_wait",
] as const;

export type OutreachJobStatus = (typeof OUTREACH_JOB_STATUSES)[number];

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export const WORKER_ERROR_CODES = [
  "profile_not_found",
  "login_required",
  "instagram_checkpoint",
  "page_load_failed",
  "follow_failed",
  "dm_unavailable",
  "message_send_failed",
  "rate_limited",
  "browser_error",
  "timeout",
  "unknown",
  "existing_conversation",
  "action_blocked",
  "preexisting_follow",
  "follow_confirmation_uncertain",
  "dm_composer_not_found",
  "recipient_confirmation_failed",
  "send_confirmation_uncertain",
  "composer_text_mismatch",
] as const;

export type WorkerErrorCode = (typeof WORKER_ERROR_CODES)[number];

export type OutreachSettings = {
  automationEnabled: boolean;
  activeDays: Weekday[];
  activeStart: string;
  activeEnd: string;
  hourlyMinimum: number;
  hourlyMaximum: number;
  dailyMaximum: number;
  minimumActionDelaySeconds: number;
  schedulingSpreadSeconds: number;
  claimLeaseSeconds: number;
};

export const JOB_TYPE_LABELS: Record<OutreachJobType, string> = {
  verify_profile: "Verify profile",
  follow_profile: "Follow account",
  send_message: "Send message",
};

export const JOB_STATUS_LABELS: Record<OutreachJobStatus, string> = {
  pending: "Scheduled",
  claimed: "Claimed",
  running: "In progress",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  retry_wait: "Waiting to retry",
};

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export function isOutreachJobType(value: string): value is OutreachJobType {
  return OUTREACH_JOB_TYPES.some((type) => type === value);
}

export function isOutreachJobStatus(value: string): value is OutreachJobStatus {
  return OUTREACH_JOB_STATUSES.some((status) => status === value);
}

export function isWeekday(value: string): value is Weekday {
  return WEEKDAYS.some((day) => day === value);
}
