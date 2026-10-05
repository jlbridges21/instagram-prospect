import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { pickSeed, seedCollectionResult, seedIsCooling } from "../lib/discovery/seeds";
import { isInstagramProfileHref } from "../worker/instagram/profile-href";
import {
  SEED_PAGE_EXPAND_SOURCE,
  SEED_PAGE_READER_SOURCE,
  applyEmptySeedCooldowns,
  emptySeedCooldownUntil,
  pollSeedRead,
  seedReadPlan,
  seedSuggestionLogLines,
  suggestionHeading,
  usernamesFromSeedRegions,
} from "../worker/instagram/seed-page";
import { clearEmptySeed, readEmptySeedCooldowns, rememberEmptySeed } from "../worker/discovery/seed-cooldowns";

const owner = "christopherhelkey";

assert.equal(isInstagramProfileHref("https://www.instagram.com/alpha/"), "alpha");
assert.equal(isInstagramProfileHref("/bravo/?hl=en"), "bravo");
assert.equal(isInstagramProfileHref("/Alpha.Media/"), "alpha.media");
assert.equal(isInstagramProfileHref("/christopherhelkey/", owner), null);
assert.equal(isInstagramProfileHref("/accounts/login/"), null);
assert.equal(isInstagramProfileHref("/explore/"), null);
assert.equal(isInstagramProfileHref("/reels/abc/"), null);
assert.equal(isInstagramProfileHref("/p/ABC123/"), null);
assert.equal(isInstagramProfileHref("/stories/alpha/"), null);
assert.equal(isInstagramProfileHref("/direct/inbox/"), null);
assert.equal(isInstagramProfileHref("/alpha/reels/"), null);
assert.equal(isInstagramProfileHref("/alpha/followers/"), null);
assert.equal(suggestionHeading("Suggested for you"), "suggested for you");
assert.equal(suggestionHeading("Related accounts"), "related accounts");
assert.equal(suggestionHeading("Home"), "");

const immediate = usernamesFromSeedRegions(owner, [
  {
    heading: "Suggested for you",
    links: [
      "/christopherhelkey/",
      "/accounts/",
      "/explore/",
      "/reels/clip/",
      "/p/post/",
      "/alpha/",
      "/bravo/",
    ],
  },
]);
assert.deepEqual(immediate.usernames, ["alpha", "bravo"]);
assert.equal(immediate.strategy, "suggestions-section");
assert.equal(immediate.rawLinks, 3);

const nearby = usernamesFromSeedRegions(owner, [
  { heading: "Similar accounts", links: ["/christopherhelkey/"], nearbyLinks: ["/charlie/", "/delta/"] },
]);
assert.deepEqual(nearby.usernames, ["charlie", "delta"]);
assert.equal(nearby.strategy, "nearby-cluster");

const widget = usernamesFromSeedRegions(owner, [
  { heading: "Related accounts", links: [], widgetLinks: ["/echo/"] },
]);
assert.deepEqual(widget.usernames, ["echo"]);
assert.equal(widget.strategy, "aria-widget");

const wide = usernamesFromSeedRegions(owner, [
  {
    heading: "Suggested for you",
    links: Array.from({ length: 20 }, (_, index) => `/person${index}/`),
    nearbyLinks: ["/kept/"],
  },
]);
assert.deepEqual(wide.usernames, ["kept"]);
assert.equal(wide.strategy, "nearby-cluster");

const none = usernamesFromSeedRegions(owner, [{ heading: "Posts", links: ["/stranger/"] }]);
assert.deepEqual(none.usernames, []);
const fallback = seedCollectionResult({ seedId: "seed-1", seedUsername: owner, usernames: none.usernames });
assert.equal(fallback.fallback, true);
assert.deepEqual(fallback.candidates, []);

async function main() {
const present = { url: "", headings: ["Suggested for you"], triggers: [], rawLinks: 2, usernames: ["alpha"], strategy: "suggestions-section" as const };
const delayed = { ...present, usernames: [] as string[], rawLinks: 0, strategy: "" as const };
let reads = 0;
let clock = 0;
const polled = await pollSeedRead({
  read: async () => {
    reads += 1;
    return reads < 3 ? delayed : present;
  },
  wait: async (ms) => {
    clock += ms;
  },
  budgetMs: 4000,
  intervalMs: 300,
  now: () => clock,
});
assert.deepEqual(polled.usernames, ["alpha"]);
assert.ok(clock <= 4000);
assert.equal(seedReadPlan({ usernames: [], triggers: ["Suggested for you"] }), "expand");
assert.equal(seedReadPlan({ usernames: ["alpha"], triggers: [] }), "read");
assert.equal(seedReadPlan({ usernames: [], triggers: [] }), "fallback");

const lines = seedSuggestionLogLines({
  username: owner,
  headings: [],
  triggers: [],
  rawLinks: 0,
  usable: [],
  openedTrigger: "",
  strategy: "",
});
assert.equal(lines[0], "Opening seed suggestions for @christopherhelkey");
assert.ok(lines.includes("No suggestion heading found."));
assert.ok(lines.includes("No related-account trigger found."));
assert.ok(lines.includes("Falling back."));

const reader = new Function(`return (${SEED_PAGE_READER_SOURCE})();`) as () => unknown;
const expander = new Function(`return (${SEED_PAGE_EXPAND_SOURCE})();`) as () => string;
assert.equal(typeof reader, "function");
assert.equal(typeof expander, "function");
assert.match(SEED_PAGE_EXPAND_SOURCE, /follow\|following\|message\|requested/);

const now = Date.parse("2026-10-05T20:00:00.000Z");
const until = emptySeedCooldownUntil(now);
assert.equal(Date.parse(until) - now, 45 * 60 * 1000);
const seeds = [
  { id: "a", username: "christopherhelkey", sourceType: "manual" as const, priority: "normal" as const, inspected: 0, review: 0, consecutiveUses: 0, active: true },
  { id: "b", username: "mpeacockmedia", sourceType: "manual" as const, priority: "normal" as const, inspected: 0, review: 0, consecutiveUses: 0, active: true },
];
const cooled = applyEmptySeedCooldowns(seeds, { christopherhelkey: until }, now);
assert.equal(seedIsCooling(cooled[0]!, new Date(now)), true);
assert.equal(seedIsCooling(cooled[1]!, new Date(now)), false);
const picked = pickSeed({
  seeds: cooled,
  minSample: 10,
  favorYield: true,
  yieldStrength: "medium",
  strategy: "balanced",
  cooldownCycles: 2,
  now: new Date(now),
  random: () => 0,
});
assert.equal(picked?.username, "mpeacockmedia");
const later = pickSeed({
  seeds: applyEmptySeedCooldowns(seeds, { christopherhelkey: until }, now + 46 * 60 * 1000),
  minSample: 10,
  favorYield: true,
  yieldStrength: "medium",
  strategy: "balanced",
  cooldownCycles: 2,
  now: new Date(now + 46 * 60 * 1000),
  random: () => 0,
});
assert.equal(later?.username, "christopherhelkey");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seed-cooldown-"));
const file = path.join(dir, "seed-read-cooldowns.json");
rememberEmptySeed(owner, now, file);
rememberEmptySeed(owner, now + 1000, file);
const stored = readEmptySeedCooldowns(now + 1000, file);
assert.equal(stored[owner], emptySeedCooldownUntil(now + 1000));
clearEmptySeed(owner, now + 1000, file);
assert.equal(readEmptySeedCooldowns(now + 1000, file)[owner], undefined);

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
const read = new Function(`return (${SEED_PAGE_READER_SOURCE})();`) as () => { usernames: string[]; headings: string[]; triggers: string[]; strategy: string };
const expand = new Function(`return (${SEED_PAGE_EXPAND_SOURCE})();`) as () => string;
let fixture = "";
await page.route("https://www.instagram.com/christopherhelkey/**", (route) => route.fulfill({ contentType: "text/html", body: fixture }));
async function show(body: string) {
  fixture = body;
  await page.goto("https://www.instagram.com/christopherhelkey/", { waitUntil: "domcontentloaded" });
}
await show(`<!doctype html><body>
  <nav><a href="/navuser/">nav</a></nav>
  <header><a href="/christopherhelkey/">seed</a><button>Follow</button></header>
  <section>
    <div role="button">Suggested for you</div>
    <div>
      <a href="/christopherhelkey/">seed</a>
      <a href="/accounts/login/">accounts</a>
      <a href="/explore/">explore</a>
      <a href="/reels/clip/">reels</a>
      <a href="/alpha/">alpha</a>
      <a href="/bravo/">bravo</a>
    </div>
  </section>
  <article><a href="/commenter/">commenter</a></article>
</body>`);
const shown = await page.evaluate(read);
assert.deepEqual(shown.usernames, ["alpha", "bravo"]);
assert.equal(shown.strategy, "suggestions-section");
assert.ok(shown.headings.some((heading) => heading.toLowerCase().includes("suggested for you")));

await show(`<!doctype html><body>
  <div role="button" id="open">Related accounts</div>
  <article><a href="/commenter/">commenter</a></article>
  <script>
    document.getElementById("open").addEventListener("click", () => {
      const box = document.createElement("div");
      box.innerHTML = '<a href="/gamma/">gamma</a><a href="/delta/">delta</a>';
      document.getElementById("open").insertAdjacentElement("afterend", box);
    });
  </script>
</body>`);
const closed = await page.evaluate(read);
assert.deepEqual(closed.usernames, []);
const openedName = await page.evaluate(expand);
assert.match(openedName.toLowerCase(), /related accounts/);
const opened = await page.evaluate(read);
assert.deepEqual(opened.usernames, ["gamma", "delta"]);

await show(`<!doctype html><body>
  <header><a href="/christopherhelkey/">seed</a></header>
  <article><a href="/commenter/">commenter</a></article>
</body>`);
const empty = await page.evaluate(read);
assert.deepEqual(empty.usernames, []);
assert.deepEqual(empty.headings, []);
assert.deepEqual(empty.triggers, []);
await browser.close();

console.log("seed page extraction tests passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
