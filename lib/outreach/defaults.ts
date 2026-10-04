import type { OutreachSettings, Weekday } from "@/lib/outreach/types";
import { WEEKDAYS } from "@/lib/outreach/types";

export const DEFAULT_OUTREACH_SETTINGS: OutreachSettings = {
  automationEnabled: false,
  // Deprecated. Stored for old rows and ignored by scheduling.
  activeDays: [...WEEKDAYS],
  activeStart: "09:00",
  activeEnd: "19:00",
  hourlyMinimum: 10,
  hourlyMaximum: 20,
  dailyMaximum: 150,
  minimumActionDelaySeconds: 180,
  schedulingSpreadSeconds: 360,
  claimLeaseSeconds: 300,
};

export const OUTREACH_SEQUENCE_VERSION = "outreach-v1";

export const RETRY_DELAY_MINUTES = [5, 15, 60] as const;

export const DEFAULT_MAX_ATTEMPTS = 3;

export function outreachIdempotencyKey(prospectId: string, jobType: string) {
  return `${prospectId}:${jobType}:${OUTREACH_SEQUENCE_VERSION}`;
}

export function normalizeClock(value: string | null | undefined, fallback: string) {
  const match = /^(\d{2}):(\d{2})/.exec(value ?? "");
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return fallback;
  return `${match[1]}:${match[2]}`;
}

export function normalizeDays(values: readonly string[] | null | undefined): Weekday[] {
  const days = (values ?? []).filter((value): value is Weekday =>
    WEEKDAYS.some((day) => day === value),
  );
  return days.length > 0 ? days : [...DEFAULT_OUTREACH_SETTINGS.activeDays];
}
