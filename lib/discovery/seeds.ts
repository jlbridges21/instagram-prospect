import { IMMATURE_YIELD, RANK_BASE, YIELD_ORIGIN, clampTuning, explorationPercent, yieldWeight } from "@/lib/discovery/defaults";

export type SeedSourceType = "manual" | "auto_promoted" | "system_imported";
export type SeedPriority = "low" | "normal" | "high";
export type DiscoveryStrategy = "conservative" | "balanced" | "exploratory";
export type YieldStrength = "low" | "medium" | "high";

export type RankableSeed = {
  id: string;
  username: string;
  sourceType: SeedSourceType;
  active: boolean;
  priority: SeedPriority;
  inspected: number;
  review: number;
  consecutiveUses: number;
  cooldownUntil?: string | null;
};

const RESERVED = new Set(["explore", "reels", "p", "reel", "stories", "direct", "accounts", "about", "legal"]);

export function normalizeSeedUsername(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : trimmed.includes("instagram.com") ? `https://${trimmed.replace(/^\/\//, "")}` : "";
    if (withProtocol) {
      const path = new URL(withProtocol).pathname.split("/").filter(Boolean)[0] ?? "";
      return clean(path);
    }
  } catch {
    return "";
  }
  return clean(trimmed.replace(/^@/, "").split(/[/?#]/)[0] ?? "");
}

export function seedStatForCandidate(event: "duplicate_skipped" | "inspected" | "queued") {
  if (event === "duplicate_skipped") return { inspected: 0, duplicates: 1, discovered: 0 };
  if (event === "inspected") return { inspected: 1, duplicates: 0, discovered: 0 };
  return { inspected: 0, duplicates: 0, discovered: 1 };
}

export function seedCollectionResult(input: { seedId: string; seedUsername: string; usernames: string[] }) {
  const owner = input.seedUsername.replace(/^@/, "").trim().toLowerCase();
  const usable = [...new Set(input.usernames.map((name) => name.replace(/^@/, "").trim().toLowerCase()).filter((name) => name && name !== owner))];
  if (usable.length === 0) return { fallback: true as const, candidates: [] as const };
  return {
    fallback: false as const,
    candidates: usable.map((username) => ({
      username,
      source: "seed_suggestion" as const,
      sourceSeedId: input.seedId,
      sourceSeedUsername: owner,
    })),
  };
}

export function inspectionSeedId(candidate: { source: string; sourceSeedId?: string | null }) {
  if (candidate.source !== "seed_suggestion") return null;
  const id = candidate.sourceSeedId?.trim();
  return id || null;
}

export function prospectAttribution(candidate: {
  source: string;
  sourceSeedId?: string | null;
  sourceSeedUsername?: string | null;
  priorityLabel?: string | null;
  priorityReasons?: string[] | null;
}) {
  return {
    source: candidate.source,
    source_seed_id: candidate.sourceSeedId ?? null,
    source_seed_username: candidate.sourceSeedUsername ?? null,
    discovery_priority_label: candidate.priorityLabel ?? null,
    discovery_priority_reason: candidate.priorityReasons?.length ? candidate.priorityReasons.join(" · ") : null,
  };
}

export function uniqueSeedUsernames(raw: string) {
  return [...new Set(raw.split(/\s+/).map(normalizeSeedUsername).filter(Boolean))];
}

export function reviewYield(inspected: number, review: number) {
  if (inspected <= 0) return 0;
  return review / inspected;
}

export function approvalYield(inspected: number, approved: number) {
  if (inspected <= 0) return 0;
  return approved / inspected;
}

export function seedIsCooling(seed: RankableSeed, now: Date) {
  if (!seed.cooldownUntil) return false;
  return new Date(seed.cooldownUntil).getTime() > now.getTime();
}

export function seedRank(seed: RankableSeed, input: { minSample: number; favorYield: boolean; yieldStrength: YieldStrength; tuning?: unknown }) {
  const mature = seed.inspected >= Math.max(1, input.minSample);
  const yieldRate = mature ? reviewYield(seed.inspected, seed.review) : IMMATURE_YIELD;
  const bonus = yieldWeight(input.yieldStrength, input.tuning);
  const yieldBonus = input.favorYield && mature ? (yieldRate - YIELD_ORIGIN) * bonus : 0;
  const manual = manualPriorityValue(seed.priority, input.tuning);
  const repeatPenalty = seed.consecutiveUses * recentUsePenalty(input.tuning);
  return { score: RANK_BASE + yieldBonus + manual - repeatPenalty, mature, yieldRate };
}

export function pickSeed(input: {
  seeds: RankableSeed[];
  minSample: number;
  favorYield: boolean;
  yieldStrength: YieldStrength;
  strategy: DiscoveryStrategy;
  cooldownCycles: number;
  now: Date;
  random: () => number;
  tuning?: unknown;
}) {
  const available = input.seeds.filter((seed) => seed.active && !seedIsCooling(seed, input.now));
  if (available.length === 0) return null;
  const exploreRate = explorationPercent(input.strategy, input.tuning) / 100;
  const fresh = available.filter((seed) => seed.inspected < input.minSample);
  const proven = available.filter((seed) => seed.inspected >= input.minSample);
  const explore = input.random() < exploreRate && fresh.length > 0;
  const pool = explore || proven.length === 0 ? fresh : proven;
  const cooled = pool.filter((seed) => seed.consecutiveUses < input.cooldownCycles);
  const choices = cooled.length > 0 ? cooled : pool;
  return weightedPick(choices, (seed) => Math.max(1, seedRank(seed, input).score), input.random());
}

export function shouldAutoPromote(input: {
  enabled: boolean;
  qualified: boolean;
  fitScore: number | null;
  fitLabel: string | null;
  minScore: number;
  promoteStrong: boolean;
  promotePossible: boolean;
  requiresApproved: boolean;
  approved: boolean;
  disqualified: boolean;
  alreadyFollowing: boolean;
}) {
  if (!input.enabled || input.disqualified || !input.qualified) return false;
  if (input.alreadyFollowing) return false;
  if (input.requiresApproved && !input.approved) return false;
  if ((input.fitScore ?? 0) < input.minScore) return false;
  if (input.fitLabel === "strong_fit" && input.promoteStrong) return true;
  if (input.fitLabel === "possible_fit" && input.promotePossible) return true;
  return false;
}

function manualPriorityValue(priority: SeedPriority, tuning: unknown) {
  const value = clampTuning(tuning);
  if (priority === "high") return value.manualPriorityHigh;
  if (priority === "low") return value.manualPriorityLow;
  return value.manualPriorityNormal;
}

function recentUsePenalty(tuning: unknown) {
  return clampTuning(tuning).recentUsePenalty;
}

function weightedPick<T>(items: T[], weight: (item: T) => number, random: number) {
  const weights = items.map((item) => weight(item));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let roll = Math.min(0.999999, Math.max(0, random)) * total;
  for (let index = 0; index < items.length; index += 1) {
    roll -= weights[index] ?? 0;
    if (roll <= 0) return items[index] ?? null;
  }
  return items[items.length - 1] ?? null;
}

function clean(value: string) {
  const name = value.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(name) || RESERVED.has(name)) return "";
  return name;
}
