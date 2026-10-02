export type ProspectReasonFields = {
  qualification_reason?: string | null;
  qualification_error?: string | null;
  already_following?: boolean;
  already_contacted?: boolean;
  status?: string;
  ai_analyzed_at?: string | null;
  follow_relationship?: string | null;
};

export function prospectReason(prospect: ProspectReasonFields) {
  const stored = prospect.qualification_reason?.trim();
  if (stored) return stored;
  if (prospect.already_following) return "Already following this account.";
  if (prospect.already_contacted) return "This account has already been contacted.";
  if (prospect.status === "skipped") return "Skipped for outreach.";
  if (prospect.status === "disqualified") return "Excluded from outreach.";
  const error = prospect.qualification_error?.trim();
  if (error) return "AI analysis failed. Retry available.";
  if (!prospect.ai_analyzed_at) return "Awaiting analysis";
  return "No qualification reason stored.";
}

export function relationshipLabel(prospect: ProspectReasonFields) {
  if (prospect.follow_relationship === "requested") return "Requested";
  if (prospect.follow_relationship === "not_following") return "Not following";
  if (prospect.follow_relationship === "following" || prospect.already_following) return "Following";
  if (prospect.follow_relationship === "unknown") return "Unknown";
  const reason = prospect.qualification_reason?.trim() ?? "";
  if (/follow status unknown|could not be verified/i.test(reason)) return "Unknown";
  return "Unknown";
}

export function showProfilePhoto(src: string | null | undefined, failed: boolean) {
  return Boolean(src) && !failed;
}
