import assert from "node:assert/strict";
import fs from "node:fs";
import { scoreCandidate } from "../lib/discovery/candidate-priority";
import { clampTuning, recommendedTuning } from "../lib/discovery/defaults";
import { recordInspection, releaseProspect, syncStatus, type SeedCounters } from "../lib/discovery/seed-counts";
import {
  normalizeSeedUsername,
  pickSeed,
  prospectAttribution,
  reviewYield,
  seedRank,
  seedStatForCandidate,
  shouldAutoPromote,
  uniqueSeedUsernames,
  type RankableSeed,
} from "../lib/discovery/seeds";
import { pickCollectionSource } from "../lib/discovery/source-ranking";

assert.equal(normalizeSeedUsername("@Foo"), "foo");
assert.equal(normalizeSeedUsername("foo"), "foo");
assert.equal(normalizeSeedUsername("https://instagram.com/foo"), "foo");
assert.equal(normalizeSeedUsername("instagram.com/foo/"), "foo");
assert.deepEqual(uniqueSeedUsernames("@foo\nfoo\nhttps://www.instagram.com/foo/\n@bar"), ["foo", "bar"]);

const base = {
  enabled: true,
  qualified: true,
  fitScore: 80,
  fitLabel: "strong_fit",
  minScore: 75,
  promoteStrong: true,
  promotePossible: false,
  requiresApproved: false,
  approved: false,
  disqualified: false,
  alreadyFollowing: false,
};
assert.equal(shouldAutoPromote(base), true);
assert.equal(shouldAutoPromote({ ...base, fitScore: 70 }), false);
assert.equal(shouldAutoPromote({ ...base, enabled: false }), false);
assert.equal(shouldAutoPromote({ ...base, fitLabel: "possible_fit" }), false);
assert.equal(shouldAutoPromote({ ...base, disqualified: true }), false);
assert.equal(shouldAutoPromote({ ...base, alreadyFollowing: true }), false);
assert.equal(shouldAutoPromote({ ...base, requiresApproved: true, approved: false }), false);
assert.equal(shouldAutoPromote({ ...base, requiresApproved: true, approved: true }), true);

function seed(partial: Partial<RankableSeed> & Pick<RankableSeed, "id">): RankableSeed {
  return {
    username: partial.id,
    sourceType: "manual",
    active: true,
    priority: "normal",
    inspected: 0,
    review: 0,
    consecutiveUses: 0,
    ...partial,
  };
}

const immature = seedRank(seed({ id: "new", inspected: 3, review: 2 }), { minSample: 10, favorYield: true, yieldStrength: "medium" });
const strong = seedRank(seed({ id: "strong", inspected: 20, review: 8 }), { minSample: 10, favorYield: true, yieldStrength: "medium" });
const poor = seedRank(seed({ id: "poor", inspected: 20, review: 1 }), { minSample: 10, favorYield: true, yieldStrength: "medium" });
assert.equal(immature.yieldRate, 0.5);
assert.ok(strong.score > poor.score);
assert.ok(strong.score > immature.score);
const boosted = seedRank(seed({ id: "poor", inspected: 20, review: 1, priority: "high" }), { minSample: 10, favorYield: true, yieldStrength: "medium" });
assert.ok(boosted.score > poor.score);

const positive = scoreCandidate({ source: "suggested_accounts", text: "drone photographer", positiveKeywords: ["drone"], negativeKeywords: [] });
const plain = scoreCandidate({ source: "suggested_accounts", text: "studio", positiveKeywords: ["drone"], negativeKeywords: [] });
const negative = scoreCandidate({ source: "suggested_accounts", text: "drone giveaway", positiveKeywords: ["drone"], negativeKeywords: ["giveaway"] });
assert.ok(positive.score > plain.score);
assert.ok(negative.score < positive.score);
assert.ok(plain.score > 0);

const home = scoreCandidate({ source: "home_feed", text: "drone", positiveKeywords: ["drone"], negativeKeywords: [], seedMature: true, seedYield: 0.4 });
const seeded = scoreCandidate({ source: "seed", text: "drone", seedUsername: "greatdronecompany", seedMature: true, seedYield: 0.4, positiveKeywords: ["drone"], negativeKeywords: [] });
assert.ok(seeded.score > home.score);
assert.ok(seeded.reasons.some((reason) => reason.includes("@greatdronecompany")));

const now = new Date("2026-10-05T18:00:00.000Z");
const hammered = pickSeed({
  seeds: [seed({ id: "a", inspected: 20, review: 8, consecutiveUses: 2 }), seed({ id: "b", inspected: 20, review: 1, consecutiveUses: 0 })],
  minSample: 10,
  favorYield: true,
  yieldStrength: "medium",
  strategy: "balanced",
  cooldownCycles: 2,
  now,
  random: () => 0.9,
});
assert.equal(hammered?.id, "b");

assert.deepEqual(seedStatForCandidate("duplicate_skipped"), { inspected: 0, duplicates: 1, discovered: 0 });
assert.equal(seedStatForCandidate("inspected").inspected, 1);
assert.deepEqual(prospectAttribution({
  source: "seed_suggestion",
  sourceSeedId: "seed-1",
  sourceSeedUsername: "greatdronecompany",
  priorityLabel: "High",
  priorityReasons: ["from high-yield seed @greatdronecompany", "matched “drone”"],
}), {
  source: "seed_suggestion",
  source_seed_id: "seed-1",
  source_seed_username: "greatdronecompany",
  discovery_priority_label: "High",
  discovery_priority_reason: "from high-yield seed @greatdronecompany · matched “drone”",
});
assert.equal(reviewYield(120, 34), 34 / 120);

const homePick = pickCollectionSource({ hasSeeds: true, homeEnabled: true, suggestedEnabled: true, homeUsage: "low", strategy: "balanced", random: 0.05 });
const seedPick = pickCollectionSource({ hasSeeds: true, homeEnabled: true, suggestedEnabled: true, homeUsage: "low", strategy: "balanced", random: 0.2 });
assert.equal(homePick, "home_feed");
assert.equal(seedPick, "seed");

const simulated = [
  seed({ id: "a", inspected: 30, review: 10 }),
  seed({ id: "b", inspected: 30, review: 2 }),
  seed({ id: "c", inspected: 0, review: 0 }),
];
const counts = { a: 0, b: 0, c: 0 };
let state = 11;
const random = () => {
  state = (state * 1664525 + 1013904223) % 4294967296;
  return state / 4294967296;
};
for (let cycle = 0; cycle < 240; cycle += 1) {
  const picked = pickSeed({
    seeds: simulated,
    minSample: 10,
    favorYield: true,
    yieldStrength: "medium",
    strategy: "balanced",
    cooldownCycles: 2,
    now,
    random,
  });
  assert.ok(picked);
  counts[picked.id as "a" | "b" | "c"] += 1;
  for (const item of simulated) item.consecutiveUses = item.id === picked.id ? item.consecutiveUses + 1 : 0;
}
assert.ok(counts.a > counts.b);
assert.ok(counts.b > 0);
assert.ok(counts.c >= 20);

const sql = fs.readFileSync("supabase/migrations/20261009120000_discovery_seeds.sql", "utf8");
assert.match(sql, /create table if not exists public\.discovery_seeds/);
assert.match(sql, /discovery_auto_promote boolean not null default false/);
assert.match(sql, /source_seed_id/);
assert.match(sql, /seed_suggestion/);
assert.match(sql, /discovery_tuning/);
assert.match(sql, /primary key \(prospect_id, event_type\)/);
assert.match(sql, /unique_violation/);
assert.match(sql, /sync_discovery_seed_prospect/);
assert.match(sql, /release_discovery_seed_prospect/);
assert.equal(fs.readFileSync("lib/db/seeds.ts", "utf8").includes(".limit(2000)"), false);
assert.match(fs.readFileSync("lib/db/seeds.ts", "utf8"), /count: "exact"/);

const customPositive = scoreCandidate({ source: "suggested_accounts", text: "drone photographer", positiveKeywords: ["drone"], negativeKeywords: [], tuning: { positiveKeywordBonus: 20 } });
const defaultPositive = scoreCandidate({ source: "suggested_accounts", text: "drone photographer", positiveKeywords: ["drone"], negativeKeywords: [] });
assert.equal(customPositive.score - defaultPositive.score, 14);

const customNegative = scoreCandidate({ source: "suggested_accounts", text: "drone giveaway", positiveKeywords: [], negativeKeywords: ["giveaway"], tuning: { negativeKeywordPenalty: 3 } });
const defaultNegative = scoreCandidate({ source: "suggested_accounts", text: "drone giveaway", positiveKeywords: [], negativeKeywords: ["giveaway"] });
assert.equal(defaultNegative.score - customNegative.score, -5);

const fresh = seed({ id: "fresh", inspected: 0 });
const provenSeed = seed({ id: "proven", inspected: 20, review: 8 });
const alwaysFresh = pickSeed({
  seeds: [fresh, provenSeed],
  minSample: 10,
  favorYield: true,
  yieldStrength: "medium",
  strategy: "balanced",
  cooldownCycles: 2,
  now,
  random: () => 0,
  tuning: { explorationBalanced: 100 },
});
const neverFresh = pickSeed({
  seeds: [fresh, provenSeed],
  minSample: 10,
  favorYield: true,
  yieldStrength: "medium",
  strategy: "balanced",
  cooldownCycles: 2,
  now,
  random: () => 0,
  tuning: { explorationBalanced: 0 },
});
assert.equal(alwaysFresh?.id, "fresh");
assert.equal(neverFresh?.id, "proven");

assert.equal(pickCollectionSource({ hasSeeds: true, homeEnabled: true, suggestedEnabled: true, homeUsage: "low", strategy: "balanced", random: 0, tuning: { homeFeedLow: 0, seedShareBalanced: 100 } }), "seed");
assert.equal(pickCollectionSource({ hasSeeds: true, homeEnabled: true, suggestedEnabled: true, homeUsage: "low", strategy: "balanced", random: 0, tuning: { homeFeedLow: 100 } }), "home_feed");
assert.equal(pickCollectionSource({ hasSeeds: true, homeEnabled: true, suggestedEnabled: true, homeUsage: "low", strategy: "balanced", random: 0.5, tuning: { homeFeedLow: 0, seedShareBalanced: 0 } }), "suggested_accounts");
assert.equal(pickCollectionSource({ hasSeeds: true, homeEnabled: true, suggestedEnabled: true, homeUsage: "medium", strategy: "exploratory", random: 0.4, tuning: { homeFeedMedium: 30, seedShareExploratory: 80 } }), "seed");

assert.deepEqual(clampTuning(undefined), recommendedTuning());
assert.deepEqual(clampTuning({}), recommendedTuning());
assert.equal(clampTuning({ homeFeedLow: 250, explorationBalanced: Number.NaN, positiveKeywordBonus: "no" }).homeFeedLow, 100);
assert.equal(clampTuning({ homeFeedLow: 250, explorationBalanced: Number.NaN, positiveKeywordBonus: "no" }).explorationBalanced, 25);
assert.equal(clampTuning({ homeFeedLow: 250, explorationBalanced: Number.NaN, positiveKeywordBonus: "no" }).positiveKeywordBonus, 6);
assert.deepEqual(recommendedTuning(), clampTuning(recommendedTuning()));

const empty: SeedCounters = { inspected: 0, review: 0, approved: 0, contacted: 0 };
const inspectedOnce = recordInspection(empty, new Set());
const inspectedTwice = recordInspection(inspectedOnce.counters, inspectedOnce.recorded);
assert.equal(inspectedTwice.applied, false);
assert.equal(inspectedTwice.counters.inspected, 1);
const reviewed = syncStatus(inspectedTwice.counters, inspectedTwice.recorded, "review");
const reviewedAgain = syncStatus(reviewed.counters, reviewed.recorded, "review");
assert.equal(reviewedAgain.counters.review, 1);
const approved = syncStatus(reviewedAgain.counters, reviewedAgain.recorded, "approved");
assert.equal(approved.counters.review, 1);
assert.equal(approved.counters.approved, 1);
const contacted = syncStatus(approved.counters, approved.recorded, "contacted");
assert.equal(contacted.counters.contacted, 1);
assert.equal(contacted.counters.approved, 1);
const skipped = syncStatus(contacted.counters, contacted.recorded, "skipped");
assert.deepEqual(skipped.counters, { inspected: 1, review: 0, approved: 0, contacted: 0 });
assert.deepEqual(releaseProspect(contacted.counters, contacted.recorded), empty);

console.log("discovery seed tests passed", counts);
