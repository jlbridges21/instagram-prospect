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

export function relationshipFromLabels(labels: string[]): FollowRelationship {
  const names = labels.map((label) => label.trim()).filter(Boolean);
  if (names.some((label) => /^requested$/i.test(label))) return "requested";
  if (names.some((label) => /^following$/i.test(label))) return "following";
  if (names.some((label) => /^follow$/i.test(label))) return "not_following";
  return "unknown";
}

export function isExcludedRelationship(relationship: FollowRelationship) {
  return relationship === "following" || relationship === "requested";
}
