import { isInstagramProfileHref } from "./profile-href";

export const SEED_NETWORK_SCROLL_LIMIT = 6;
export const SEED_NETWORK_STALE_SCROLLS = 2;
export const SEED_NETWORK_BUDGET_MS = 12_000;
export const SEED_NETWORK_VIEWPORT_CAP = 80;
export const SEED_NETWORK_OPEN_WAIT_MS = 4_000;
export const SEED_NETWORK_POLL_MS = 300;

export type SeedNetworkRead = {
  usernames: string[];
  buttonFound: boolean;
  dialogOpened: boolean;
  profileLinksFound: number;
  normalizedUsernames: number;
  duplicates: number;
  reserved: number;
  seedSelf: number;
  alreadyKnown: number;
  reason: string;
  labels?: Record<string, string>;
};

export function emptySeedNetworkRead(reason: string, partial?: Partial<SeedNetworkRead>): SeedNetworkRead {
  return {
    buttonFound: false,
    dialogOpened: false,
    profileLinksFound: 0,
    normalizedUsernames: 0,
    duplicates: 0,
    reserved: 0,
    seedSelf: 0,
    alreadyKnown: 0,
    reason,
    ...partial,
    usernames: partial?.usernames ?? [],
  };
}

export function absorbFollowingViewport(input: {
  visible: string[];
  isKnown: (username: string) => boolean;
  collected: string[];
  target: number;
}) {
  const have = new Set(input.collected.map((name) => name.trim().toLowerCase()).filter(Boolean));
  let added = 0;
  for (const name of input.visible) {
    const key = name.trim().toLowerCase();
    if (!key || have.has(key) || input.isKnown(key)) continue;
    have.add(key);
    added += 1;
    if (have.size >= input.target) break;
  }
  return { collected: [...have], added };
}

export function followingScrollDecision(input: {
  newCount: number;
  target: number;
  scrolls: number;
  maxScrolls: number;
  staleScrolls: number;
  staleLimit: number;
  timedOut: boolean;
  minimumNew?: number;
}) {
  if (input.newCount >= input.target) return "target" as const;
  if (input.timedOut) return "timeout" as const;
  if (input.scrolls >= input.maxScrolls) return "max_scrolls" as const;
  const usefulTarget = Math.min(input.minimumNew ?? 4, input.target);
  if (input.newCount > 0 && input.newCount < usefulTarget) return "scroll" as const;
  if (input.staleScrolls >= input.staleLimit) return "no_new_usernames" as const;
  return "scroll" as const;
}

export function followingUsernames(hrefs: string[], owner: string, limit: number) {
  const seen = new Set<string>();
  const names: string[] = [];
  const cap = Math.max(0, Math.floor(limit));
  for (const href of hrefs) {
    const username = isInstagramProfileHref(href, owner);
    if (!username || seen.has(username)) continue;
    seen.add(username);
    names.push(username);
    if (names.length >= cap) break;
  }
  return names;
}

export const SEED_NETWORK_OPEN_SOURCE = `() => {
  var parts = location.pathname.split("/").filter(Boolean);
  var owner = (parts[0] || "").toLowerCase();
  if (!owner) return "";
  var wanted = "/" + owner + "/following/";
  var links = document.querySelectorAll("a[href]");
  for (var i = 0; i < links.length; i += 1) {
    var href = links[i].getAttribute("href") || "";
    var path = "";
    try { path = new URL(href, location.origin).pathname; } catch (error) { continue; }
    if (path.charAt(path.length - 1) !== "/") path += "/";
    if (path !== wanted) continue;
    links[i].click();
    return "following";
  }
  function norm(value) { return String(value || "").replace(/\\s+/g, " ").trim(); }
  var controls = document.querySelectorAll("a, [role='link']");
  for (var c = 0; c < controls.length; c += 1) {
    var control = controls[c];
    if (control.closest && control.closest("nav, [role='navigation'], footer")) continue;
    var name = norm(control.getAttribute("aria-label") || control.innerText || control.textContent || "");
    if (!/^[\\d,.]+ following$/i.test(name)) continue;
    control.click();
    return "following";
  }
  return "";
}`;

export const SEED_NETWORK_READER_SOURCE = `(limit) => {
  var reserved = { about: 1, accounts: 1, direct: 1, directory: 1, emails: 1, explore: 1, legal: 1, meta: 1, nametag: 1, p: 1, privacy: 1, reel: 1, reels: 1, safety: 1, stories: 1, www: 1 };
  function profileHref(href, owner) {
    var raw = String(href || "").trim();
    if (!raw || raw.charAt(0) === "#" || raw.indexOf("javascript:") === 0) return "";
    var path = "";
    try { path = new URL(raw, location.origin).pathname; } catch (error) { return ""; }
    var bits = path.split("/").filter(Boolean);
    if (bits.length !== 1) return "";
    var username = "";
    try { username = decodeURIComponent(bits[0]).replace(/^@/, "").trim().toLowerCase(); } catch (error) { return ""; }
    if (!/^[a-z0-9._]{1,30}$/.test(username) || reserved[username]) return "";
    if (owner && username === owner) return "";
    return username;
  }
  var parts = location.pathname.split("/").filter(Boolean);
  var owner = (parts[0] || "").toLowerCase();
  var dialog = document.querySelector("[role='dialog']");
  var onFollowingPage = /\\/following\\/?$/.test(location.pathname);
  var root = dialog || (onFollowingPage ? (document.querySelector("main") || document.body) : null);
  if (!root) return [];
  var cap = Math.max(0, Math.floor(Number(limit) || 0));
  var names = [];
  var labels = {};
  var seen = {};
  var profileLinks = 0;
  var duplicates = 0;
  var reservedCount = 0;
  var seedSelf = 0;
  var nodes = root.querySelectorAll("a[href], h1, h2, h3, span");
  for (var i = 0; i < nodes.length; i += 1) {
    var el = nodes[i];
    if (el.closest && el.closest("nav, [role='navigation'], footer")) continue;
    var text = String(el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().toLowerCase();
    if (el.tagName !== "A" && el.children && el.children.length <= 3 && text.length > 0 && text.length < 40 && (text === "suggested for you" || text === "suggested accounts")) break;
    if (el.tagName !== "A") continue;
    profileLinks += 1;
    var href = el.getAttribute("href") || "";
    var withoutOwner = profileHref(href, "");
    if (!withoutOwner) {
      var path = "";
      try { path = new URL(href, location.origin).pathname; } catch (error) { path = ""; }
      var first = (path.split("/").filter(Boolean)[0] || "").toLowerCase();
      if (reserved[first]) reservedCount += 1;
      continue;
    }
    if (withoutOwner === owner) { seedSelf += 1; continue; }
    if (seen[withoutOwner]) { duplicates += 1; continue; }
    seen[withoutOwner] = 1;
    names.push(withoutOwner);
    var own = String(el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
    var parent = el.parentElement;
    var nearby = parent ? String(parent.innerText || parent.textContent || "").replace(/\\s+/g, " ").trim() : own;
    labels[withoutOwner] = (nearby.length > 180 ? own : nearby).slice(0, 160);
    if (names.length >= cap) break;
  }
  return { profileLinks: profileLinks, normalized: names.length, duplicates: duplicates, reserved: reservedCount, seedSelf: seedSelf, usernames: names, labels: labels };
}`;

export const SEED_NETWORK_SCROLL_SOURCE = `() => {
  var dialog = document.querySelector("[role='dialog']");
  var onFollowingPage = /\\/following\\/?$/.test(location.pathname);
  var root = dialog || (onFollowingPage ? (document.querySelector("main") || document.body) : null);
  if (!root) return false;
  var nodes = root.querySelectorAll("div");
  var best = null;
  var bestGap = 0;
  for (var i = 0; i < nodes.length; i += 1) {
    var node = nodes[i];
    var gap = node.scrollHeight - node.clientHeight;
    if (gap > 40 && node.clientHeight > 80 && gap > bestGap) {
      best = node;
      bestGap = gap;
    }
  }
  if (!best) return false;
  best.scrollTop = best.scrollTop + Math.max(240, Math.floor(best.clientHeight * 0.8));
  return true;
}`;

export const SEED_NETWORK_CLOSE_SOURCE = `() => {
  var dialog = document.querySelector("[role='dialog']");
  if (!dialog) return "none";
  var buttons = dialog.querySelectorAll("button, [role='button']");
  for (var i = 0; i < buttons.length; i += 1) {
    var label = String(buttons[i].getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().toLowerCase();
    if (label === "close") {
      buttons[i].click();
      return "close";
    }
  }
  return "escape";
}`;
