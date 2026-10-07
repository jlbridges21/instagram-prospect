import assert from "node:assert/strict";
import { rememberExplorationDecision } from "../lib/discovery/candidate-priority";
import { discoveryStallDecision, formatInspectionDelay, inspectionIntervalMs } from "../lib/discovery/cadence";
import { scoreCandidate } from "../lib/discovery/candidate-priority";
import {
  REFILL_PASS_LIMIT,
  candidateRefillDecision,
  censusFromScores,
  discoveryConfigUpdates,
  formatRefillComplete,
  logOnTransition,
  type PoolCensus,
} from "../lib/discovery/pacing";
import { CandidateQueue, mergeCandidateEvidence, type DiscoveryCandidate } from "../worker/discovery/queue";

const floor = 35;
const explorationFloor = 20;
const lowWater = 10;

function decision(census: PoolCensus, explore: boolean, passes = 0, emptyPasses = 0) {
  return candidateRefillDecision({
    census,
    lowWater,
    explore,
    allowInspect: true,
    passes,
    consecutiveEmptyPasses: emptyPasses,
  });
}

const below = censusFromScores([10, 12, 14, 16, 18], floor, explorationFloor);
assert.equal(below.ranked, 0);
assert.equal(below.explorationEligible, 0);
assert.equal(below.deferred, 5);
assert.equal(decision(below, false), "refill");
const kept = rememberExplorationDecision({
  previous: null,
  slot: 1_000,
  strategy: "balanced",
  random: 0.9,
});
assert.equal(kept.explore, false);
assert.equal(rememberExplorationDecision({
  previous: kept,
  slot: 1_000,
  strategy: "balanced",
  random: 0,
}).explore, false);

const oneExploration = censusFromScores([8, 9, 11, 12, 25], floor, explorationFloor);
assert.equal(oneExploration.ranked, 0);
assert.equal(oneExploration.explorationEligible, 1);
assert.equal(decision(oneExploration, true), "refill");
assert.equal(decision(oneExploration, true, REFILL_PASS_LIMIT), "inspect_starvation");
assert.equal(decision(oneExploration, false, REFILL_PASS_LIMIT), "inspect_starvation");
assert.equal(oneExploration.highest, 25);

const midBand = censusFromScores([25, 26, 27, 28, 29, 30, 31, 32, 33, 34], floor, explorationFloor);
assert.equal(midBand.ranked, 0);
assert.equal(midBand.explorationEligible, 10);
assert.equal(midBand.highest, 34);
assert.equal(decision(midBand, false), "refill");
assert.equal(decision(midBand, false, REFILL_PASS_LIMIT), "inspect_starvation");
assert.equal(decision(midBand, false, 1, 2), "inspect_starvation");

const rankedPresent = censusFromScores([25, 48], floor, explorationFloor);
assert.equal(decision(rankedPresent, true), "inspect_ranked");

const refillLog = formatRefillComplete({ census: midBand, floor, selection: "starvation fallback" });
assert.match(refillLog, /Refill complete/);
assert.match(refillLog, /0 ranked/);
assert.match(refillLog, /10 exploration eligible/);
assert.match(refillLog, /Highest pre-score:\n34/);
assert.match(refillLog, /No candidate reached normal floor 35/);
assert.match(refillLog, /Selection:\nstarvation fallback/);

const afterExploration = censusFromScores([8, 11, 14], floor, explorationFloor);
assert.equal(decision(afterExploration, false), "refill");

const starvedDeferred = censusFromScores(Array.from({ length: 25 }, () => 12), floor, explorationFloor);
assert.equal(starvedDeferred.total, 25);
assert.equal(starvedDeferred.ranked, 0);
assert.equal(decision(starvedDeferred, false), "refill");
assert.equal(decision(starvedDeferred, false, REFILL_PASS_LIMIT), "candidate_starved");

const same = logOnTransition("pool", "pool");
assert.equal(same.log, false);
const changed = logOnTransition("pool", "pool-refilled");
assert.equal(changed.log, true);

const now = 1_000_000;
const intervalMs = 120_000;
const grace = intervalMs * 3;
const overdueAt = now - grace - 1;
assert.equal(discoveryStallDecision({
  now,
  nextInspectionAt: overdueAt,
  intervalMs,
  blocked: false,
  overdueSince: overdueAt,
  lastProgressAt: now - grace - 1,
  sourcing: true,
}).stalled, false);
assert.equal(discoveryStallDecision({
  now,
  nextInspectionAt: overdueAt,
  intervalMs,
  blocked: false,
  overdueSince: overdueAt,
  lastProgressAt: now - grace - 1,
  sourcing: false,
}).stalled, true);

function roll(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
const random = roll(20);
let explorations = 0;
let previous: { slot: number; explore: boolean } | null = null;
for (let slot = 0; slot < 100; slot += 1) {
  const first = rememberExplorationDecision({
    previous,
    slot,
    strategy: "balanced",
    random: random(),
  });
  let current = first;
  for (let repeat = 0; repeat < 10; repeat += 1) {
    current = rememberExplorationDecision({
      previous: current,
      slot,
      strategy: "balanced",
      random: 0,
    });
  }
  assert.equal(current.explore, first.explore);
  if (current.explore) explorations += 1;
  previous = null;
}
assert.ok(explorations > 8 && explorations < 40, `expected about 20 exploration decisions, got ${explorations}`);

function stored(username: string, source: DiscoveryCandidate["source"], score: number, seed?: string): DiscoveryCandidate {
  return {
    username,
    profileUrl: `https://www.instagram.com/${username}/`,
    source,
    sourcePostUrl: null,
    sourceThumbnailUrl: null,
    discoveredAt: "2026-10-06T00:00:00.000Z",
    sourceSeedUsername: seed ?? null,
    seedSupport: seed ? [seed] : [],
    priorityScore: score,
  };
}

const selection = new CandidateQueue(10);
selection.place(stored("low", "seed_network", 20, "seed-a"), 35);
selection.place(stored("best", "seed_network", 34, "seed-b"), 35);
const fallback = selection.claim("profile-tab-1", { floor: 35, bestEligible: true, explorationFloor: 20 });
assert.equal(fallback?.username, "best");
assert.equal(fallback?.inspectionSelection, "starvation");

const tooLow = new CandidateQueue(10);
tooLow.place(stored("plain", "seed_network", 18, "seed-a"), 35);
tooLow.place(stored("weaker", "suggested_accounts", 8), 35);
assert.equal(tooLow.claim("profile-tab-1", { floor: 35, bestEligible: true, explorationFloor: 20 }), null);

const preferred = new CandidateQueue(10);
preferred.place(stored("explore", "home_feed", 30), 35);
preferred.place(stored("ranked", "seed_network", 48, "seed-a"), 35);
const rankedClaim = preferred.claim("profile-tab-1", { floor: 35, bestEligible: true, explore: true, explorationFloor: 20 });
assert.equal(rankedClaim?.username, "ranked");
assert.equal(rankedClaim?.inspectionSelection, "ranked");

function rescore(candidate: DiscoveryCandidate) {
  const support = [...new Set([...(candidate.seedSupport ?? []), candidate.sourceSeedUsername ?? ""].map((value) => value.trim().toLowerCase()).filter(Boolean))];
  const seeded = candidate.source === "seed_network" || candidate.source === "seed_suggestion";
  const priority = scoreCandidate({
    source: seeded ? "seed" : candidate.source === "home_feed" ? "home_feed" : "suggested_accounts",
    sourceDetail: candidate.source,
    seedUsername: support[0] ?? null,
    seedSupportCount: support.length,
    username: candidate.username,
    cardText: candidate.cardText,
    positiveKeywords: ["drone"],
    negativeKeywords: [],
  });
  return { ...candidate, seedSupport: support, sourcesSeen: candidate.sourcesSeen ?? [candidate.source], priorityScore: priority.score };
}

const firstSeed = rescore({
  ...stored("johnsmith", "seed_network", 0, "listwell.media"),
  cardText: "drone",
  sourcesSeen: ["seed_network"],
});
assert.equal(firstSeed.priorityScore, 24);
const evidence = new CandidateQueue(10);
assert.equal(evidence.place(firstSeed, 35), "deferred");
const secondSeed = mergeCandidateEvidence(firstSeed, {
  ...stored("johnsmith", "seed_network", 0, "skydbproductions"),
  cardText: "drone",
  sourcesSeen: ["seed_network"],
});
const raised = rescore(secondSeed);
assert.ok((raised.priorityScore ?? 0) > (firstSeed.priorityScore ?? 0));
assert.equal(raised.priorityScore, 36);
assert.deepEqual(raised.seedSupport, ["listwell.media", "skydbproductions"]);
assert.deepEqual(raised.sourcesSeen, ["seed_network"]);
assert.equal(evidence.place(raised, 35), "merged");
assert.equal(evidence.pendingCount(), 1);
assert.equal(evidence.deferredCount(), 0);
assert.equal(evidence.census(35, 20).ranked, 1);
assert.equal(evidence.hold("johnsmith")?.priorityScore, 36);

const floor18 = new CandidateQueue(10);
floor18.place(stored("jjhomesphotographyllc", "seed_network", 30, "listwell.media"), 35);
floor18.place(stored("tk.creativemedia", "seed_network", 24, "listwell.media"), 35);
floor18.place(stored("below", "seed_network", 17, "listwell.media"), 35);
assert.equal(floor18.deferredCount(), 3);
const first = floor18.claim("profile-tab-1", { floor: 18, explore: true, explorationFloor: 20 });
assert.equal(first?.username, "jjhomesphotographyllc");
assert.equal(first?.inspectionSelection, "ranked");
const second = floor18.claim("profile-tab-1", { floor: 18, explore: true, explorationFloor: 20 });
assert.equal(second?.username, "tk.creativemedia");
assert.equal(second?.inspectionSelection, "ranked");
assert.equal(floor18.claim("profile-tab-1", { floor: 18, explore: true, explorationFloor: 20 }), null);

const atFloor = censusFromScores([30, 24], 18, 20);
assert.equal(atFloor.ranked, 2);
assert.equal(decision(atFloor, true), "inspect_ranked");
const underFloor = censusFromScores([17], 18, 20);
assert.equal(underFloor.ranked, 0);
assert.equal(underFloor.explorationEligible, 0);

const overdueRefill = candidateRefillDecision({
  census: censusFromScores([24, 30], 35, 20),
  lowWater,
  explore: false,
  allowInspect: true,
  passes: 0,
  elapsedMs: 10 * 60 * 1000,
});
assert.equal(overdueRefill, "inspect_starvation");
const slotArrived = candidateRefillDecision({
  census: censusFromScores([24], 35, 20),
  lowWater,
  explore: false,
  allowInspect: false,
  passes: 0,
  slotDue: true,
});
assert.equal(slotArrived, "yield_for_slot");
assert.equal(inspectionIntervalMs(50), 72_000);
assert.equal(formatInspectionDelay({ now: 70_000, dueAt: 0, intervalMs: 72_000, reason: "Refilling candidate pool" }), null);
const delay = formatInspectionDelay({ now: 11 * 60 * 1000, dueAt: 0, intervalMs: 72_000, reason: "Refilling candidate pool" });
assert.match(delay ?? "", /reason: Refilling candidate pool/);
assert.match(delay ?? "", /overdue by: 11m 0s/);

const before = { profilesPerHour: 50, minimumPreScore: 35, explorationFloor: 20, strategy: "balanced", poolTarget: 25, lowWater: 10 };
const after = { ...before, minimumPreScore: 18 };
assert.equal(discoveryConfigUpdates(before, after), "Discovery config updated:\nminimum pre-score 35 → 18");
assert.equal(discoveryConfigUpdates(after, after), null);

console.log("discovery orchestration tests passed");
