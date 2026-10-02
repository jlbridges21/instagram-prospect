import type { FitLabel, ProspectStatus } from "@/lib/constants/prospects";
import type { Json } from "@/lib/db/types";
import type { TargetingSettings } from "@/lib/db/models";

const BLOCKED_STATUSES = [
  "contacted",
  "replied",
  "demo_booked",
  "converted",
  "skipped",
  "disqualified",
] as const satisfies readonly ProspectStatus[];

const HARD_EXCLUSIONS = new Set([
  "already_following",
  "already_contacted",
  "hobby",
  "meme",
  "unrelated_drone",
  "large_company",
  "non_english",
  "wrong_niche",
  "follower_range",
]);

export type EligibilityProspect = {
  status: ProspectStatus;
  already_following: boolean;
  already_contacted: boolean;
  fit_label: FitLabel | null;
  follower_count: number | null;
  ai_analysis: Json | null;
  outreach_cancelled_at?: string | null;
};

export function outreachBlockReason(
  prospect: EligibilityProspect,
  targeting: Pick<TargetingSettings, "minFollowers" | "maxFollowers">,
) {
  if (prospect.outreach_cancelled_at) return "outreach was cancelled";
  if (prospect.already_following) return "already following";
  if (prospect.already_contacted) return "already contacted";
  if (BLOCKED_STATUSES.some((status) => status === prospect.status)) {
    return `status is ${prospect.status.replaceAll("_", " ")}`;
  }
  if (prospect.fit_label === "skip") return "AI marked the prospect as skip";
  if (
    prospect.follower_count !== null &&
    prospect.follower_count < targeting.minFollowers
  ) {
    return "follower count is below the minimum";
  }
  if (
    prospect.follower_count !== null &&
    prospect.follower_count > targeting.maxFollowers
  ) {
    return "follower count is above the maximum";
  }

  const exclusion = exclusionReason(prospect.ai_analysis);
  if (exclusion) return exclusion;
  return null;
}

function exclusionReason(analysis: Json | null) {
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) return null;
  const reason = analysis.exclusion_reason;
  if (typeof reason !== "string" || !HARD_EXCLUSIONS.has(reason)) return null;
  return `excluded as ${reason.replaceAll("_", " ")}`;
}
