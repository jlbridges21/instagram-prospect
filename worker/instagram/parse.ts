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
  let name = title.replace(/\s*[•|].*$/, "").trim();
  name = name.replace(/\s*\(@[^)]+\)\s*/g, " ").replace(/\s+/g, " ").trim();
  name = name.replace(/\s+on Instagram$/i, "").replace(/['’]s profile picture$/i, "").trim();
  if (!name || /^instagram$/i.test(name)) return null;
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

export function isExcludedRelationship(relationship: FollowRelationship) {
  return relationship === "following" || relationship === "requested";
}
