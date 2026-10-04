import type { OutreachSettings } from "@/lib/outreach/types";
import {
  localDateKey,
  localHourKey,
  startOfNextLocalDay,
  startOfNextLocalHour,
} from "@/lib/outreach/time";

export function jitterSeconds(seed: string, spreadSeconds: number) {
  if (spreadSeconds <= 0) return 0;
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % (spreadSeconds + 1);
}

export function nextSendInstant(input: {
  now: Date;
  timeZone: string;
  settings: OutreachSettings;
  occupied: Date[];
  seed: string;
}) {
  const { timeZone, settings } = input;
  let candidate = new Date(input.now.getTime());
  const latest = latestOccupied(input.occupied);
  if (latest) {
    const afterDelay = new Date(latest.getTime() + settings.minimumActionDelaySeconds * 1000);
    if (afterDelay.getTime() > candidate.getTime()) candidate = afterDelay;
  }

  const jitter = jitterSeconds(input.seed, settings.schedulingSpreadSeconds);
  if (jitter > 0) candidate = new Date(candidate.getTime() + jitter * 1000);

  for (let guard = 0; guard < 24 * 21; guard += 1) {
    if (countOnDay(input.occupied, candidate, timeZone) >= settings.dailyMaximum) {
      candidate = startOfNextLocalDay(candidate, timeZone);
      continue;
    }
    if (countInHour(input.occupied, candidate, timeZone) >= settings.hourlyMaximum) {
      candidate = startOfNextLocalHour(candidate, timeZone);
      continue;
    }
    const prior = latestAtOrBefore(input.occupied, candidate);
    if (prior) {
      const earliest = prior.getTime() + settings.minimumActionDelaySeconds * 1000;
      if (candidate.getTime() < earliest) {
        candidate = new Date(earliest);
        continue;
      }
    }
    return candidate;
  }

  throw new Error("No outreach time satisfied the hourly, daily, and spacing limits.");
}

export function nextPrepInstant(input: {
  now: Date;
  timeZone: string;
  settings: OutreachSettings;
  seed: string;
}) {
  const jitter = jitterSeconds(input.seed, Math.min(input.settings.schedulingSpreadSeconds, 120));
  return new Date(input.now.getTime() + jitter * 1000);
}

function latestOccupied(occupied: Date[]) {
  return occupied.reduce<Date | null>((latest, value) => {
    if (!latest || value.getTime() > latest.getTime()) return value;
    return latest;
  }, null);
}

function latestAtOrBefore(occupied: Date[], candidate: Date) {
  return occupied.reduce<Date | null>((latest, value) => {
    if (value.getTime() > candidate.getTime()) return latest;
    if (!latest || value.getTime() > latest.getTime()) return value;
    return latest;
  }, null);
}

function countOnDay(occupied: Date[], candidate: Date, timeZone: string) {
  const key = localDateKey(candidate, timeZone);
  return occupied.filter((value) => localDateKey(value, timeZone) === key).length;
}

function countInHour(occupied: Date[], candidate: Date, timeZone: string) {
  const key = localHourKey(candidate, timeZone);
  return occupied.filter((value) => localHourKey(value, timeZone) === key).length;
}

