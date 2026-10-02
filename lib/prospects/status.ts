import {
  STATUS_LABELS,
  type ProspectStatus,
} from "@/lib/constants/prospects";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export const STATUS_TONE: Record<ProspectStatus, StatusTone> = {
  discovered: "neutral",
  qualified: "info",
  review: "warning",
  approved: "info",
  contacted: "info",
  replied: "success",
  follow_up: "warning",
  demo_booked: "info",
  converted: "success",
  skipped: "neutral",
  disqualified: "danger",
};

export const STATUS_MEANING: Record<ProspectStatus, string> = {
  discovered: "Profile has been recorded.",
  qualified: "Matches targeting criteria.",
  review: "Waiting for a decision.",
  approved: "Approved for outreach. No message has been sent.",
  contacted: "A message has been sent.",
  replied: "A reply was recorded.",
  follow_up: "A follow-up is in progress.",
  demo_booked: "A demo has been booked.",
  converted: "The prospect converted.",
  skipped: "Skipped for outreach.",
  disqualified: "Does not match targeting.",
};

const APPROVE_FROM = ["qualified", "review"] as const satisfies readonly ProspectStatus[];
const SKIP_FROM = ["discovered", "qualified", "review", "approved"] as const satisfies readonly ProspectStatus[];

export function canApprove(status: ProspectStatus) {
  return APPROVE_FROM.some((value) => value === status);
}

export function canSkip(status: ProspectStatus) {
  return SKIP_FROM.some((value) => value === status);
}

export function statusLabel(status: ProspectStatus) {
  return STATUS_LABELS[status];
}

export const ALLOWED_TRANSITIONS: Record<ProspectStatus, readonly ProspectStatus[]> = {
  discovered: ["qualified", "review", "skipped", "disqualified"],
  qualified: ["review", "approved", "skipped", "disqualified"],
  review: ["approved", "skipped", "disqualified"],
  approved: ["contacted", "skipped"],
  contacted: ["replied", "follow_up"],
  replied: ["follow_up", "demo_booked", "converted"],
  follow_up: ["replied", "demo_booked", "converted"],
  demo_booked: ["converted"],
  converted: [],
  skipped: ["review"],
  disqualified: [],
};
