import type { Page } from "playwright";
import { normalizeInstagramUsername } from "./profile-href";
import {
  SEED_NETWORK_BUDGET_MS,
  SEED_NETWORK_CLOSE_SOURCE,
  SEED_NETWORK_OPEN_SOURCE,
  SEED_NETWORK_OPEN_WAIT_MS,
  SEED_NETWORK_POLL_MS,
  SEED_NETWORK_READER_SOURCE,
  SEED_NETWORK_SCROLL_LIMIT,
  SEED_NETWORK_SCROLL_SOURCE,
  SEED_NETWORK_STALE_SCROLLS,
  SEED_NETWORK_VIEWPORT_CAP,
  absorbFollowingViewport,
  emptySeedNetworkRead,
  followingScrollDecision,
  type SeedNetworkRead,
} from "./seed-network";

const openFollowingList = new Function(`return (${SEED_NETWORK_OPEN_SOURCE})();`) as () => string;
const scrollFollowingList = new Function(`return (${SEED_NETWORK_SCROLL_SOURCE})();`) as () => boolean;
const closeFollowingList = new Function(`return (${SEED_NETWORK_CLOSE_SOURCE})();`) as () => string;

type FollowingScan = {
  profileLinks: number;
  normalized: number;
  duplicates: number;
  reserved: number;
  seedSelf: number;
  usernames: string[];
  labels?: Record<string, string>;
};

function readFollowingList(limit: number) {
  const cap = Math.max(0, Math.floor(limit));
  return new Function(`return (${SEED_NETWORK_READER_SOURCE})(${cap});`) as () => FollowingScan;
}

async function followingSurface(page: Page) {
  return page.evaluate("(() => ({ dialog: Boolean(document.querySelector(\"[role='dialog']\")), following: /\\/following\\/?$/.test(location.pathname) }))()").catch(() => null) as Promise<{ dialog: boolean; following: boolean } | null>;
}

export async function openSeedFollowing(
  page: Page,
  username: string,
  limit: number,
  isKnown: (username: string) => boolean = () => false,
  limits?: { maxScrolls?: number; staleScrolls?: number },
): Promise<SeedNetworkRead> {
  const owner = normalizeInstagramUsername(username);
  const cap = Math.max(0, Math.floor(limit));
  if (!owner || cap === 0) return emptySeedNetworkRead("no following sample requested");
  try {
    let opened = "";
    try {
      opened = await page.evaluate(openFollowingList);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/destroyed|navigation|target closed/i.test(message)) return emptySeedNetworkRead("could not open following");
      opened = "navigated";
    }
    if (opened !== "following" && opened !== "navigated") return emptySeedNetworkRead("no following link");
    const started = Date.now();
    let surface = await followingSurface(page);
    while (!(surface?.dialog || surface?.following) && Date.now() - started < SEED_NETWORK_OPEN_WAIT_MS) {
      await page.waitForTimeout(SEED_NETWORK_POLL_MS);
      surface = await followingSurface(page);
    }
    if (!(surface?.dialog || surface?.following)) {
      return emptySeedNetworkRead("timeout waiting for dialog", { buttonFound: true });
    }
    const read = readFollowingList(SEED_NETWORK_VIEWPORT_CAP);
    const labels: Record<string, string> = {};
    let scan: FollowingScan = { profileLinks: 0, normalized: 0, duplicates: 0, reserved: 0, seedSelf: 0, usernames: [] };
    let collected: string[] = [];
    const knownNames = new Set<string>();
    let scrolls = 0;
    let staleScrolls = 0;
    const budgetStarted = Date.now();
    const absorb = (found: FollowingScan) => {
      scan = found;
      const next = absorbFollowingViewport({ visible: found.usernames, isKnown, collected, target: cap });
      for (const name of found.usernames) if (isKnown(name)) knownNames.add(name);
      for (const name of next.collected) {
        if (found.labels?.[name]) labels[name] = found.labels[name];
      }
      collected = next.collected;
      return next.added;
    };
    absorb(await page.evaluate(read));
    while (
      followingScrollDecision({
        newCount: collected.length,
        target: cap,
        scrolls,
        maxScrolls: limits?.maxScrolls ?? SEED_NETWORK_SCROLL_LIMIT,
        staleScrolls,
        staleLimit: limits?.staleScrolls ?? SEED_NETWORK_STALE_SCROLLS,
        timedOut: Date.now() - budgetStarted >= SEED_NETWORK_BUDGET_MS,
      }) === "scroll"
    ) {
      const moved = await page.evaluate(scrollFollowingList);
      scrolls += 1;
      if (!moved) {
        staleScrolls += 1;
        continue;
      }
      await page.waitForTimeout(SEED_NETWORK_POLL_MS);
      const added = absorb(await page.evaluate(read));
      if (added === 0) staleScrolls += 1;
      else staleScrolls = 0;
    }
    const closed = await page.evaluate(closeFollowingList).catch(() => "escape");
    if (closed !== "close") await page.keyboard.press("Escape").catch(() => undefined);
    return {
      usernames: collected,
      buttonFound: true,
      dialogOpened: true,
      profileLinksFound: scan.profileLinks,
      normalizedUsernames: scan.normalized,
      duplicates: scan.duplicates,
      reserved: scan.reserved,
      seedSelf: scan.seedSelf,
      alreadyKnown: knownNames.size,
      labels,
      reason: collected.length === 0 ? "dialog had no new profile links" : "",
    };
  } catch {
    await page.keyboard.press("Escape").catch(() => undefined);
    return emptySeedNetworkRead("could not open following", { buttonFound: true });
  }
}
