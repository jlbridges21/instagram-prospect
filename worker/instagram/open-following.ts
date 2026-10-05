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
} from "./seed-network";

const openFollowingList = new Function(`return (${SEED_NETWORK_OPEN_SOURCE})();`) as () => string;
const scrollFollowingList = new Function(`return (${SEED_NETWORK_SCROLL_SOURCE})();`) as () => boolean;
const closeFollowingList = new Function(`return (${SEED_NETWORK_CLOSE_SOURCE})();`) as () => string;

function readFollowingList(limit: number) {
  const cap = Math.max(0, Math.floor(limit));
  return new Function(`return (${SEED_NETWORK_READER_SOURCE})(${cap});`) as () => string[];
}

export async function openSeedFollowing(page: Page, username: string, limit: number) {
  const owner = normalizeInstagramUsername(username);
  const cap = Math.max(0, Math.floor(limit));
  const empty = { usernames: [] as string[], opened: false };
  if (!owner || cap === 0) return empty;
  try {
    const opened = await page.evaluate(openFollowingList);
    if (opened !== "following") return empty;
    const read = readFollowingList(cap);
    const seen = new Set<string>();
    const collect = async () => {
      const found = await page.evaluate(read);
      for (const name of found) {
        if (seen.size >= cap) break;
        seen.add(name);
      }
    };
    const started = Date.now();
    await collect();
    while (seen.size === 0 && Date.now() - started < SEED_NETWORK_OPEN_WAIT_MS) {
      await page.waitForTimeout(SEED_NETWORK_POLL_MS);
      await collect();
    }
    for (let scroll = 0; scroll < SEED_NETWORK_SCROLL_LIMIT && seen.size < cap; scroll += 1) {
      const moved = await page.evaluate(scrollFollowingList);
      if (!moved && seen.size > 0) break;
      await page.waitForTimeout(SEED_NETWORK_POLL_MS);
      await collect();
    }
    const closed = await page.evaluate(closeFollowingList).catch(() => "escape");
    if (closed !== "close") await page.keyboard.press("Escape").catch(() => undefined);
    return { usernames: [...seen], opened: true };
  } catch {
    await page.keyboard.press("Escape").catch(() => undefined);
    return empty;
  }
}
