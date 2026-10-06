import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoveryStallDecision } from "../lib/discovery/cadence";
import { CANDIDATE_POOL_TARGET, candidateExplorationPercent } from "../lib/discovery/defaults";
import { inspectedTodayAfterTurn, shouldFlushDiscoveryUsage } from "../lib/discovery/inspection-count";
import { pickSeed, seedRank, type RankableSeed } from "../lib/discovery/seeds";
import { CandidateQueue, type DiscoveryCandidate } from "../worker/discovery/queue";
import { rememberEmptySeed, readEmptySeedCooldowns } from "../worker/discovery/seed-cooldowns";
import { applyEmptySeedCooldowns, seedTurnOutcome } from "../worker/instagram/seed-page";
import { absorbFollowingViewport, followingScrollDecision } from "../worker/instagram/seed-network";

assert.equal(shouldFlushDiscoveryUsage({ profileOpens: 1, aiQualifications: 0 }), true);
assert.equal(shouldFlushDiscoveryUsage({ profileOpens: 0, aiQualifications: 0 }), false);
assert.equal(inspectedTodayAfterTurn(0, 1), 1);
assert.equal(inspectedTodayAfterTurn(4, 0), 4);

const known = new Set(["known-a", "known-b", "known-c"]);
const firstViewport = absorbFollowingViewport({
  visible: [...known],
  isKnown: (name) => known.has(name),
  collected: [],
  target: 15,
});
assert.deepEqual(firstViewport.collected, []);
assert.equal(followingScrollDecision({
  newCount: firstViewport.collected.length,
  target: 15,
  scrolls: 0,
  maxScrolls: 8,
  staleScrolls: 0,
  staleLimit: 2,
  timedOut: false,
}), "scroll");
const afterScroll = absorbFollowingViewport({
  visible: [...known, "new-account"],
  isKnown: (name) => known.has(name),
  collected: firstViewport.collected,
  target: 15,
});
assert.deepEqual(afterScroll.collected, ["new-account"]);
assert.equal(followingScrollDecision({ newCount: 15, target: 15, scrolls: 3, maxScrolls: 8, staleScrolls: 0, staleLimit: 2, timedOut: false }), "target");
assert.equal(followingScrollDecision({ newCount: 2, target: 15, scrolls: 8, maxScrolls: 8, staleScrolls: 0, staleLimit: 2, timedOut: false }), "max_scrolls");
assert.equal(followingScrollDecision({ newCount: 0, target: 15, scrolls: 2, maxScrolls: 8, staleScrolls: 2, staleLimit: 2, timedOut: false }), "no_new_usernames");
assert.equal(followingScrollDecision({ newCount: 1, target: 15, scrolls: 1, maxScrolls: 8, staleScrolls: 0, staleLimit: 2, timedOut: true }), "timeout");

assert.equal(seedTurnOutcome({ newAfterDedupe: 0, queuedAboveFloor: 0 }), "empty");
assert.equal(seedTurnOutcome({ newAfterDedupe: 1, queuedAboveFloor: 0 }), "unhelpful");
assert.equal(seedTurnOutcome({ newAfterDedupe: 1, queuedAboveFloor: 1 }), "productive");

const now = new Date("2026-10-06T15:00:00.000Z");
const cooldownFile = path.join(os.tmpdir(), `seed-read-cooldowns-${process.pid}.json`);
rememberEmptySeed("air4future", now.getTime(), cooldownFile);
const pauses = readEmptySeedCooldowns(now.getTime(), cooldownFile);
const cooled = applyEmptySeedCooldowns([seed("air4future", 3, 0), seed("otherseed", 3, 0)], pauses, now.getTime());
const next = pickSeed({
  seeds: cooled,
  minSample: 10,
  favorYield: true,
  yieldStrength: "medium",
  strategy: "balanced",
  cooldownCycles: 2,
  now,
  random: () => 0,
});
assert.equal(next?.username, "otherseed");
fs.unlinkSync(cooldownFile);

const floor = 35;
const below = new CandidateQueue(10);
below.place(candidate("joecarm.mp4", "suggested_accounts", 8), floor);
assert.equal(below.claim("profile-tab-1", { floor, explore: false }), null);
const exploredJunk = below.claim("profile-tab-1", { floor, explore: true, explorationFloor: 20, random: 0 });
assert.equal(exploredJunk, null);

const weighted = new CandidateQueue(10);
weighted.place(candidate("eight", "home_feed", 8), floor);
weighted.place(candidate("twelve", "suggested_accounts", 12), floor);
weighted.place(candidate("twenty", "home_feed", 20), floor);
weighted.place(candidate("thirty", "seed_network", 30, { sourceSeedId: "seed-air", sourceSeedUsername: "air4future" }), floor);
assert.equal(weighted.claim("profile-tab-1", { floor, explore: false, explorationFloor: 20 }), null);
const explored = weighted.claim("profile-tab-1", { floor, explore: true, explorationFloor: 20, random: 0 });
assert.equal(explored?.username, "thirty");
assert.equal(explored?.inspectionSelection, "exploration");
assert.equal(explored?.sourceSeedId, "seed-air");
assert.equal(explored?.sourceSeedUsername, "air4future");
const besideRanked = new CandidateQueue(10);
besideRanked.place(candidate("eight", "home_feed", 8), floor);
besideRanked.place(candidate("thirty", "suggested_accounts", 30), floor);
besideRanked.place(candidate("ranked", "seed_network", 80, { sourceSeedId: "seed-ranked", sourceSeedUsername: "coastal" }), floor);
const beside = besideRanked.claim("profile-tab-1", { floor, explore: true, explorationFloor: 20, random: 0 });
assert.equal(beside?.username, "thirty");
assert.equal(beside?.inspectionSelection, "exploration");

const slot = 1_000_000;
const intervalMs = 120_000;
const grace = intervalMs * 3;
const overdueAt = slot - grace - 1;
const active = discoveryStallDecision({
  now: slot,
  nextInspectionAt: overdueAt,
  intervalMs,
  blocked: false,
  overdueSince: overdueAt,
  lastProgressAt: slot - 30_000,
});
assert.equal(active.stalled, false);
const quiet = discoveryStallDecision({
  now: slot,
  nextInspectionAt: overdueAt,
  intervalMs,
  blocked: false,
  overdueSince: overdueAt,
  lastProgressAt: slot - grace - 1,
});
assert.equal(quiet.stalled, true);

assert.equal(CANDIDATE_POOL_TARGET, 25);
const pool = new CandidateQueue(30);
pool.place(candidate("home-low", "home_feed", 40), floor);
pool.place(candidate("suggested-mid", "suggested_accounts", 55), floor);
pool.place(candidate("seed-best", "seed_network", 80, { sourceSeedId: "seed-1", sourceSeedUsername: "itselijones" }), floor);
const best = pool.claim("profile-tab-1", { floor, explore: true });
assert.equal(best?.username, "seed-best");
assert.equal(best?.inspectionSelection, "ranked");
assert.equal(best?.source, "seed_network");
assert.equal(best?.sourceSeedId, "seed-1");
assert.equal(best?.sourceSeedUsername, "itselijones");

assert.equal(candidateExplorationPercent("conservative"), 10);
assert.equal(candidateExplorationPercent("balanced"), 20);
assert.equal(candidateExplorationPercent("exploratory"), 35);
const immatureHigh = seedRank(seed("new-a", 2, 2), { minSample: 10, favorYield: true, yieldStrength: "medium" });
const immatureLow = seedRank(seed("new-b", 2, 0), { minSample: 10, favorYield: true, yieldStrength: "medium" });
assert.equal(immatureHigh.score, immatureLow.score);
const matureHigh = seedRank(seed("proven-a", 20, 10), { minSample: 10, favorYield: true, yieldStrength: "medium" });
const matureLow = seedRank(seed("proven-b", 20, 1), { minSample: 10, favorYield: true, yieldStrength: "medium" });
assert.ok(matureHigh.score > matureLow.score);

console.log("discovery audit tests passed");

function seed(username: string, inspected: number, review: number): RankableSeed {
  return {
    id: username,
    username,
    sourceType: "manual",
    active: true,
    priority: "normal",
    inspected,
    review,
    consecutiveUses: 0,
  };
}

function candidate(username: string, source: DiscoveryCandidate["source"], score: number, extra: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return {
    username,
    profileUrl: `https://www.instagram.com/${username}/`,
    source,
    sourcePostUrl: null,
    sourceThumbnailUrl: null,
    discoveredAt: "2026-10-06T15:00:00.000Z",
    priorityScore: score,
    ...extra,
  };
}
