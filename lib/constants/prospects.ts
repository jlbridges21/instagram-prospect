export const PROSPECT_STATUSES = [
  "discovered",
  "qualified",
  "review",
  "approved",
  "contacted",
  "replied",
  "follow_up",
  "demo_booked",
  "converted",
  "skipped",
  "disqualified",
] as const;

export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

export const REVIEW_QUEUE_STATUSES = ["qualified", "review"] as const;

export type ReviewQueueStatus = (typeof REVIEW_QUEUE_STATUSES)[number];

export const FIT_LABELS = ["strong_fit", "possible_fit", "skip"] as const;

export type FitLabel = (typeof FIT_LABELS)[number];

export const PROSPECT_SOURCES = ["home_feed", "suggested_accounts", "manual", "seed_suggestion", "seed_network"] as const;

export type ProspectSource = (typeof PROSPECT_SOURCES)[number];

export const FOLLOW_UP_STATUSES = ["pending", "completed", "cancelled"] as const;

export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const ACTIVITY_EVENTS = [
  "prospect_discovered",
  "prospect_qualified",
  "prospect_approved",
  "prospect_skipped",
  "prospect_disqualified",
  "followed",
  "message_sent",
  "reply_detected",
  "follow_up_created",
  "follow_up_completed",
  "demo_booked",
  "converted",
  "worker_started",
  "worker_stopped",
  "worker_error",
  "outreach_queued",
  "outreach_cancelled",
  "outreach_requeued",
  "prospect_verified",
  "prospect_followed",
  "prospect_excluded_existing_follow",
  "worker_job_claimed",
  "worker_job_started",
  "worker_job_completed",
  "worker_job_failed",
  "automation_paused",
  "automation_resumed",
] as const;

export type ActivityEventType = (typeof ACTIVITY_EVENTS)[number];

export const STATUS_LABELS: Record<ProspectStatus, string> = {
  discovered: "Discovered",
  qualified: "Qualified",
  review: "In review",
  approved: "Approved",
  contacted: "Contacted",
  replied: "Replied",
  follow_up: "Follow-up",
  demo_booked: "Demo booked",
  converted: "Converted",
  skipped: "Skipped",
  disqualified: "Disqualified",
};

export const FIT_LABELS_TEXT: Record<FitLabel, string> = {
  strong_fit: "Strong Fit",
  possible_fit: "Possible Fit",
  skip: "Skip",
};

export const SOURCE_LABELS: Record<ProspectSource, string> = {
  home_feed: "Home feed",
  suggested_accounts: "Suggested accounts",
  manual: "Manual",
  seed_suggestion: "Seed suggestion",
  seed_network: "Seed network",
};

export const FOLLOW_UP_STATUS_LABELS: Record<FollowUpStatus, string> = {
  pending: "Pending",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const PROSPECT_SORTS = [
  "newest",
  "oldest",
  "fit",
  "fit_asc",
  "followers_desc",
  "followers_asc",
] as const;

export type ProspectSort = (typeof PROSPECT_SORTS)[number];

export const SORT_LABELS: Record<ProspectSort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  fit: "Highest fit",
  fit_asc: "Lowest fit",
  followers_desc: "Most followers",
  followers_asc: "Fewest followers",
};

export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export const PAGE_SIZE = 25;

export function pageSizeFromParam(value: string) {
  const parsed = Number.parseInt(value, 10);
  return PAGE_SIZE_OPTIONS.some((size) => size === parsed) ? parsed : PAGE_SIZE;
}

export function isProspectStatus(value: string): value is ProspectStatus {
  return PROSPECT_STATUSES.some((status) => status === value);
}

export function isFitLabel(value: string): value is FitLabel {
  return FIT_LABELS.some((label) => label === value);
}

export function isProspectSource(value: string): value is ProspectSource {
  return PROSPECT_SOURCES.some((source) => source === value);
}

export function isProspectSort(value: string): value is ProspectSort {
  return PROSPECT_SORTS.some((sort) => sort === value);
}

export function isReviewStatus(value: string): value is ReviewQueueStatus {
  return REVIEW_QUEUE_STATUSES.some((status) => status === value);
}
