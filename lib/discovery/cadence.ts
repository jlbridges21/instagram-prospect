export function inspectionIntervalMs(profilesPerHour: number) {
  const rate = Math.max(1, Math.min(200, Math.round(profilesPerHour) || 1));
  return Math.round(3_600_000 / rate);
}

export function formatInspectionInterval(profilesPerHour: number) {
  const seconds = Math.round(inspectionIntervalMs(profilesPerHour) / 1000);
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  if (minutes > 0 && remain > 0) return `every ${minutes}m ${remain}s`;
  if (minutes > 0) return `every ${minutes}m`;
  return `every ${seconds}s`;
}

export function scheduleNextInspection(input: {
  now: number;
  intervalMs: number;
  previousNextAt: number | null;
  completedAt: number;
  minimumGapMs?: number;
}) {
  const interval = Math.max(1_000, input.intervalMs);
  const gap = input.minimumGapMs ?? Math.min(15_000, interval);
  const onCadence = (input.previousNextAt ?? input.completedAt) + interval;
  if (onCadence > input.completedAt + gap) return onCadence;
  return input.completedAt + interval;
}

export function discoveryDue(now: number, nextInspectionAt: number) {
  return now >= nextInspectionAt;
}
