import type { FeedCandidate } from "../instagram/types";
import { isInstagramProfileHref } from "../instagram/profile-href";
import { normalizeCandidateUsername, type DiscoveryCandidate, type DiscoverySource } from "./queue";

export type SourcePriority = "suggested_first" | "home_first";

export function prioritizeCandidates(input: {
  suggested: FeedCandidate[];
  home: FeedCandidate[];
  priority: SourcePriority;
  homeEnabled: boolean;
  suggestedEnabled: boolean;
  now?: string;
}) {
  const suggested = input.suggestedEnabled ? tag(input.suggested, "suggested_accounts", input.now) : [];
  const home = input.homeEnabled ? tag(input.home, "home_feed", input.now) : [];
  const ordered = input.priority === "home_first" ? [...home, ...suggested] : [...suggested, ...home];
  const seen = new Set<string>();
  const unique: DiscoveryCandidate[] = [];
  for (const candidate of ordered) {
    const username = normalizeCandidateUsername(candidate.username);
    if (!username || seen.has(username)) continue;
    seen.add(username);
    unique.push({ ...candidate, username });
  }
  return unique;
}

function tag(candidates: FeedCandidate[], source: DiscoverySource, now?: string): DiscoveryCandidate[] {
  return candidates.map((candidate) => ({
    username: candidate.username,
    profileUrl: candidate.profileUrl,
    source,
    sourcePostUrl: candidate.postUrl,
    sourceThumbnailUrl: null,
    discoveredAt: now ?? new Date(0).toISOString(),
  }));
}

export function collectSuggestedUsernames(sections: Array<{ heading: string; hrefs: string[] }>) {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    const heading = section.heading.replace(/\s+/g, " ").trim();
    if (heading !== "Suggested for you" && heading !== "Suggested accounts") continue;
    for (const href of section.hrefs) {
      const username = usernameFromSuggestedHref(href);
      if (!username || seen.has(username)) continue;
      seen.add(username);
      found.push(username);
    }
  }
  return found;
}

export function usernameFromSuggestedHref(href: string) {
  return isInstagramProfileHref(href) ?? "";
}
