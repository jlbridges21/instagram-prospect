const RESERVED_USERNAMES = new Set([
  "about",
  "accounts",
  "developer",
  "direct",
  "explore",
  "legal",
  "p",
  "reel",
  "reels",
  "stories",
]);

const USERNAME_PATTERN = /^[a-z0-9._]{1,30}$/;

export function parseFollowerCount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const match = raw
    .trim()
    .toLowerCase()
    .replace(/,/g, "")
    .match(/(\d+(?:\.\d+)?)\s*([km])\b|\b(\d+(?:\.\d+)?)\b/);
  if (!match) return null;
  if (match[1] && match[2]) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) return null;
    if (match[2] === "k") return Math.round(value * 1000);
    if (match[2] === "m") return Math.round(value * 1_000_000);
    return null;
  }
  const plain = Number(match[3]);
  if (!Number.isFinite(plain)) return null;
  return Math.round(plain);
}

export function usernameFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  let path = href.trim();
  try {
    if (path.startsWith("http")) path = new URL(path).pathname;
  } catch {
    return null;
  }
  const match = path.match(/^\/([A-Za-z0-9._]{1,30})\/?$/);
  if (!match) return null;
  const username = match[1].toLowerCase();
  if (!USERNAME_PATTERN.test(username) || RESERVED_USERNAMES.has(username)) return null;
  return username;
}

export function postUrlFromHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const match = href.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
  if (!match) return null;
  const kind = href.includes("/reel/") ? "reel" : "p";
  return `https://www.instagram.com/${kind}/${match[1]}/`;
}

export function profileUrlFor(username: string) {
  return `https://www.instagram.com/${encodeURIComponent(username)}/`;
}

export type FollowRelationship = "following" | "not_following" | "requested" | "unknown";

export function normalizeControlText(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  const half = Math.floor(compact.length / 2);
  if (half > 2 && compact.slice(0, half).toLowerCase() === compact.slice(half).toLowerCase()) {
    return compact.slice(0, half).trim();
  }
  return compact;
}

const EXACT_RELATIONSHIP_LABEL = /^(follow|follow back|following|requested)$/i;

export function controlRelationship(value: string): FollowRelationship | null {
  const text = normalizeControlText(value);
  if (!text || text.length > 40) return null;
  if (/\d/.test(text)) return null;
  if (/^followed by\b/i.test(text)) return null;
  if (!EXACT_RELATIONSHIP_LABEL.test(text)) return null;
  if (/^requested$/i.test(text)) return "requested";
  if (/^following$/i.test(text)) return "following";
  if (/^follow back$/i.test(text)) return "not_following";
  return "not_following";
}

export function isRelationshipAction(candidate: {
  tag?: string;
  role?: string;
  text?: string;
  ariaLabel?: string;
  title?: string;
  href?: string;
  isInteractive?: boolean;
}) {
  const tag = (candidate.tag || "").toLowerCase();
  const role = (candidate.role || "").toLowerCase();
  const href = (candidate.href || "").split("?")[0];
  const button = tag === "button" || role === "button";
  const actionAnchor = tag === "a" && !/\/(followers|following|posts)\/?$/i.test(href);
  if (candidate.isInteractive === false && !button) return false;
  if (!button && !actionAnchor) return false;
  return [candidate.ariaLabel, candidate.text, candidate.title].some((value) => value && controlRelationship(value));
}

export function relationshipFromLabels(labels: string[]): FollowRelationship {
  const matches = new Set<FollowRelationship>();
  for (const label of labels) {
    const relationship = controlRelationship(label);
    if (relationship) matches.add(relationship);
  }
  if (matches.size !== 1) return "unknown";
  return [...matches][0];
}

export function displayNameFromTitle(title: string, username: string | null) {
  const stripped = title.replace(/^\(\d+\)\s*/, "").trim();
  if (username) {
    const handle = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`\\(@${handle}\\)|@${handle}\\b`, "i").test(stripped)) return null;
  }
  let name = stripped.replace(/\s*[•|].*$/, "").trim();
  name = name.replace(/\s*\(@[^)]+\)\s*/g, " ").replace(/\s+/g, " ").trim();
  name = name.replace(/\s+on Instagram$/i, "").replace(/\s+Instagram photos and videos$/i, "").replace(/['’]s profile picture$/i, "").trim();
  if (!name || /^instagram$/i.test(name) || /^\(\d+\)$/.test(name)) return null;
  if (username && name.toLowerCase() === username.toLowerCase()) return null;
  return name;
}

export function cleanProfileBio(lines: string[], username: string | null, displayName: string | null) {
  const noise = /^(follow|follow back|following|requested|message|share|posts?|followers?|following)$/i;
  const kept = lines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => {
      if (line.length < 2) return false;
      if (username && line.toLowerCase() === username.toLowerCase()) return false;
      if (displayName && line.toLowerCase() === displayName.toLowerCase()) return false;
      if (noise.test(line)) return false;
      if (/\d/.test(line) && /follower|following|posts/i.test(line)) return false;
      if (/^@?[a-z0-9._]{1,30}$/i.test(line) && username && line.replace(/^@/, "").toLowerCase() === username) return false;
      return true;
    });
  const bio = kept.join("\n").trim();
  return bio ? bio.slice(0, 2200) : null;
}

export function countFromLabeledText(texts: Array<string | null | undefined>, label: "followers" | "following") {
  for (const text of texts) {
    if (!text) continue;
    const pattern = label === "followers" ? /follower/i : /following/i;
    const other = label === "followers" ? null : /follower/i;
    if (!pattern.test(text)) continue;
    if (other?.test(text)) continue;
    const count = parseFollowerCount(text);
    if (count !== null) return count;
  }
  return null;
}

export function relationshipFromCandidates(
  candidates: Array<{
    tag?: string;
    role?: string;
    text?: string;
    ariaLabel?: string;
    title?: string;
    scope?: "primary" | "outside";
    besideOptions?: boolean;
    isInteractive?: boolean;
    href?: string;
  }>,
) {
  const labelsOf = (items: typeof candidates) =>
    items
      .filter((candidate) => isRelationshipAction(candidate))
      .flatMap((candidate) => [candidate.ariaLabel, candidate.text, candidate.title].filter((value): value is string => Boolean(value)));
  const primary = candidates.filter((candidate) => candidate.scope !== "outside" && isRelationshipAction(candidate));
  const beside = primary.filter((candidate) => candidate.besideOptions);
  const besideRelationship = relationshipFromLabels(labelsOf(beside));
  const pool = besideRelationship === "unknown" ? primary : beside;
  const relationship = pool === beside ? besideRelationship : relationshipFromLabels(labelsOf(primary));
  const matched = pool.find((candidate) =>
    [candidate.ariaLabel, candidate.text, candidate.title].some((value) => value && controlRelationship(value)),
  );
  let strategy = "none";
  if (matched && relationship !== "unknown") {
    const role = (matched.role || "").toLowerCase();
    if (role === "button" && (matched.tag || "").toLowerCase() !== "button") strategy = "primary-action-region-role-button";
    else if ((matched.tag || "").toLowerCase() === "button") strategy = "primary-action-region-button";
    else if ((matched.tag || "").toLowerCase() === "a") strategy = "primary-action-region-link";
  }
  return { relationship, strategy };
}

export type RelationshipChoice = {
  relationship: FollowRelationship;
  strategy: string;
  acceptedLabel: string | null;
  decisions: Array<{
    label: string;
    tag: string;
    ancestorTag: string;
    ancestorRole: string;
    box: { x: number; y: number; width: number; height: number } | null;
    ancestorBox: { x: number; y: number; width: number; height: number } | null;
    distance: number | null;
    accepted: boolean;
    reason: string;
  }>;
};

function statsHref(href: string | null | undefined) {
  return /\/(followers|following|posts)\/?$/i.test((href || "").split("?")[0]);
}

function hitLabel(hit: { label?: string; text?: string; ariaLabel?: string; title?: string }) {
  return controlRelationship(hit.label || "") || controlRelationship(hit.ariaLabel || "") || controlRelationship(hit.text || "") || controlRelationship(hit.title || "");
}

export function selectPrimaryRelationship(
  hits: Array<{
    label?: string;
    tag?: string;
    role?: string;
    text?: string;
    ariaLabel?: string;
    title?: string;
    href?: string;
    box?: { x: number; y: number; width: number; height: number } | null;
    inSuggestion?: boolean;
    inDialog?: boolean;
    otherUsername?: string | null;
    ancestor?: {
      tag?: string;
      role?: string;
      text?: string;
      ariaLabel?: string;
      href?: string;
      box?: { x: number; y: number; width: number; height: number } | null;
    } | null;
  }>,
  usernameBox?: { x: number; y: number; width: number; height: number } | null,
  optionsBox?: { x: number; y: number; width: number; height: number } | null,
): RelationshipChoice {
  const decisions = hits.map((hit) => {
    const label = hit.label || hit.text || "";
    const ancestor = hit.ancestor;
    const selfClickable = (hit.tag || "").toLowerCase() === "button" || (hit.role || "").toLowerCase() === "button" || ((hit.tag || "").toLowerCase() === "a" && !statsHref(hit.href));
    const ancestorClickable = Boolean(ancestor && ((ancestor.tag || "").toLowerCase() === "button" || (ancestor.role || "").toLowerCase() === "button" || (ancestor.tag || "").toLowerCase() === "a"));
    const point = ancestor?.box || hit.box || null;
    let distance: number | null = null;
    let near = false;
    let place = "username position unavailable";
    if (usernameBox && point) {
      distance = Math.round(Math.hypot(point.x - usernameBox.x, point.y - usernameBox.y));
      const dy = point.y - usernameBox.y;
      near = dy >= -120 && dy <= 360 && Math.abs(point.x - usernameBox.x) < 1100;
      place = near ? "near profile header" : "below profile header";
    } else if (optionsBox && point) {
      distance = Math.round(Math.hypot(point.x - optionsBox.x, point.y - optionsBox.y));
      near = distance <= 280;
      place = near ? "near the Options control" : "far from the Options control";
    }
    const ownText = `${hit.text || ""} ${hit.ariaLabel || ""}`;
    const ancestorText = `${ancestor?.text || ""} ${ancestor?.ariaLabel || ""}`;
    const ownIsStats = /\d/.test(ownText) && /follower|following|posts/i.test(ownText);
    const ancestorIsStats = ancestorText.length > 0 && ancestorText.length <= 40 && /\d/.test(ancestorText) && /follower|following|posts/i.test(ancestorText);
    const statsAncestor = statsHref(ancestor?.href) || statsHref(hit.href) || ownIsStats || ancestorIsStats;
    let reason = place;
    if (!hitLabel(hit)) reason = "not an exact relationship label";
    else if (hit.inDialog) reason = "inside a dialog";
    else if (hit.inSuggestion) reason = "inside Suggested accounts";
    else if (hit.otherUsername) reason = "belongs to another profile";
    else if (!selfClickable && !ancestorClickable) reason = "not an interactive control";
    else if (statsAncestor) reason = "profile statistics";
    else if (!near) reason = place;
    else reason = "near profile header";
    const accepted = reason === "near profile header" || reason === "near the Options control";
    return {
      label,
      tag: hit.tag || "",
      ancestorTag: ancestor?.tag || "",
      ancestorRole: ancestor?.role || "",
      box: hit.box || null,
      ancestorBox: ancestor?.box || null,
      distance,
      accepted,
      reason,
    };
  });
  const accepted = decisions.filter((decision) => decision.accepted);
  const relationships = new Set(accepted.map((decision) => controlRelationship(decision.label)).filter((value): value is FollowRelationship => Boolean(value)));
  if (relationships.size !== 1) {
    return {
      relationship: "unknown",
      strategy: "none",
      acceptedLabel: null,
      decisions: decisions.map((decision) => decision.accepted && relationships.size > 1 ? { ...decision, accepted: false, reason: "conflicts with another header control" } : decision),
    };
  }
  const relationship = [...relationships][0];
  const winner = accepted.find((decision) => controlRelationship(decision.label) === relationship);
  return {
    relationship,
    strategy: "global-exact-action-near-profile-header",
    acceptedLabel: winner?.label || null,
    decisions,
  };
}

export function isExcludedRelationship(relationship: FollowRelationship) {
  return relationship === "following" || relationship === "requested";
}
