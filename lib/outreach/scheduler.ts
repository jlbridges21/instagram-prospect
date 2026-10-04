import { nextProspectSlot } from "@/lib/outreach/pace";
import type { OutreachSettings } from "@/lib/outreach/types";

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
  return nextProspectSlot({
    now: input.now,
    timeZone: input.timeZone,
    minimumSpacingSeconds: input.settings.minimumActionDelaySeconds,
    hourlyMaximum: input.settings.hourlyMaximum,
    dailyMaximum: input.settings.dailyMaximum,
    completedSendTimes: input.occupied,
  }).at;
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


