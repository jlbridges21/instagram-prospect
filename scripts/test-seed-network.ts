import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
  chooseSeedNeighborhood,
  clampSeedNetworkSample,
  inspectionSeedId,
  prospectAttribution,
  seedCollectionResult,
  seedNetworkTake,
  seedStatForCandidate,
  shouldOpenSeedNetwork,
} from "../lib/discovery/seeds";
import { followingUsernames, SEED_NETWORK_OPEN_SOURCE, SEED_NETWORK_READER_SOURCE } from "../worker/instagram/seed-network";
import { CandidateQueue, type DiscoveryCandidate } from "../worker/discovery/queue";

const suggestions = seedCollectionResult({
  seedId: "seed-a",
  seedUsername: "bigmikethedroneguy",
  usernames: ["alpha", "bigmikethedroneguy"],
  source: "seed_suggestion",
});
assert.equal(shouldOpenSeedNetwork(suggestions.candidates.length, true), false);
assert.equal(chooseSeedNeighborhood({ suggestionCount: 2, networkEnabled: true, networkCount: 9, profileOpened: true }).path, "seed_suggestion");
assert.equal(chooseSeedNeighborhood({ suggestionCount: 2, networkEnabled: true, networkCount: 9, profileOpened: true }).openNetwork, false);

const network = seedCollectionResult({
  seedId: "seed-a",
  seedUsername: "bigmikethedroneguy",
  usernames: ["bigmikethedroneguy", "alpha", "alpha", "bravo"],
  source: "seed_network",
});
assert.equal(network.fallback, false);
assert.deepEqual(network.candidates.map((item) => item.username), ["alpha", "bravo"]);
assert.equal(network.candidates[0]?.source, "seed_network");
assert.equal(network.candidates[0]?.sourceSeedId, "seed-a");
assert.equal(network.candidates[0]?.sourceSeedUsername, "bigmikethedroneguy");
assert.equal(chooseSeedNeighborhood({ suggestionCount: 0, networkEnabled: true, networkCount: network.candidates.length, profileOpened: true }).cooldown, false);
assert.equal(chooseSeedNeighborhood({ suggestionCount: 0, networkEnabled: true, networkCount: network.candidates.length, profileOpened: true }).path, "seed_network");

const queued = candidate({
  username: "alpha",
  source: "seed_network",
  sourceSeedId: "seed-a",
  sourceSeedUsername: "bigmikethedroneguy",
});
const queue = new CandidateQueue(10);
assert.equal(queue.enqueue(queued), "queued");
assert.equal(queue.enqueue(queued), "duplicate");
const restored = new CandidateQueue(10);
const saved = JSON.parse(JSON.stringify({ pending: queue.pendingCandidates() })) as { pending: DiscoveryCandidate[] };
for (const item of saved.pending) restored.enqueue(item);
const currentSeedAtInspection = "seed-b";
const claimed = restored.claim("profile-tab-1");
assert.equal(inspectionSeedId(claimed!), "seed-a");
assert.notEqual(inspectionSeedId(claimed!), currentSeedAtInspection);
assert.equal(prospectAttribution(claimed!).source, "seed_network");
assert.equal(prospectAttribution(claimed!).source_seed_id, "seed-a");
assert.equal(seedStatForCandidate("queued").inspected, 0);
assert.equal(seedStatForCandidate("duplicate_skipped").inspected, 0);

const emptyNetwork = seedCollectionResult({
  seedId: "seed-a",
  seedUsername: "bigmikethedroneguy",
  usernames: ["bigmikethedroneguy"],
  source: "seed_network",
});
assert.equal(emptyNetwork.fallback, true);
const fallback = chooseSeedNeighborhood({ suggestionCount: 0, networkEnabled: true, networkCount: 0, profileOpened: true });
assert.equal(fallback.fallback, true);
assert.equal(fallback.cooldown, true);
assert.equal(inspectionSeedId(candidate({ username: "generic", source: "suggested_accounts" })), null);

assert.equal(clampSeedNetworkSample(15), 15);
assert.equal(clampSeedNetworkSample(1), 5);
assert.equal(clampSeedNetworkSample(80), 30);
assert.equal(seedNetworkTake({ configured: 15, queueRoom: 4 }), 4);
assert.equal(seedNetworkTake({ configured: 15, queueRoom: 40 }), 15);
assert.equal(seedNetworkTake({ configured: 15, queueRoom: 0 }), 0);

assert.deepEqual(
  followingUsernames(["/bigmikethedroneguy/", "/accounts/", "/alpha/reels/", "/alpha/", "/alpha/", "/bravo/"], "bigmikethedroneguy", 15),
  ["alpha", "bravo"],
);
assert.deepEqual(followingUsernames(["/one/", "/two/", "/three/"], "seed", 2), ["one", "two"]);

async function main() {
const openList = new Function(`return (${SEED_NETWORK_OPEN_SOURCE})();`) as () => string;
const readList = new Function(`return (${SEED_NETWORK_READER_SOURCE})(15);`) as () => { usernames: string[]; seedSelf: number; reserved: number };
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
let body = "";
await page.route("https://www.instagram.com/**", (route) => route.fulfill({ contentType: "text/html", body }));
body = `<!doctype html><body>
  <a href="/bigmikethedroneguy/followers/">120 followers</a>
  <a href="/bigmikethedroneguy/following/" id="following">340 following</a>
  <button id="follow">Follow</button>
  <script>
    window.__clicked = "";
    document.getElementById("follow").addEventListener("click", () => { window.__clicked = "follow"; });
    document.getElementById("following").addEventListener("click", (event) => { window.__clicked = "following"; event.preventDefault(); });
  </script>
</body>`;
await page.goto("https://www.instagram.com/bigmikethedroneguy/", { waitUntil: "domcontentloaded" });
const opened = await page.evaluate(openList);
const clicked = await page.evaluate("window.__clicked");
assert.equal(opened, "following");
assert.equal(clicked, "following");

body = `<!doctype html><body>
  <button id="relationship">Following</button>
  <a href="#" id="count">163 following</a>
  <script>
    window.__clicked = "";
    document.getElementById("relationship").addEventListener("click", () => { window.__clicked = "relationship"; });
    document.getElementById("count").addEventListener("click", (event) => { window.__clicked = "count"; event.preventDefault(); });
  </script>
</body>`;
await page.goto("https://www.instagram.com/bigmikethedroneguy/", { waitUntil: "domcontentloaded" });
const countOpened = await page.evaluate(openList);
const countClicked = await page.evaluate("window.__clicked");
assert.equal(countOpened, "following");
assert.equal(countClicked, "count");

const links = Array.from({ length: 20 }, (_, index) => `<a href="/pilot${index}/">pilot${index}</a>`).join("");
body = `<!doctype html><body>
  <nav><a href="/navuser/">nav</a></nav>
  <div role="dialog">
    <h2>Following</h2>
    <a href="/bigmikethedroneguy/">seed</a>
    <a href="/accounts/login/">accounts</a>
    <a href="/explore/">explore</a>
    ${links}
    <span>Suggested for you</span>
    <a href="/suggestedlate/">suggestedlate</a>
    <button>Follow</button>
  </div>
</body>`;
await page.goto("https://www.instagram.com/bigmikethedroneguy/following/", { waitUntil: "domcontentloaded" });
const scanned = await page.evaluate(readList);
const names = scanned.usernames;
assert.ok(scanned.seedSelf >= 1);
assert.ok(scanned.reserved >= 1);
assert.equal(names.length, 15);
assert.equal(names.includes("bigmikethedroneguy"), false);
assert.equal(names.includes("navuser"), false);
assert.equal(names.includes("suggestedlate"), false);
assert.equal(names[0], "pilot0");
await browser.close();

console.log("seed network tests passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

function candidate(input: Pick<DiscoveryCandidate, "username" | "source"> & Partial<DiscoveryCandidate>): DiscoveryCandidate {
  return {
    username: input.username,
    profileUrl: `https://www.instagram.com/${input.username}/`,
    source: input.source,
    sourcePostUrl: null,
    sourceThumbnailUrl: null,
    discoveredAt: "2026-10-05T00:00:00.000Z",
    sourceSeedId: input.sourceSeedId ?? null,
    sourceSeedUsername: input.sourceSeedUsername ?? null,
  };
}
