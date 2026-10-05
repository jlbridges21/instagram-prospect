import type { Page } from "playwright";
import type { DomSnapshot } from "./types";
import { normalizeInstagramUsername } from "./profile-href";
import {
  SEED_PAGE_EXPAND_SOURCE,
  SEED_PAGE_READER_SOURCE,
  SEED_SUGGESTION_EXPAND_WAIT_MS,
  SEED_SUGGESTION_POLL_MS,
  SEED_SUGGESTION_WAIT_MS,
  pollSeedRead,
  seedReadPlan,
  seedSuggestionLogLines,
  type SeedReadSnapshot,
} from "./seed-page";

const readSeedPage = new Function(`return (${SEED_PAGE_READER_SOURCE})();`) as () => SeedReadSnapshot;
const expandSeedPage = new Function(`return (${SEED_PAGE_EXPAND_SOURCE})();`) as () => string;

function snapshotFromSuggestions(url: string, usernames: string[]): DomSnapshot {
  return {
    url,
    title: "",
    bodyText: "",
    links: [],
    buttons: [],
    images: [],
    textboxes: [],
    articles: [],
    hasPasswordField: false,
    threadMessages: [],
    bioText: null,
    suggestedProfiles: usernames.map((username) => ({
      username,
      href: `https://www.instagram.com/${username}/`,
    })),
  };
}

export async function openSeedSuggestions(
  page: Page,
  username: string,
  options?: { log?: (line: string) => void },
) {
  const owner = normalizeInstagramUsername(username);
  await page.goto(`https://www.instagram.com/${owner}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
  let openedTrigger = "";
  let reading = await pollSeedRead({
    read: () => page.evaluate(readSeedPage),
    wait: (ms) => page.waitForTimeout(ms),
    budgetMs: SEED_SUGGESTION_WAIT_MS,
    intervalMs: SEED_SUGGESTION_POLL_MS,
  });
  if (seedReadPlan(reading) === "expand") {
    openedTrigger = await page.evaluate(expandSeedPage);
    if (openedTrigger) {
      reading = await pollSeedRead({
        read: () => page.evaluate(readSeedPage),
        wait: (ms) => page.waitForTimeout(ms),
        budgetMs: SEED_SUGGESTION_EXPAND_WAIT_MS,
        intervalMs: SEED_SUGGESTION_POLL_MS,
      });
    }
  }
  const strategy = openedTrigger && reading.usernames.length > 0 ? "expanded-control" : reading.strategy;
  const lines = seedSuggestionLogLines({
    username: owner,
    headings: reading.headings,
    triggers: reading.triggers,
    rawLinks: reading.rawLinks,
    usable: reading.usernames,
    openedTrigger,
    strategy,
  });
  const log = options?.log ?? console.log;
  for (const line of lines) log(line);
  return {
    snapshot: snapshotFromSuggestions(reading.url || page.url(), reading.usernames),
    usernames: reading.usernames,
    headings: reading.headings,
    triggers: reading.triggers,
    strategy,
  };
}
