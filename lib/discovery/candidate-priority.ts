import { HIGH_YIELD_MINIMUM, PRIORITY_HIGH_AT, PRIORITY_MEDIUM_AT, candidateExplorationPercent, clampTuning } from "@/lib/discovery/defaults";
import type { SeedPriority } from "@/lib/discovery/seeds";

export type PriorityLabel = "High" | "Medium" | "Low";

const POSITIVE_HIT_CAP = 8;
const NEGATIVE_HIT_CAP = 6;
const COMMERCIAL_HIT_CAP = 6;
const SOURCE_PRIOR_CAP = 8;

const COMMERCIAL_INTENT_TERMS = [
  "services",
  "service",
  "book",
  "booking",
  "clients",
  "client",
  "commercial",
  "production",
  "agency",
  "studio",
  "licensed",
  "portfolio",
  "work with us",
  "contact",
  "business",
  "cinematographer",
  "cinematography",
  "media",
  "real estate",
  "property",
] as const;

export function scoreCandidate(input: {
  source: "seed" | "suggested_accounts" | "home_feed";
  sourceDetail?: "seed_network" | "seed_suggestion" | "suggested_accounts" | "home_feed" | null;
  seedUsername?: string | null;
  seedYield?: number | null;
  seedMature?: boolean;
  seedPriority?: SeedPriority;
  seedSupportCount?: number;
  supportYields?: number[];
  sourceReviewYield?: number | null;
  username?: string | null;
  text?: string | null;
  cardText?: string | null;
  positiveKeywords: string[];
  negativeKeywords: string[];
  tuning?: unknown;
}) {
  const tuning = clampTuning(input.tuning);
  let score = input.source === "seed" ? tuning.sourceBaseSeed : input.source === "suggested_accounts" ? tuning.sourceBaseSuggested : tuning.sourceBaseHome;
  const reasons: string[] = [];
  if (input.source === "seed" && input.seedUsername) {
    if (input.seedMature && (input.seedYield ?? 0) >= HIGH_YIELD_MINIMUM) {
      score += tuning.highYieldCandidateBonus;
      reasons.push(`from high-yield seed @${input.seedUsername}`);
    } else {
      reasons.push(`from seed @${input.seedUsername}`);
    }
    if (input.sourceDetail === "seed_network") reasons.push("+ seed network");
    if (input.sourceDetail === "seed_suggestion") reasons.push("+ seed suggestion");
  } else if (input.source === "suggested_accounts") {
    reasons.push("from Suggested Accounts");
  } else {
    reasons.push("from Home Feed");
  }
  if (input.seedPriority === "high") {
    score += tuning.manualPriorityHigh;
    reasons.push("manual seed priority is high");
  } else if (input.seedPriority === "low") {
    score += tuning.manualPriorityLow;
    reasons.push("manual seed priority is low");
  } else if (input.seedPriority === "normal") {
    score += tuning.manualPriorityNormal;
  }
  const corpus = [input.username, input.text, input.cardText].filter(Boolean).join("\n");
  let positiveHits = 0;
  for (const keyword of input.positiveKeywords) {
    if (positiveHits >= POSITIVE_HIT_CAP) break;
    if (!keywordHit(corpus, keyword)) continue;
    positiveHits += 1;
    score += tuning.positiveKeywordBonus;
    reasons.push(`+ ${keyword.trim()}`);
  }
  let negativeHits = 0;
  for (const keyword of input.negativeKeywords) {
    if (negativeHits >= NEGATIVE_HIT_CAP) break;
    if (!keywordHit(corpus, keyword)) continue;
    negativeHits += 1;
    score -= tuning.negativeKeywordPenalty;
    reasons.push(`- ${keyword.trim()}`);
  }
  const support = Math.max(0, input.seedSupportCount ?? 0);
  const extraSeeds = Math.max(0, support - 1);
  if (extraSeeds > 0) {
    score += extraSeeds * tuning.multiSeedBonus;
    reasons.push(`+ ${support} seed matches`);
  }
  const matureSupport = (input.supportYields ?? []).filter((rate) => rate >= HIGH_YIELD_MINIMUM).length;
  if (matureSupport > 0) {
    const supportBonus = Math.min(tuning.multiSeedBonus, matureSupport * Math.round(tuning.networkConfidenceWeight / 2));
    score += supportBonus;
    reasons.push(`+ high-yield seed support`);
  }
  let commercialHits = 0;
  for (const term of COMMERCIAL_INTENT_TERMS) {
    if (commercialHits >= COMMERCIAL_HIT_CAP) break;
    if (!keywordMatches(corpus, term)) continue;
    commercialHits += 1;
    score += tuning.commercialIntentWeight;
    reasons.push(`+ commercial ${term}`);
  }
  if (typeof input.sourceReviewYield === "number") {
    const prior = Math.max(-SOURCE_PRIOR_CAP, Math.min(SOURCE_PRIOR_CAP, Math.round((input.sourceReviewYield - 0.2) * tuning.sourceYieldWeight)));
    if (prior !== 0) {
      score += prior;
      reasons.push(`source yield prior ${prior > 0 ? "+" : ""}${prior}`);
    }
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const niche = positiveHits === 0 ? 0 : Math.max(0, Math.min(100, 40 + positiveHits * 15));
  const commercial = commercialHits === 0 ? 8 : Math.max(0, Math.min(100, 25 + commercialHits * 18));
  const networkRaw = (input.source === "seed" ? tuning.sourceBaseSeed : input.source === "suggested_accounts" ? tuning.sourceBaseSuggested : tuning.sourceBaseHome)
    + extraSeeds * tuning.multiSeedBonus
    + (input.seedMature && (input.seedYield ?? 0) >= HIGH_YIELD_MINIMUM ? tuning.highYieldCandidateBonus : 0);
  const network = Math.max(0, Math.min(100, networkRaw));
  reasons.unshift(`Network confidence: ${network}`, `Commercial intent: ${commercial}`, `Niche relevance: ${niche}`);
  return { score, label: priorityLabel(score), reasons, niche, commercial, network };
}

export function pickWeightedIndex(weights: number[], random: number) {
  const total = weights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  if (total <= 0) return 0;
  let roll = Math.min(0.999999, Math.max(0, random)) * total;
  for (let index = 0; index < weights.length; index += 1) {
    roll -= Math.max(0, weights[index] ?? 0);
    if (roll < 0) return index;
  }
  return Math.max(0, weights.length - 1);
}

export function clampCandidateFloor(value: number) {
  if (!Number.isFinite(value)) return 18;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function shouldExploreCandidate(
  strategy: "conservative" | "balanced" | "exploratory",
  random: number,
  tuning?: unknown,
) {
  return random < candidateExplorationPercent(strategy, tuning) / 100;
}

export function rememberExplorationDecision(input: {
  previous: { slot: number; explore: boolean } | null;
  slot: number;
  strategy: "conservative" | "balanced" | "exploratory";
  random: number;
  tuning?: unknown;
}) {
  if (input.previous && input.previous.slot === input.slot) return input.previous;
  return { slot: input.slot, explore: shouldExploreCandidate(input.strategy, input.random, input.tuning) };
}

export function priorityLabel(score: number): PriorityLabel {
  if (score >= PRIORITY_HIGH_AT) return "High";
  if (score >= PRIORITY_MEDIUM_AT) return "Medium";
  return "Low";
}

export function keywordMatches(text: string, keyword: string) {
  const needle = keyword.trim().toLowerCase();
  if (!needle || !text) return false;
  if (needle.includes(" ")) return text.toLowerCase().includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}

function keywordHit(text: string, keyword: string) {
  if (keywordMatches(text, keyword)) return true;
  const needle = keyword.trim().toLowerCase();
  return needle.length >= 4 && text.toLowerCase().includes(needle);
}
