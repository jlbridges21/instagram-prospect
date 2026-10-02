export type FollowingBadge = "Yes" | "No" | "Requested" | "Unknown";

export function followingBadge(input: {
  already_following?: boolean | null;
  follow_relationship?: string | null;
}): FollowingBadge {
  if (input.follow_relationship === "requested") return "Requested";
  if (input.follow_relationship === "not_following") return "No";
  if (input.follow_relationship === "following" || input.already_following) return "Yes";
  return "Unknown";
}

export function backfillFollowRelationship(alreadyFollowing: boolean) {
  return alreadyFollowing ? "following" : "unknown";
}
