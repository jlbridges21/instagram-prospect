import type { OutreachSettings } from "@/lib/outreach/types";
import {
  localDateKey,
  localHourKey,
  nextOpenInstant,
  parseClock,
  startOfNextLocalHour,
  zonedParts,
  zonedTimeToUtc,
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
  let candidate = nextOpenInstant(input.now, timeZone, settings);
  const latest = latestOccupied(input.occupied);
  if (latest) {
    const afterDelay = new Date(latest.getTime() + settings.minimumActionDelaySeconds * 1000);
    if (afterDelay.getTime() > candidate.getTime()) {
      candidate = nextOpenInstant(afterDelay, timeZone, settings);
    }
  }

  const jitter = jitterSeconds(input.seed, settings.schedulingSpreadSeconds);
  if (jitter > 0) {
    const jittered = new Date(candidate.getTime() + jitter * 1000);
    const snapped = nextOpenInstant(jittered, timeZone, settings);
    if (snapped.getTime() === jittered.getTime()) candidate = jittered;
  }

  for (let guard = 0; guard < 24 * 21; guard += 1) {
    candidate = nextOpenInstant(candidate, timeZone, settings);
    if (countOnDay(input.occupied, candidate, timeZone) >= settings.dailyMaximum) {
      candidate = nextDayStart(candidate, timeZone, settings);
      continue;
    }
    if (countInHour(input.occupied, candidate, timeZone) >= settings.hourlyMaximum) {
      candidate = nextOpenInstant(startOfNextLocalHour(candidate, timeZone), timeZone, settings);
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

  throw new Error("No open outreach window was found.");
}

export function nextPrepInstant(input: {
  now: Date;
  timeZone: string;
  settings: OutreachSettings;
  seed: string;
}) {
  const open = nextOpenInstant(input.now, input.timeZone, input.settings);
  const jitter = jitterSeconds(input.seed, Math.min(input.settings.schedulingSpreadSeconds, 120));
  const jittered = new Date(open.getTime() + jitter * 1000);
  const snapped = nextOpenInstant(jittered, input.timeZone, input.settings);
  return snapped.getTime() === jittered.getTime() ? jittered : open;
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

function nextDayStart(date: Date, timeZone: string, settings: OutreachSettings) {
  const parts = zonedParts(date, timeZone);
  const clock = parseClock(settings.activeEnd) ?? { hour: 19, minute: 0 };
  const end = zonedTimeToUtc(
    { year: parts.year, month: parts.month, day: parts.day, hour: clock.hour, minute: clock.minute },
    timeZone,
  );
  return nextOpenInstant(end, timeZone, settings);
}
