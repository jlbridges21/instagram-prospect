export const HOURLY_WINDOW_MS = 60 * 60 * 1000;

export type DiscoveryHourlyState = {
  stamps: number[];
  count: number;
  limit: number;
  limited: boolean;
  nextEligibleAt: number | null;
};

export function getDiscoveryHourlyState(input: { stamps: number[]; now: number; limit: number; windowMs?: number }): DiscoveryHourlyState {
  const pace = hourlyInspectionPace(input);
  return {
    stamps: pace.active,
    count: pace.count,
    limit: pace.limit,
    limited: pace.full,
    nextEligibleAt: pace.resumesAt,
  };
}

export function reserveInspectionSlot(input: { stamps: number[]; now: number; limit: number; windowMs?: number }) {
  const current = getDiscoveryHourlyState(input);
  if (current.limited) return { ok: false as const, state: current };
  const state = getDiscoveryHourlyState({ ...input, stamps: [...current.stamps, input.now] });
  return { ok: true as const, state, reservedAt: input.now };
}

export function releaseInspectionSlot(stamps: number[], reservedAt: number) {
  const index = stamps.lastIndexOf(reservedAt);
  if (index < 0) return stamps;
  return stamps.filter((_, stampIndex) => stampIndex !== index);
}

export function hourlyActual(input: { enabled: boolean; limited: boolean }) {
  if (!input.enabled) return "PAUSED" as const;
  return input.limited ? "WAITING" as const : "RUNNING" as const;
}

export function hourlyInspectionPace(input: { stamps: number[]; now: number; limit: number; windowMs?: number }) {
  const windowMs = input.windowMs ?? HOURLY_WINDOW_MS;
  const limit = Math.max(1, input.limit);
  const active = input.stamps.filter((stamp) => stamp <= input.now && input.now - stamp < windowMs);
  const full = active.length >= limit;
  const oldest = active.length > 0 ? Math.min(...active) : null;
  return {
    active,
    count: active.length,
    limit,
    full,
    resumesAt: full && oldest != null ? oldest + windowMs : null,
  };
}

export function hourlyWaitMs(resumesAt: number | null, now: number) {
  if (resumesAt == null) return 15_000;
  return Math.max(1_000, Math.min(15_000, resumesAt - now));
}

export function formatHourlyWait(input: { count: number; limit: number; resumesAt: number; timeZone?: string }) {
  const iso = new Date(input.resumesAt).toISOString();
  const when = input.timeZone
    ? formatResumeClock(iso, input.timeZone)
    : new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(input.resumesAt));
  return [
    "Discovery waiting.",
    `Hourly profile inspection pace reached: ${input.count} / ${input.limit}.`,
    `Next profile slot opens at ${when}.`,
  ].join("\n");
}

export function formatHourlyWaitEvent(input: { count: number; limit: number; resumesAt: number }) {
  return `Discovery hourly wait | count=${input.count} | limit=${input.limit} | resumes=${new Date(input.resumesAt).toISOString()}`;
}

export function parseHourlyWaitEvent(value: string | null | undefined) {
  if (!value?.startsWith("Discovery hourly wait |")) return null;
  const parts = Object.fromEntries(
    value
      .split("|")
      .slice(1)
      .map((part) => part.trim().split("="))
      .filter((pair) => pair.length === 2),
  );
  const count = Number(parts.count);
  const limit = Number(parts.limit);
  if (!Number.isFinite(count) || !Number.isFinite(limit) || !parts.resumes) return null;
  return { count, limit, resumesAt: parts.resumes };
}

export function formatResumeClock(iso: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(iso));
  }
}

export function acquisitionDecision(input: {
  pending: number;
  highWater: number;
  lowWater: number;
  holding: boolean;
  hourlyFull: boolean;
}) {
  if (input.hourlyFull) return { acquire: false, holding: true, reason: "hourly_pace" as const };
  const highWater = Math.max(1, input.highWater);
  const lowWater = Math.min(highWater, Math.max(1, input.lowWater));
  if (input.holding) {
    if (input.pending <= lowWater) return { acquire: true, holding: false, reason: null };
    return { acquire: false, holding: true, reason: "high_water" as const };
  }
  if (input.pending >= highWater) return { acquire: false, holding: true, reason: "high_water" as const };
  return { acquire: true, holding: false, reason: null };
}

export function queueThresholds(target: number) {
  const highWater = Math.max(1, target);
  return { highWater, lowWater: Math.max(1, Math.floor(highWater / 2)) };
}

export function formatWorkerModes(input: { discovery: "RUNNING" | "PAUSED" | "WAITING"; outreach: "RUNNING" | "PAUSED" }) {
  const discovery = input.discovery === "WAITING" ? "Discovery: WAITING — hourly pace" : `Discovery: ${input.discovery}`;
  return `${discovery}\nOutreach: ${input.outreach}`;
}

export function checkpointHoldDecision() {
  return {
    claimOutreach: false,
    inspectProfiles: false,
    collectCandidates: false,
    databaseTogglesChanged: false,
    log: [
      "Instagram checkpoint.",
      "Browser automation is paused.",
      "Discovery database toggle was not changed.",
      "Outreach database toggle was not changed.",
      "No follow, message, or profile inspection will run until the checkpoint is resolved in the browser.",
    ].join("\n"),
  };
}
