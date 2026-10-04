import type { OutreachSettings } from "@/lib/outreach/types";
import type { Weekday } from "@/lib/outreach/types";

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: Weekday;
};

const WEEKDAY_FROM_SHORT: Record<string, Weekday> = {
  Sun: "sun",
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
};

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((item) => item.type === type)?.value ?? "";
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);

  let hour = Number(part(parts, "hour"));
  if (hour === 24) hour = 0;

  const weekday = WEEKDAY_FROM_SHORT[part(parts, "weekday")] ?? "mon";
  return {
    year: Number(part(parts, "year")),
    month: Number(part(parts, "month")),
    day: Number(part(parts, "day")),
    hour,
    minute: Number(part(parts, "minute")),
    second: Number(part(parts, "second")),
    weekday,
  };
}

export function zonedTimeToUtc(
  local: { year: number; month: number; day: number; hour: number; minute: number; second?: number },
  timeZone: string,
) {
  const guess = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second ?? 0,
  );

  const offsetAt = (instant: number) => {
    const seen = zonedParts(new Date(instant), timeZone);
    const seenUtc = Date.UTC(
      seen.year,
      seen.month - 1,
      seen.day,
      seen.hour,
      seen.minute,
      seen.second,
    );
    return seenUtc - instant;
  };

  const corrected = guess - offsetAt(guess);
  return new Date(guess - offsetAt(corrected));
}

export function addLocalDays(
  local: { year: number; month: number; day: number },
  days: number,
) {
  const shifted = new Date(Date.UTC(local.year, local.month - 1, local.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function localDateKey(date: Date, timeZone: string) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function localHourKey(date: Date, timeZone: string) {
  const parts = zonedParts(date, timeZone);
  return `${localDateKey(date, timeZone)}-${parts.hour}`;
}

export function parseClock(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function localInputToUtc(value: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return zonedTimeToUtc(
    {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4]),
      minute: Number(match[5]),
    },
    timeZone,
  );
}

export function formatLocalTime(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** @deprecated Operating hours were removed. This returns the same instant and does not block overnight work. */
export function nextOpenInstant(now: Date, _timeZone?: string, _settings?: OutreachSettings) {
  return new Date(now.getTime());
}

export function startOfNextLocalDay(date: Date, timeZone: string) {
  const parts = zonedParts(date, timeZone);
  const next = addLocalDays(parts, 1);
  return zonedTimeToUtc({ year: next.year, month: next.month, day: next.day, hour: 0, minute: 0 }, timeZone);
}

export function startOfNextLocalHour(date: Date, timeZone: string) {
  const parts = zonedParts(date, timeZone);
  if (parts.hour >= 23) {
    const next = addLocalDays(parts, 1);
    return zonedTimeToUtc(
      { year: next.year, month: next.month, day: next.day, hour: 0, minute: 0 },
      timeZone,
    );
  }
  return zonedTimeToUtc(
    { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour + 1, minute: 0 },
    timeZone,
  );
}
