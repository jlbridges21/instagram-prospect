import { HIGH_YIELD_MINIMUM, PRIORITY_HIGH_AT, PRIORITY_MEDIUM_AT, clampTuning } from "@/lib/discovery/defaults";
import type { SeedPriority } from "@/lib/discovery/seeds";

export type PriorityLabel = "High" | "Medium" | "Low";

export function scoreCandidate(input: {
  source: "seed" | "suggested_accounts" | "home_feed";
  seedUsername?: string | null;
  seedYield?: number | null;
  seedMature?: boolean;
  seedPriority?: SeedPriority;
  text?: string | null;
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
  const text = (input.text ?? "").toLowerCase();
  for (const keyword of input.positiveKeywords) {
    if (keywordMatches(text, keyword)) {
      score += tuning.positiveKeywordBonus;
      reasons.push(`matched “${keyword.trim()}”`);
    }
  }
  for (const keyword of input.negativeKeywords) {
    if (keywordMatches(text, keyword)) {
      score -= tuning.negativeKeywordPenalty;
      reasons.push(`lowered by “${keyword.trim()}”`);
    }
  }
  return { score, label: priorityLabel(score), reasons };
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
