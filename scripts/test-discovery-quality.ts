import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scoreCandidate, pickWeightedIndex } from "../lib/discovery/candidate-priority";
import { DEFAULT_NEGATIVE_KEYWORDS, DEFAULT_POSITIVE_KEYWORDS, CANDIDATE_POOL_TARGET } from "../lib/discovery/defaults";
import { suggestPositiveKeywords } from "../lib/discovery/keyword-suggestions";
import { optimizationComparison, qualityYield } from "../lib/discovery/quality";
import { poolCollectionDecision } from "../lib/discovery/pacing";
import { claimPaceDecision, outreachStallDecision } from "../lib/outreach/pace";
import { classifyMessagingBlock } from "../lib/outreach/dm";
import { CandidateQueue, mergeCandidateEvidence, type DiscoveryCandidate } from "../worker/discovery/queue";
import { clearEmptySeed, readEmptySeedCooldowns, recordUnproductiveSeed } from "../worker/discovery/seed-cooldowns";
import { SEED_NETWORK_SCROLL_LIMIT } from "../worker/instagram/seed-network";
import { absorbFollowingViewport, followingScrollDecision } from "../worker/instagram/seed-network";

const keywords = { positiveKeywords: [...DEFAULT_POSITIVE_KEYWORDS], negativeKeywords: [...DEFAULT_NEGATIVE_KEYWORDS] };

assert.equal(CANDIDATE_POOL_TARGET, 25);
assert.equal(poolCollectionDecision({ size: 30, lowWater: 10, highWater: 30 }).collect, false);
assert.equal(poolCollectionDecision({ size: 9, lowWater: 10, highWater: 30 }).collect, true);
assert.equal(poolCollectionDecision({ size: 18, lowWater: 10, highWater: 30 }).collect, true);

const pool = new CandidateQueue(30);
for (const [username, score] of [["weak-a", 8], ["weak-b", 12], ["weak-c", 18]] as const) {
  pool.place(candidate(username, "home_feed", score), 35);
}
for (let index = 0; index < 10; index += 1) pool.place(candidate(`better-${index}`, "suggested_accounts", 40 + index), 35);
assert.equal(pool.claim("profile-tab-1", { floor: 35, explore: false })?.username, "better-9");

const known = new Set(Array.from({ length: 12 }, (_, index) => `known-${index}`));
const first = absorbFollowingViewport({ visible: [...known], isKnown: (name) => known.has(name), collected: [], target: 15 });
assert.equal(first.collected.length, 0);
assert.equal(followingScrollDecision({ newCount: 0, target: 15, scrolls: 0, maxScrolls: 6, staleScrolls: 0, staleLimit: 2, timedOut: false }), "scroll");
const second = absorbFollowingViewport({ visible: [...known, "new-pilot"], isKnown: (name) => known.has(name), collected: first.collected, target: 15 });
assert.deepEqual(second.collected, ["new-pilot"]);
assert.equal(followingScrollDecision({ newCount: 0, target: 15, scrolls: 2, maxScrolls: 6, staleScrolls: 2, staleLimit: 2, timedOut: false }), "no_new_usernames");
assert.equal(SEED_NETWORK_SCROLL_LIMIT, 6);

const cooldownFile = path.join(os.tmpdir(), `seed-exhaustion-${process.pid}.json`);
const now = Date.parse("2026-10-06T15:00:00.000Z");
const firstEmpty = recordUnproductiveSeed("air4future", now, cooldownFile);
assert.equal(firstEmpty.emptyVisits, 1);
assert.equal(firstEmpty.minutes, 45);
const secondEmpty = recordUnproductiveSeed("air4future", now + 1000, cooldownFile);
assert.equal(secondEmpty.emptyVisits, 2);
assert.equal(secondEmpty.minutes, 120);
assert.ok(readEmptySeedCooldowns(now + 1000, cooldownFile).air4future);
clearEmptySeed("air4future", now + 1000, cooldownFile);
const reset = recordUnproductiveSeed("air4future", now + 2000, cooldownFile);
assert.equal(reset.emptyVisits, 1);
assert.equal(reset.minutes, 45);
fs.unlinkSync(cooldownFile);

const one = scoreCandidate({ source: "seed", seedUsername: "a", username: "drone_media", seedSupportCount: 1, seedMature: true, seedYield: 0.1, ...keywords });
const three = scoreCandidate({ source: "seed", seedUsername: "a", username: "drone_media", seedSupportCount: 3, seedMature: true, seedYield: 0.1, ...keywords });
assert.ok(three.score > one.score);
assert.ok(three.network > one.network);
const home = candidate("overlap", "home_feed", 10);
const seedA = candidate("overlap", "seed_network", 40, { sourceSeedUsername: "seeda" });
const seedB = candidate("overlap", "seed_suggestion", 40, { sourceSeedUsername: "seedb" });
const seedC = candidate("overlap", "seed_network", 40, { sourceSeedUsername: "seedc" });
const merged = mergeCandidateEvidence(mergeCandidateEvidence(mergeCandidateEvidence(home, seedA), seedB), seedC);
assert.equal(merged.seedSupport?.length, 3);

const hobby = scoreCandidate({ source: "seed", seedUsername: "hobby", username: "fpvhobby", cardText: "FPV freestyle racing hobby", seedSupportCount: 1, ...keywords });
const services = scoreCandidate({ source: "seed", seedUsername: "services", username: "coastaldrone", cardText: "Commercial drone services for real estate production", seedSupportCount: 1, ...keywords });
const cinematographer = scoreCandidate({ source: "suggested_accounts", username: "propertyfpv", cardText: "FPV cinematographer", ...keywords });
const plainFpv = scoreCandidate({ source: "suggested_accounts", username: "propertyfpv", cardText: "FPV", ...keywords });
assert.ok(hobby.niche >= 50);
assert.ok(hobby.commercial < 30);
assert.ok(services.niche >= 50);
assert.ok(services.commercial >= 60);
assert.ok(services.score > hobby.score);
assert.ok(cinematographer.score > plainFpv.score);

const observations = [
  ...Array.from({ length: 10 }, () => ({ status: "approved" as const, text: "aerial property media real estate photography" })),
  { status: "skipped" as const, text: "fitness meme gaming" },
];
const suggested = suggestPositiveKeywords({ observations, existingKeywords: ["drone"], ignored: [], minimum: 10 });
assert.ok(suggested.includes("aerial"));
assert.equal(suggestPositiveKeywords({ observations: observations.slice(0, 3), existingKeywords: [], ignored: [], minimum: 10 }).length, 0);
const accepted = ["drone", ...suggested.filter((term) => term === "aerial")];
assert.equal(suggestPositiveKeywords({ observations, existingKeywords: accepted, ignored: ["property"], minimum: 10 }).includes("aerial"), false);

const blocked = new CandidateQueue(10);
blocked.place(candidate("junk", "home_feed", 8), 35);
assert.equal(blocked.claim("profile-tab-1", { floor: 35, explore: true, explorationFloor: 20, random: 0.99 }), null);
let higher = 0;
let lower = 0;
const choices = [33, 27, 21];
for (let step = 0; step < 1000; step += 1) {
  const picked = choices[pickWeightedIndex(choices, step / 1000)];
  if (picked === 33) higher += 1;
  if (picked === 21) lower += 1;
}
assert.ok(higher > lower);

const kpi = qualityYield({ inspected: 100, review: 20, approved: 12 });
assert.equal(kpi.reviewYield, 0.2);
assert.equal(kpi.approvalYield, 0.12);
assert.equal(optimizationComparison({ before: { inspected: 50, review: 5, approved: 2 }, after: { inspected: 80, review: 20, approved: 12 } }).ready, false);
assert.equal(optimizationComparison({ before: { inspected: 50, review: 5, approved: 2 }, after: { inspected: 120, review: 30, approved: 18 } }).ready, true);

const spacing = Date.parse("2026-10-06T16:00:00.000Z");
assert.equal(outreachStallDecision({ now: spacing, nextEligibleAt: spacing + 60_000, lastProgressAt: spacing - 10 * 60_000, blocked: false }).stalled, false);
assert.equal(outreachStallDecision({ now: spacing + 4 * 60_000, nextEligibleAt: spacing, lastProgressAt: spacing - 10 * 60_000, blocked: false }).stalled, true);
assert.equal(classifyMessagingBlock({ explicitUnavailable: true, messageActionFound: false, composerFound: false, threadOpened: false })?.code, "message_unavailable");
assert.equal(classifyMessagingBlock({ explicitUnavailable: false, messageActionFound: true, composerFound: false, threadOpened: true })?.code, "composer_unavailable");

const paceNow = new Date("2026-10-06T15:00:00.000Z");
const pace = claimPaceDecision({
  now: paceNow,
  timeZone: "UTC",
  minimumSpacingSeconds: 0,
  hourlyMaximum: 20,
  dailyMaximum: 100,
  completedSendTimes: [],
  jobs: [
    job("fresh", "p1", "pending", paceNow.toISOString()),
    job("retry", "p2", "retry_wait", new Date(paceNow.getTime() + 30 * 60_000).toISOString()),
  ],
});
assert.equal(pace.action, "claim");
assert.equal(pace.username, "fresh");

console.log("discovery quality tests passed");

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

function job(username: string, prospectId: string, status: string, availableAt: string) {
  return {
    id: username,
    prospectId,
    username,
    jobType: "verify_profile",
    status,
    scheduledFor: availableAt,
    availableAt,
    createdAt: availableAt,
  };
}
