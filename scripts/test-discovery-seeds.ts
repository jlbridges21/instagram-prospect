import assert from "node:assert/strict";
import fs from "node:fs";
import { scoreCandidate } from "../lib/discovery/candidate-priority";
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

console.log("discovery seed tests passed", counts);
