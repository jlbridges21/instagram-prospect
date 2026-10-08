export const PREVIOUS_FOLLOW_NOT_CONFIRMED = "Previous Follow attempt did not result in a confirmed relationship.";
export const FOLLOW_RESTRICTION_MESSAGE = "Outreach paused — Instagram Follow action restricted";
export const FOLLOW_DIAGNOSTIC_DELAYS_MS = [0, 250, 750, 1_500, 3_000, 5_000, 8_000];

export function prepareFollowClick(input: {
  expectedUsername: string;
  currentUsername: string | null;
  label: string | null;
  box: { x: number; y: number; width: number; height: number } | null;
}) {
  if (!input.currentUsername || input.currentUsername.toLowerCase() !== input.expectedUsername.toLowerCase()) {
    return { click: false as const, reason: "username_mismatch" as const };
  }
  if (input.label !== "Follow" && input.label !== "Follow Back") {
    return { click: false as const, reason: "not_follow_control" as const };
  }
  if (!input.box || input.box.width < 8 || input.box.height < 8) {
    return { click: false as const, reason: "missing_box" as const };
  }
  return { click: true as const, reason: "fresh_control" as const, box: input.box };
}

export function followClickSettlement(input: {
  dispatched: boolean;
  relationship: string;
  restriction: boolean;
}) {
  if (input.restriction) {
    return { state: "restricted" as const, confirmed: false, recordClick: input.dispatched, pauseOutreach: true };
  }
  if (!input.dispatched) {
    return { state: "not_dispatched" as const, confirmed: false, recordClick: false, pauseOutreach: false };
  }
  if (input.relationship === "following" || input.relationship === "requested") {
    return { state: "follow_confirmed" as const, confirmed: true, recordClick: true, pauseOutreach: false };
  }
  return { state: "follow_not_confirmed" as const, confirmed: false, recordClick: true, pauseOutreach: false };
}

export function diagnosticFollowPlan(input: { relationship: string; alreadyClicked: boolean }) {
  if (input.alreadyClicked) return { click: false as const, send: false as const, reason: "already_clicked" as const };
  if (input.relationship !== "not_following") return { click: false as const, send: false as const, reason: "not_ready" as const };
  return { click: true as const, send: false as const, reason: "once" as const };
}

export function visibleFollowRestriction(text: string) {
  const value = text.toLowerCase();
  if (value.includes("confirm it's you") || value.includes("confirm it’s you")) return "instagram_checkpoint" as const;
  if (value.includes("please wait a few minutes")) return "rate_limited" as const;
  if (
    value.includes("try again later") ||
    value.includes("action blocked") ||
    value.includes("couldn't follow") ||
    value.includes("could not follow") ||
    value.includes("can't follow") ||
    value.includes("cannot follow")
  ) {
    return "action_blocked" as const;
  }
  return null;
}

export function unconfirmedFollowShouldPark(input: {
  jobType: string;
  status: string;
  followClickAttempted: boolean;
  relationship: string | null;
  lastError: string | null;
}) {
  if (input.jobType !== "follow_profile" || !input.followClickAttempted) return false;
  if (input.status !== "failed" && input.status !== "retry_wait") return false;
  if (input.relationship !== "not_following") return false;
  return input.lastError !== PREVIOUS_FOLLOW_NOT_CONFIRMED;
}
