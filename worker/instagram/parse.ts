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

export function controlRelationship(value: string): FollowRelationship | null {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length > 80) return null;
  if (/\d/.test(text) && /follower|following|posts/i.test(text)) return null;
  if (/^requested\b/i.test(text)) return "requested";
  if (/^unfollow\b/i.test(text)) return "following";
  if (/^following\b/i.test(text)) return "following";
  if (/^follow back\b/i.test(text)) return "not_following";
  if (/^follow\b/i.test(text)) return "not_following";
  return null;
}

export function relationshipFromLabels(labels: string[]): FollowRelationship {
  const matches: FollowRelationship[] = [];
  for (const label of labels) {
    const relationship = controlRelationship(label);
    if (relationship) matches.push(relationship);
  }
  if (matches.length === 0) return "unknown";
  const first = matches[0];
  if (first === "following" || first === "requested") return first;
  if (matches.some((item) => item === "following" || item === "requested")) return "unknown";
  if (matches.every((item) => item === "not_following")) return "not_following";
  return "unknown";
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

export function isExcludedRelationship(relationship: FollowRelationship) {
  return relationship === "following" || relationship === "requested";
}
