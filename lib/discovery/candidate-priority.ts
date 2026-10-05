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
}) {
  let score = input.source === "seed" ? 18 : input.source === "suggested_accounts" ? 8 : 2;
  const reasons: string[] = [];
  if (input.source === "seed" && input.seedUsername) {
    if (input.seedMature && (input.seedYield ?? 0) >= 0.2) {
      score += 16;
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
    score += 10;
    reasons.push("manual seed priority is high");
  } else if (input.seedPriority === "low") {
    score -= 8;
    reasons.push("manual seed priority is low");
  }
  const text = (input.text ?? "").toLowerCase();
  for (const keyword of input.positiveKeywords) {
    if (keywordMatches(text, keyword)) {
      score += 6;
      reasons.push(`matched “${keyword.trim()}”`);
    }
  }
  for (const keyword of input.negativeKeywords) {
    if (keywordMatches(text, keyword)) {
      score -= 8;
      reasons.push(`lowered by “${keyword.trim()}”`);
    }
  }
  return { score, label: priorityLabel(score), reasons };
}

export function priorityLabel(score: number): PriorityLabel {
  if (score >= 24) return "High";
  if (score >= 10) return "Medium";
  return "Low";
}

export function keywordMatches(text: string, keyword: string) {
  const needle = keyword.trim().toLowerCase();
  if (!needle || !text) return false;
  if (needle.includes(" ")) return text.toLowerCase().includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
}
