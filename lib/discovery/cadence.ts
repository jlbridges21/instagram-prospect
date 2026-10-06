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

export function formatElapsed(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatInspectionDelay(input: { now: number; dueAt: number; intervalMs: number; reason: string }) {
  const overdue = input.now - input.dueAt;
  if (overdue <= input.intervalMs * 2) return null;
  return ["Inspection delayed:", `reason: ${input.reason}`, `overdue by: ${formatElapsed(overdue)}`].join("\n");
}

export function discoveryGraceMs(intervalMs: number) {
  return Math.max(60_000, intervalMs * 3);
}

export function startDiscoveryCadence(input: { now: number; nextInspectionAt: number }) {
  if (input.nextInspectionAt > input.now) return { nextInspectionAt: input.nextInspectionAt, prompt: false };
  return { nextInspectionAt: input.now, prompt: true };
}

export function discoveryStallDecision(input: {
  now: number;
  nextInspectionAt: number;
  intervalMs: number;
  blocked: boolean;
  overdueSince: number;
  lastProgressAt?: number;
  sourcing?: boolean;
}) {
  if (input.blocked || input.sourcing || input.now < input.nextInspectionAt) {
    return { stalled: false, overdueSince: 0 };
  }
  const grace = discoveryGraceMs(input.intervalMs);
  const progressAt = input.lastProgressAt ?? 0;
  if (progressAt > 0 && input.now - progressAt < grace) {
    return { stalled: false, overdueSince: 0 };
  }
  const overdueSince = input.overdueSince > 0 ? input.overdueSince : input.now;
  const stalled = input.now > input.nextInspectionAt + grace && input.now >= overdueSince + grace;
  return { stalled, overdueSince };
}
