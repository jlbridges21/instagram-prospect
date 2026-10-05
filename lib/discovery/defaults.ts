export const DEFAULT_POSITIVE_KEYWORDS = [
  "drone",
  "aerial",
  "photography",
  "photographer",
  "real estate",
  "realestate",
  "media",
  "video",
  "videography",
  "videographer",
  "fpv",
  "uav",
  "aerial media",
  "property media",
  "real estate media",
  "content creator",
  "production",
] as const;

export const DEFAULT_DISCOVERY_OPTIMIZATION = {
  autoPromote: false,
  autoPromoteMinScore: 75,
  promoteStrong: true,
  promotePossible: false,
  promoteRequires: "review" as const,
  minSeedSample: 10,
  favorYield: true,
  yieldStrength: "medium" as const,
  homeFeedUsage: "low" as const,
  strategy: "balanced" as const,
  seedCooldownCycles: 2,
  seedNetworkEnabled: true,
  seedNetworkSample: 15,
};

export const DEFAULT_DISCOVERY_TUNING = {
  positiveKeywordBonus: 6,
  negativeKeywordPenalty: 8,
  manualPriorityLow: -16,
  manualPriorityNormal: 0,
  manualPriorityHigh: 16,
  recentUsePenalty: 10,
  explorationConservative: 15,
  explorationBalanced: 25,
  explorationExploratory: 40,
  homeFeedLow: 10,
  homeFeedMedium: 25,
  homeFeedHigh: 45,
  seedShareConservative: 85,
  seedShareBalanced: 70,
  seedShareExploratory: 50,
  yieldWeightLow: 12,
  yieldWeightMedium: 24,
  yieldWeightHigh: 40,
  highYieldCandidateBonus: 16,
  sourceBaseSeed: 18,
  sourceBaseSuggested: 8,
  sourceBaseHome: 2,
};

export type DiscoveryTuning = { [K in keyof typeof DEFAULT_DISCOVERY_TUNING]: number };

export const RANK_BASE = 20;
export const IMMATURE_YIELD = 0.5;
export const YIELD_ORIGIN = 0.2;
export const HIGH_YIELD_MINIMUM = 0.2;
export const PRIORITY_HIGH_AT = 24;
export const PRIORITY_MEDIUM_AT = 10;

const TUNING_LIMITS: Record<keyof DiscoveryTuning, { min: number; max: number }> = {
  positiveKeywordBonus: { min: 0, max: 100 },
  negativeKeywordPenalty: { min: 0, max: 100 },
  manualPriorityLow: { min: -200, max: 200 },
  manualPriorityNormal: { min: -200, max: 200 },
  manualPriorityHigh: { min: -200, max: 200 },
  recentUsePenalty: { min: 0, max: 100 },
  explorationConservative: { min: 0, max: 100 },
  explorationBalanced: { min: 0, max: 100 },
  explorationExploratory: { min: 0, max: 100 },
  homeFeedLow: { min: 0, max: 100 },
  homeFeedMedium: { min: 0, max: 100 },
  homeFeedHigh: { min: 0, max: 100 },
  seedShareConservative: { min: 0, max: 100 },
  seedShareBalanced: { min: 0, max: 100 },
  seedShareExploratory: { min: 0, max: 100 },
  yieldWeightLow: { min: 0, max: 200 },
  yieldWeightMedium: { min: 0, max: 200 },
  yieldWeightHigh: { min: 0, max: 200 },
  highYieldCandidateBonus: { min: 0, max: 100 },
  sourceBaseSeed: { min: 0, max: 100 },
  sourceBaseSuggested: { min: 0, max: 100 },
  sourceBaseHome: { min: 0, max: 100 },
};

export function clampTuning(input: unknown): DiscoveryTuning {
  const source = isRecord(input) ? input : {};
  const tuning = { ...DEFAULT_DISCOVERY_TUNING };
  for (const key of Object.keys(DEFAULT_DISCOVERY_TUNING) as Array<keyof DiscoveryTuning>) {
    const limits = TUNING_LIMITS[key];
    tuning[key] = clampTuningValue(source[key], limits.min, limits.max, DEFAULT_DISCOVERY_TUNING[key]);
  }
  return tuning;
}

export function recommendedTuning(): DiscoveryTuning {
  return clampTuning(DEFAULT_DISCOVERY_TUNING);
}

export function explorationPercent(strategy: "conservative" | "balanced" | "exploratory", tuning?: unknown) {
  const value = clampTuning(tuning);
  if (strategy === "conservative") return value.explorationConservative;
  if (strategy === "exploratory") return value.explorationExploratory;
  return value.explorationBalanced;
}

export function homeFeedPercent(usage: "low" | "medium" | "high", tuning?: unknown) {
  const value = clampTuning(tuning);
  if (usage === "high") return value.homeFeedHigh;
  if (usage === "medium") return value.homeFeedMedium;
  return value.homeFeedLow;
}

export function seedSharePercent(strategy: "conservative" | "balanced" | "exploratory", tuning?: unknown) {
  const value = clampTuning(tuning);
  if (strategy === "conservative") return value.seedShareConservative;
  if (strategy === "exploratory") return value.seedShareExploratory;
  return value.seedShareBalanced;
}

export function yieldWeight(strength: "low" | "medium" | "high", tuning?: unknown) {
  const value = clampTuning(tuning);
  if (strength === "high") return value.yieldWeightHigh;
  if (strength === "low") return value.yieldWeightLow;
  return value.yieldWeightMedium;
}

function clampTuningValue(value: unknown, min: number, max: number, fallback: number) {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
