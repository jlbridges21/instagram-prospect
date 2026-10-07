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
  if (input.pending <= lowWater) return { acquire: true, holding: false, reason: null };
  return { acquire: false, holding: true, reason: "high_water" as const };
}

export function queueThresholds(target: number) {
  const highWater = Math.max(1, target);
  const lowWater = Math.max(1, Math.min(highWater, Math.round(highWater * 0.375)));
  return { highWater, lowWater };
}

export function poolCollectionDecision(input: { size: number; lowWater: number; highWater: number }) {
  if (input.size >= input.highWater) return { collect: false as const, reason: "high_water" as const };
  if (input.size < input.lowWater) return { collect: true as const, reason: "low_water" as const };
  return { collect: true as const, reason: "below_target" as const };
}

export const REFILL_PASS_LIMIT = 4;
export const REFILL_BUDGET_MS = 90_000;

export type PoolCensus = {
  total: number;
  ranked: number;
  explorationEligible: number;
  deferred: number;
  highest: number | null;
};

export function censusFromScores(scores: number[], floor: number, explorationFloor: number): PoolCensus {
  let ranked = 0;
  let explorationEligible = 0;
  let deferred = 0;
  let highest: number | null = null;
  for (const score of scores) {
    if (highest == null || score > highest) highest = score;
    if (score >= floor) ranked += 1;
    else if (score >= explorationFloor) explorationEligible += 1;
    else deferred += 1;
  }
  return { total: scores.length, ranked, explorationEligible, deferred, highest };
}

export type RefillAction = "inspect_ranked" | "inspect_starvation" | "refill" | "yield_for_slot" | "wait";

export function candidateRefillDecision(input: {
  census: PoolCensus;
  lowWater: number;
  explore: boolean;
  allowInspect: boolean;
  passes: number;
  maxPasses?: number;
  consecutiveEmptyPasses?: number;
  elapsedMs?: number;
  budgetMs?: number;
  slotDue?: boolean;
  fallbackCeiling?: number;
  lookaheadBudgetMs?: number;
}): RefillAction {
  const maxPasses = input.maxPasses ?? REFILL_PASS_LIMIT;
  const overBudget = (input.elapsedMs ?? 0) >= (input.budgetMs ?? REFILL_BUDGET_MS);
  const exhausted = input.passes >= maxPasses || (input.consecutiveEmptyPasses ?? 0) >= 2 || overBudget;
  const starved = input.census.ranked < input.lowWater;
  const ceiling = input.fallbackCeiling ?? 24;
  const lookaheadExhausted = input.passes >= maxPasses || (input.consecutiveEmptyPasses ?? 0) >= 2 || (input.elapsedMs ?? 0) >= (input.lookaheadBudgetMs ?? 40_000);
  const fallbackOnly = input.census.ranked > 0 && (input.census.highest ?? 0) <= ceiling;
  if (!input.allowInspect && input.slotDue) return "yield_for_slot";
  if (input.allowInspect && input.census.ranked > 0 && fallbackOnly && !lookaheadExhausted) return "refill";
  if (input.allowInspect && input.census.ranked > 0) return "inspect_ranked";
  if (starved && !exhausted) return "refill";
  if (input.allowInspect && input.census.ranked === 0 && input.census.explorationEligible > 0) return "inspect_starvation";
  return "wait";
}

export type DiscoveryRuntimeConfig = {
  profilesPerHour: number;
  minimumPreScore: number;
  explorationFloor: number;
  strategy: string;
  poolTarget: number;
  lowWater: number;
};

function strategyLabel(strategy: string) {
  if (strategy === "conservative") return "Conservative";
  if (strategy === "exploratory") return "Exploratory";
  return "Balanced";
}

export function formatDiscoveryConfig(config: DiscoveryRuntimeConfig) {
  return [
    "Discovery config:",
    `profiles/hour: ${config.profilesPerHour}`,
    `minimum pre-score: ${config.minimumPreScore}`,
    `exploration floor: ${config.explorationFloor}`,
    `strategy: ${strategyLabel(config.strategy)}`,
    `pool target: ${config.poolTarget}`,
    `low water: ${config.lowWater}`,
  ].join("\n");
}

export function discoveryConfigUpdates(previous: DiscoveryRuntimeConfig, next: DiscoveryRuntimeConfig) {
  const fields: Array<[string, keyof DiscoveryRuntimeConfig]> = [
    ["profiles/hour", "profilesPerHour"],
    ["minimum pre-score", "minimumPreScore"],
    ["exploration floor", "explorationFloor"],
    ["strategy", "strategy"],
    ["pool target", "poolTarget"],
    ["low water", "lowWater"],
  ];
  const lines = fields.flatMap(([label, key]) => {
    const before = key === "strategy" ? strategyLabel(String(previous[key])) : previous[key];
    const after = key === "strategy" ? strategyLabel(String(next[key])) : next[key];
    return before === after ? [] : [`${label} ${before} → ${after}`];
  });
  if (lines.length === 0) return null;
  return ["Discovery config updated:", ...lines].join("\n");
}

export function formatRefillComplete(input: { census: PoolCensus; floor: number; selection: "starvation fallback" | "wait" }) {
  return [
    "Refill complete.",
    "Pool:",
    `${input.census.total} total`,
    `${input.census.ranked} ranked`,
    `${input.census.explorationEligible} exploration eligible`,
    `${input.census.deferred} deferred`,
    "Highest pre-score:",
    input.census.highest == null ? "none" : String(input.census.highest),
    `No candidate reached normal floor ${input.floor}.`,
    "Selection:",
    input.selection,
  ].join("\n");
}

export function poolStatusLine(census: PoolCensus) {
  return `${census.total} total · ${census.ranked} ranked · ${census.explorationEligible} exploration eligible`;
}

export function logOnTransition(previous: string, next: string) {
  return { log: previous !== next, state: next };
}

export function rollingHourInspectionCount(stamps: number[], now: number) {
  return hourlyInspectionPace({ stamps, now, limit: Number.MAX_SAFE_INTEGER }).count;
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
