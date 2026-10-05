import type { Page } from "playwright";
import { normalizeInstagramUsername } from "./profile-href";
import {
  SEED_NETWORK_CLOSE_SOURCE,
  SEED_NETWORK_OPEN_SOURCE,
  SEED_NETWORK_OPEN_WAIT_MS,
  SEED_NETWORK_POLL_MS,
  SEED_NETWORK_READER_SOURCE,
  SEED_NETWORK_SCROLL_LIMIT,
  SEED_NETWORK_SCROLL_SOURCE,
  emptySeedNetworkRead,
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
};

function readFollowingList(limit: number) {
  const cap = Math.max(0, Math.floor(limit));
  return new Function(`return (${SEED_NETWORK_READER_SOURCE})(${cap});`) as () => FollowingScan;
}

async function followingSurface(page: Page) {
  return page.evaluate("(() => ({ dialog: Boolean(document.querySelector(\"[role='dialog']\")), following: /\\/following\\/?$/.test(location.pathname) }))()").catch(() => null) as Promise<{ dialog: boolean; following: boolean } | null>;
}

export async function openSeedFollowing(page: Page, username: string, limit: number): Promise<SeedNetworkRead> {
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
    const read = readFollowingList(cap);
    const seen = new Set<string>();
    let scan: FollowingScan = { profileLinks: 0, normalized: 0, duplicates: 0, reserved: 0, seedSelf: 0, usernames: [] };
    const collect = async () => {
      const found = await page.evaluate(read);
      scan = found;
      for (const name of found.usernames) {
        if (seen.size >= cap) break;
        seen.add(name);
      }
    };
    await collect();
    for (let scroll = 0; scroll < SEED_NETWORK_SCROLL_LIMIT && seen.size < cap; scroll += 1) {
      const moved = await page.evaluate(scrollFollowingList);
      if (!moved && seen.size > 0) break;
      await page.waitForTimeout(SEED_NETWORK_POLL_MS);
      await collect();
    }
    const closed = await page.evaluate(closeFollowingList).catch(() => "escape");
    if (closed !== "close") await page.keyboard.press("Escape").catch(() => undefined);
    const usernames = [...seen];
    return {
      usernames,
      buttonFound: true,
      dialogOpened: true,
      profileLinksFound: scan.profileLinks,
      normalizedUsernames: scan.normalized,
      duplicates: scan.duplicates,
      reserved: scan.reserved,
      seedSelf: scan.seedSelf,
      alreadyKnown: 0,
      reason: usernames.length === 0 ? "dialog had no usable profile links" : "",
    };
  } catch {
    await page.keyboard.press("Escape").catch(() => undefined);
    return emptySeedNetworkRead("could not open following", { buttonFound: true });
  }
}
