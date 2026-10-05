import assert from "node:assert/strict";
import { acquisitionDecision, queueThresholds, rollingHourInspectionCount } from "../lib/discovery/pacing";
import { shouldSkipKnownProspect, suppressionStillActive } from "../lib/prospects/discovery-check";
import { emptySeedNetworkRead } from "../worker/instagram/seed-network";
import { CandidateQueue, SessionUsernameCache, unseenUsernames, type DiscoveryCandidate } from "../worker/discovery/queue";

const home = candidate("example", "home_feed", 1);
const queue = new CandidateQueue(8);
const cache = new SessionUsernameCache();
assert.equal(queue.enqueue(home), "queued");
cache.remember(home.username);
const suggested = unseenUsernames(["example", "other"], cache, queue);
assert.deepEqual(suggested.fresh, ["other"]);
assert.equal(suggested.skippedFromCache, 1);

cache.remember("example");
const saved = {
  pending: queue.pendingCandidates(),
  seen: [...new Set([...cache.usernames(), ...queue.seenUsernames()])],
};
const laterCache = new SessionUsernameCache();
const laterQueue = new CandidateQueue(8);
laterCache.load(saved.seen);
for (const item of saved.pending) {
  laterQueue.enqueue(item);
  laterCache.remember(item.username);
}
const again = unseenUsernames(["example"], laterCache, laterQueue);
assert.deepEqual(again.fresh, []);
assert.equal(again.skippedFromCache, 1);

assert.equal(shouldSkipKnownProspect({
  exists: true,
  status: "disqualified",
  alreadyFollowing: false,
  alreadyContacted: false,
  discoveredAt: null,
  analyzed: false,
  cooldownDays: 30,
}), true);
assert.equal(suppressionStillActive({ permanent: true, expiresAt: null }), true);
assert.equal(suppressionStillActive({ permanent: false, expiresAt: new Date(Date.now() - 1000).toISOString() }), false);

const marks = queueThresholds(8);
assert.equal(marks.highWater, 8);
assert.equal(marks.lowWater, 3);
assert.equal(acquisitionDecision({ pending: 8, highWater: marks.highWater, lowWater: marks.lowWater, holding: false, hourlyFull: false }).acquire, false);
assert.equal(acquisitionDecision({ pending: 2, highWater: marks.highWater, lowWater: marks.lowWater, holding: true, hourlyFull: false }).acquire, true);

const ranked = new CandidateQueue(8);
ranked.enqueue(candidate("lowvalue", "suggested_accounts", 2, "2026-10-05T18:00:00.000Z"));
ranked.enqueue(candidate("better", "suggested_accounts", 40, "2026-10-05T18:05:00.000Z"));
assert.equal(ranked.claim("profile-tab-1")?.username, "better");

const now = Date.parse("2026-10-05T20:00:00.000Z");
const recent = Array.from({ length: 10 }, (_, index) => now - index * 1000);
const stamps = [now - 2 * 60 * 60 * 1000, now - 90 * 60 * 1000, ...recent];
assert.equal(rollingHourInspectionCount(stamps, now), 10);
assert.notEqual(rollingHourInspectionCount(stamps, now), stamps.length);

const missing = emptySeedNetworkRead("no following link");
assert.equal(missing.buttonFound, false);
assert.equal(missing.reason, "no following link");
const timeout = emptySeedNetworkRead("timeout waiting for dialog", { buttonFound: true });
assert.equal(timeout.buttonFound, true);
assert.equal(timeout.dialogOpened, false);
assert.equal(timeout.reason, "timeout waiting for dialog");

console.log("discovery stability tests passed");

function candidate(username: string, source: DiscoveryCandidate["source"], score = 0, discoveredAt = "2026-10-05T18:00:00.000Z"): DiscoveryCandidate {
  return {
    username,
    profileUrl: `https://www.instagram.com/${username}/`,
    source,
    sourcePostUrl: null,
    sourceThumbnailUrl: null,
    discoveredAt,
    priorityScore: score,
  };
}
