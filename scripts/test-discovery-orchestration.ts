import assert from "node:assert/strict";
import { rememberExplorationDecision } from "../lib/discovery/candidate-priority";
import { discoveryStallDecision } from "../lib/discovery/cadence";
import {
  REFILL_PASS_LIMIT,
  candidateRefillDecision,
  censusFromScores,
  logOnTransition,
  type PoolCensus,
} from "../lib/discovery/pacing";

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
assert.equal(decision(oneExploration, true), "inspect_exploration");

const afterExploration = censusFromScores([8, 11, 14], floor, explorationFloor);
assert.equal(decision(afterExploration, false), "refill");

const starvedDeferred = censusFromScores(Array.from({ length: 25 }, () => 12), floor, explorationFloor);
assert.equal(starvedDeferred.total, 25);
assert.equal(starvedDeferred.ranked, 0);
assert.equal(decision(starvedDeferred, false), "refill");
assert.equal(decision(starvedDeferred, false, REFILL_PASS_LIMIT), "wait");

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

console.log("discovery orchestration tests passed");
