const RESERVED_PROFILE_SEGMENTS = new Set([
  "about",
  "accounts",
  "direct",
  "directory",
  "emails",
  "explore",
  "legal",
  "meta",
  "nametag",
  "p",
  "privacy",
  "reel",
  "reels",
  "safety",
  "stories",
  "www",
]);

export function normalizeInstagramUsername(value: string) {
  return value.replace(/^@/, "").trim().toLowerCase();
}

/** Genuine profile path only: /username/ . Posts, reels, and reserved routes are rejected. */
export function isInstagramProfileHref(href: string, owner?: string) {
  const raw = href.trim();
  if (!raw || raw.startsWith("#") || /^javascript:/i.test(raw)) return null;
  let pathname = "";
  try {
    pathname = new URL(raw, "https://www.instagram.com").pathname;
  } catch {
    return null;
  }
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length !== 1) return null;
  let username = "";
  try {
    username = normalizeInstagramUsername(decodeURIComponent(parts[0] ?? ""));
  } catch {
    return null;
  }
  if (!/^[a-z0-9._]{1,30}$/.test(username)) return null;
  if (RESERVED_PROFILE_SEGMENTS.has(username)) return null;
  const own = owner ? normalizeInstagramUsername(owner) : "";
  if (own && username === own) return null;
  return username;
}
