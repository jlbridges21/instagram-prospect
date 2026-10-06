import { isInstagramProfileHref, normalizeInstagramUsername } from "./profile-href";

export const SEED_SUGGESTION_LABELS = [
  "suggested for you",
  "suggested accounts",
  "similar accounts",
  "related accounts",
] as const;

export const SEED_SUGGESTION_WAIT_MS = 4_000;
export const SEED_SUGGESTION_POLL_MS = 300;
export const SEED_SUGGESTION_EXPAND_WAIT_MS = 2_000;
export const EMPTY_SEED_COOLDOWN_MS = 45 * 60 * 1000;
export const UNHELPFUL_SEED_COOLDOWN_MS = 10 * 60 * 1000;
const MAX_SUGGESTION_LINKS = 12;

export type SeedReadSnapshot = {
  url: string;
  headings: string[];
  triggers: string[];
  rawLinks: number;
  usernames: string[];
  strategy: "" | "suggestions-section" | "nearby-cluster" | "aria-widget";
};

export type SeedPageRegion = {
  heading: string;
  links: string[];
  nearbyLinks?: string[];
  widgetLinks?: string[];
};

export function suggestionHeading(value: string) {
  const text = value.replace(/\s+/g, " ").trim().toLowerCase();
  if (!text || text.length > 80) return "";
  return SEED_SUGGESTION_LABELS.find((label) => text === label || text.startsWith(`${label} `)) ?? "";
}

export function usernamesFromSeedRegions(owner: string, regions: SeedPageRegion[]) {
  const own = normalizeInstagramUsername(owner);
  const seen = new Set<string>();
  const usernames: string[] = [];
  let strategy: SeedReadSnapshot["strategy"] = "";
  let rawLinks = 0;

  function take(hrefs: string[], next: SeedReadSnapshot["strategy"]) {
    const accepted: string[] = [];
    let considered = 0;
    for (const href of hrefs) {
      const username = isInstagramProfileHref(href, "");
      if (!username || seen.has(username)) continue;
      considered += 1;
      if (username === own) continue;
      accepted.push(username);
    }
    if (accepted.length < 1 || accepted.length > MAX_SUGGESTION_LINKS) return false;
    rawLinks = considered;
    strategy = next;
    for (const username of accepted) {
      seen.add(username);
      usernames.push(username);
    }
    return true;
  }

  for (const region of regions) {
    if (!suggestionHeading(region.heading)) continue;
    if (take(region.links, "suggestions-section")) break;
  }
  if (usernames.length === 0) {
    for (const region of regions) {
      if (!suggestionHeading(region.heading)) continue;
      if (take(region.nearbyLinks ?? [], "nearby-cluster")) break;
    }
  }
  if (usernames.length === 0) {
    for (const region of regions) {
      if (!suggestionHeading(region.heading)) continue;
      if (take(region.widgetLinks ?? [], "aria-widget")) break;
    }
  }
  return { usernames, strategy, rawLinks };
}

export function seedReadPlan(snapshot: Pick<SeedReadSnapshot, "usernames" | "triggers">) {
  if (snapshot.usernames.length > 0) return "read" as const;
  if (snapshot.triggers.length > 0) return "expand" as const;
  return "fallback" as const;
}

export async function pollSeedRead<T extends { usernames: string[] }>(input: {
  read: () => Promise<T>;
  wait: (ms: number) => Promise<void>;
  budgetMs: number;
  intervalMs: number;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  const start = now();
  let latest = await input.read();
  while (latest.usernames.length === 0 && now() - start < input.budgetMs) {
    await input.wait(input.intervalMs);
    latest = await input.read();
  }
  return latest;
}

export function emptySeedCooldownUntil(now: number, durationMs = EMPTY_SEED_COOLDOWN_MS) {
  return new Date(now + durationMs).toISOString();
}

export function seedTurnOutcome(input: { newAfterDedupe: number; queuedAboveFloor: number }) {
  if (input.newAfterDedupe <= 0) return "empty" as const;
  if (input.queuedAboveFloor <= 0) return "unhelpful" as const;
  return "productive" as const;
}

export function applyEmptySeedCooldowns<T extends { username: string; cooldownUntil?: string | null }>(
  seeds: T[],
  pauses: Record<string, string>,
  now: number,
) {
  return seeds.map((seed) => {
    const until = pauses[normalizeInstagramUsername(seed.username)];
    if (!until || new Date(until).getTime() <= now) return seed;
    return { ...seed, cooldownUntil: until };
  });
}

export function seedSuggestionLogLines(input: {
  username: string;
  headings: string[];
  triggers: string[];
  rawLinks: number;
  usable: string[];
  openedTrigger: string;
  strategy: string;
}) {
  const headings = [...new Set(input.headings.map((heading) => heading.replace(/\s+/g, " ").trim()).filter(Boolean))];
  const lines = [`Opening seed suggestions for @${normalizeInstagramUsername(input.username)}`];
  lines.push(headings.length ? `Suggestion headings found: ${JSON.stringify(headings)}` : "No suggestion heading found.");
  if (input.openedTrigger) lines.push(`Opened suggestions control: ${input.openedTrigger}`);
  else if (input.triggers.length === 0) lines.push("No related-account trigger found.");
  lines.push(`Candidate profile links found: ${input.rawLinks}`);
  lines.push(`Usable after filtering: ${input.usable.length}`);
  if (input.strategy) lines.push(`Strategy: ${input.strategy}`);
  if (input.usable.length === 0) lines.push("Falling back.");
  return lines;
}

export const SEED_PAGE_READER_SOURCE = `() => {
  var labels = ["suggested for you", "suggested accounts", "similar accounts", "related accounts"];
  var reserved = { about: 1, accounts: 1, direct: 1, directory: 1, emails: 1, explore: 1, legal: 1, meta: 1, nametag: 1, p: 1, privacy: 1, reel: 1, reels: 1, safety: 1, stories: 1, www: 1 };
  function norm(value) { return String(value || "").replace(/\\s+/g, " ").trim(); }
  function headingOf(value) {
    var text = norm(value).toLowerCase();
    if (!text || text.length > 80) return "";
    for (var i = 0; i < labels.length; i += 1) {
      if (text === labels[i] || text.indexOf(labels[i] + " ") === 0) return labels[i];
    }
    return "";
  }
  function profileHref(href, owner) {
    var raw = String(href || "").trim();
    if (!raw || raw.charAt(0) === "#" || raw.indexOf("javascript:") === 0) return "";
    var path = "";
    try { path = new URL(raw, "https://www.instagram.com").pathname; } catch (error) { return ""; }
    var parts = path.split("/").filter(Boolean);
    if (parts.length !== 1) return "";
    var username = "";
    try { username = decodeURIComponent(parts[0]).replace(/^@/, "").trim().toLowerCase(); } catch (error) { return ""; }
    if (!/^[a-z0-9._]{1,30}$/.test(username) || reserved[username]) return "";
    if (owner && username === owner) return "";
    return username;
  }
  function ownerName() {
    var part = (location.pathname.split("/").filter(Boolean)[0] || "").toLowerCase();
    return profileHref("/" + part + "/", "") || "";
  }
  var owner = ownerName();
  var headings = [];
  var triggers = [];
  var markers = [];
  var nodes = document.querySelectorAll("body *");
  for (var n = 0; n < nodes.length; n += 1) {
    var el = nodes[n];
    if (el.closest && el.closest("nav, [role='navigation'], footer")) continue;
    if (el.children && el.children.length > 8) continue;
    var name = norm(el.getAttribute("aria-label") || el.innerText || el.textContent || "");
    if (!headingOf(name)) continue;
    headings.push(name.slice(0, 80));
    var role = (el.getAttribute("role") || "").toLowerCase();
    var tag = (el.tagName || "").toLowerCase();
    if (role === "button" || tag === "button" || el.getAttribute("aria-expanded") != null || el.getAttribute("tabindex") === "0") triggers.push(name.slice(0, 80));
    markers.push(el);
    if (markers.length >= 8) break;
  }
  function cluster(root) {
    var raw = [];
    var seen = {};
    if (!root || root === document.body || root === document.documentElement) return { raw: 0, names: [] };
    var tag = (root.tagName || "").toLowerCase();
    if (tag === "article" || (root.querySelector && root.querySelector("article"))) return { raw: 0, names: [] };
    var anchors = root.querySelectorAll ? root.querySelectorAll("a[href]") : [];
    for (var i = 0; i < anchors.length; i += 1) {
      var link = anchors[i];
      if (link.closest && link.closest("nav, [role='navigation'], footer")) continue;
      var username = profileHref(link.getAttribute("href") || "", "");
      if (!username || seen[username]) continue;
      seen[username] = 1;
      raw.push(username);
    }
    var names = raw.filter(function (username) { return username !== owner; });
    if (names.length < 1 || names.length > 12) return { raw: 0, names: [] };
    return { raw: raw.length, names: names };
  }
  var usernames = [];
  var rawLinks = 0;
  var strategy = "";
  function accept(found, name) {
    if (!found.names.length) return false;
    usernames = found.names.slice(0, 12);
    rawLinks = found.raw;
    strategy = name;
    return true;
  }
  for (var m = 0; m < markers.length && !usernames.length; m += 1) {
    var scope = markers[m];
    for (var depth = 0; depth < 6 && scope; depth += 1) {
      if (accept(cluster(scope), "suggestions-section")) break;
      scope = scope.parentElement;
    }
  }
  if (!usernames.length) {
    for (var s = 0; s < markers.length; s += 1) {
      var sibling = markers[s].nextElementSibling;
      if (accept(cluster(sibling), "nearby-cluster")) break;
      var parentSibling = markers[s].parentElement && markers[s].parentElement.nextElementSibling;
      if (accept(cluster(parentSibling), "nearby-cluster")) break;
    }
  }
  if (!usernames.length) {
    var labeled = document.querySelectorAll("[aria-label]");
    for (var a = 0; a < labeled.length; a += 1) {
      if (!headingOf(labeled[a].getAttribute("aria-label") || "")) continue;
      if (accept(cluster(labeled[a]), "aria-widget")) break;
    }
  }
  return { url: location.href, headings: headings.slice(0, 8), triggers: triggers.slice(0, 8), rawLinks: rawLinks, usernames: usernames, strategy: strategy };
}`;

export const SEED_PAGE_EXPAND_SOURCE = `() => {
  var labels = ["suggested for you", "suggested accounts", "similar accounts", "related accounts"];
  function norm(value) { return String(value || "").replace(/\\s+/g, " ").trim(); }
  function matches(value) {
    var text = norm(value).toLowerCase();
    if (!text || text.length > 80) return false;
    if (/^(follow|following|message|requested)$/.test(text)) return false;
    for (var i = 0; i < labels.length; i += 1) {
      if (text === labels[i] || text.indexOf(labels[i] + " ") === 0) return true;
    }
    return text === "see all" || text.indexOf("see all ") === 0;
  }
  var nodes = document.querySelectorAll("button, [role='button'], [tabindex='0']");
  for (var i = 0; i < nodes.length; i += 1) {
    var el = nodes[i];
    if (el.closest && el.closest("nav, [role='navigation'], footer")) continue;
    if ((el.tagName || "").toLowerCase() === "a") {
      var href = el.getAttribute("href") || "";
      if (/\\/(explore|reels|direct|accounts)\\b/i.test(href)) continue;
    }
    var name = norm(el.getAttribute("aria-label") || el.innerText || el.textContent || "");
    if (!matches(name)) continue;
    if (el.getAttribute("aria-expanded") === "true") continue;
    if (norm(name).toLowerCase().indexOf("see all") === 0) {
      var around = norm((el.parentElement && (el.parentElement.innerText || el.parentElement.textContent)) || "");
      if (around.length > 180) continue;
      var lower = around.toLowerCase();
      var aroundOk = false;
      for (var n = 0; n < labels.length; n += 1) if (lower.indexOf(labels[n]) >= 0) aroundOk = true;
      if (!aroundOk) continue;
    }
    el.click();
    return name.slice(0, 80);
  }
  var rows = document.querySelectorAll("body *");
  for (var r = 0; r < rows.length; r += 1) {
    var row = rows[r];
    if (row.closest && row.closest("nav, [role='navigation'], footer")) continue;
    if (row.children && row.children.length > 8) continue;
    var rowName = norm(row.innerText || row.textContent || "");
    if (!matches(rowName) || norm(rowName).toLowerCase().indexOf("see all") === 0) continue;
    var parent = row.parentElement;
    var parentRole = parent ? ((parent.getAttribute("role") || parent.tagName || "").toLowerCase()) : "";
    if (parent && (parentRole === "button" || parentRole === "button")) {
      var parentName = norm(parent.getAttribute("aria-label") || parent.innerText || parent.textContent || "");
      if (matches(parentName) && parent.getAttribute("aria-expanded") !== "true") {
        parent.click();
        return parentName.slice(0, 80);
      }
    }
    var control = row.querySelector && row.querySelector("button, [role='button'], svg");
    if (!control) continue;
    var controlName = norm((control.getAttribute && control.getAttribute("aria-label")) || "");
    if (/^(follow|following|message|requested)$/i.test(controlName)) continue;
    control.click();
    return rowName.slice(0, 80);
  }
  return "";
}`;
