import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { guardDiagnostic, openInspectionDelayLog, stallRecoveryAction, nextInspectionDelayLog } from "../lib/discovery/cadence";
import { REFILL_PASS_LIMIT, candidateRefillDecision, inspectionPoolBlocksRefill } from "../lib/discovery/pacing";
import { pickSeed, type RankableSeed } from "../lib/discovery/seeds";
import { formatThroughputReport, missedInspectionOpportunities, throughputDegraded } from "../lib/discovery/throughput";
import { CandidateQueue, type DiscoveryCandidate } from "../worker/discovery/queue";
import { clearEmptySeed, readEmptySeedCooldowns, recordUnproductiveSeed } from "../worker/discovery/seed-cooldowns";
import { seedVisitAction } from "../worker/instagram/seed-page";
import { followingScrollDecision } from "../worker/instagram/seed-network";

const source = fs.readFileSync(path.join(process.cwd(), "worker/discovery/v2.ts"), "utf8");
const body = source.slice(source.indexOf("export async function runDiscoveryV2"));
const initialized = body.indexOf("const inspectionDelayLog = openInspectionDelayLog()");
const turn = body.indexOf("await orchestrateTurn()");
assert.ok(initialized > 0 && initialized < turn, "inspectionDelayLog must be initialized before the worker turn");

assert.throws(() => {
  function note() {
    return inspectionDelayLog;
  }
  note();
  let inspectionDelayLog = "";
  return inspectionDelayLog;
}, /before initialization/);

const tracker = openInspectionDelayLog();
const firstDelay = tracker.note({
  now: 200_000,
  dueAt: 0,
  intervalMs: 72_000,
  reason: "Waiting for eligible candidate",
});
assert.match(firstDelay ?? "", /Inspection delayed:/);
assert.match(firstDelay ?? "", /Waiting for eligible candidate/);
assert.equal(tracker.note({
  now: 202_000,
  dueAt: 0,
  intervalMs: 72_000,
  reason: "Waiting for eligible candidate",
}), null);

let continued = false;
function workerTick() {
  const logged = guardDiagnostic(() => {
    throw new Error("Cannot access 'inspectionDelayLog' before initialization");
  });
  assert.equal(logged, false);
  continued = true;
}
workerTick();
assert.equal(continued, true);

function stored(username: string, score: number): DiscoveryCandidate {
  return {
    username,
    profileUrl: `https://www.instagram.com/${username}/`,
    source: "seed_network",
    sourcePostUrl: null,
    sourceThumbnailUrl: null,
    discoveredAt: "2026-10-07T00:00:00.000Z",
    priorityScore: score,
  };
}

const deferredPool = new CandidateQueue(30);
for (let index = 0; index < 30; index += 1) {
  assert.equal(deferredPool.place(stored(`below${index}`, 12), 18), "deferred");
}
assert.equal(deferredPool.pendingCount(), 0);
assert.equal(deferredPool.deferredCount(), 30);
assert.equal(deferredPool.census(18, 20).ranked, 0);
assert.equal(inspectionPoolBlocksRefill({ pending: deferredPool.pendingCount(), highWater: 30 }), false);
assert.equal(deferredPool.claim("profile-tab-1", { floor: 18, bestEligible: true, explorationFloor: 20 }), null);
const fullDeferred = deferredPool.census(18, 20);
assert.equal(candidateRefillDecision({
  census: fullDeferred,
  lowWater: 10,
  explore: false,
  allowInspect: true,
  passes: 0,
  slotDue: true,
}), "refill");
assert.equal(candidateRefillDecision({
  census: fullDeferred,
  lowWater: 10,
  explore: false,
  allowInspect: true,
  passes: REFILL_PASS_LIMIT,
  slotDue: true,
}), "candidate_starved");

function seed(username: string): RankableSeed {
  return {
    id: username,
    username,
    sourceType: "manual",
    active: true,
    priority: "normal",
    inspected: 3,
    review: 0,
    consecutiveUses: 0,
  };
}
const now = new Date("2026-10-07T12:00:00.000Z");
const firstPick = pickSeed({
  seeds: [seed("air4future"), seed("othersource")],
  minSample: 10,
  favorYield: true,
  yieldStrength: "medium",
  strategy: "balanced",
  cooldownCycles: 2,
  now,
  random: () => 0,
  avoidUsernames: [],
});
assert.ok(firstPick);
const secondPick = pickSeed({
  seeds: [seed("air4future"), seed("othersource")],
  minSample: 10,
  favorYield: true,
  yieldStrength: "medium",
  strategy: "balanced",
  cooldownCycles: 2,
  now,
  random: () => 0,
  avoidUsernames: [firstPick?.username ?? ""],
});
assert.notEqual(secondPick?.username, firstPick?.username);
const onlySeed = pickSeed({
  seeds: [seed("air4future")],
  minSample: 10,
  favorYield: true,
  yieldStrength: "medium",
  strategy: "balanced",
  cooldownCycles: 2,
  now,
  random: () => 0,
  avoidUsernames: ["air4future"],
});
assert.equal(onlySeed?.username, "air4future");

assert.equal(seedVisitAction({ newCandidates: 1, rankedAdded: 0, fallbackAdded: 0 }), "cooldown");
assert.equal(seedVisitAction({ newCandidates: 1, rankedAdded: 1, fallbackAdded: 0 }), "reset");
assert.equal(seedVisitAction({ newCandidates: 1, rankedAdded: 0, fallbackAdded: 1 }), "reset");

const cooldownFile = path.join(os.tmpdir(), `seed-useful-${process.pid}.json`);
fs.rmSync(cooldownFile, { force: true });
const first = recordUnproductiveSeed("air4future", now.getTime(), cooldownFile);
const second = recordUnproductiveSeed("air4future", now.getTime() + 1_000, cooldownFile);
const third = recordUnproductiveSeed("air4future", now.getTime() + 2_000, cooldownFile);
assert.equal(first.minutes, 45);
assert.equal(second.minutes, 120);
assert.equal(third.minutes, 360);
assert.ok(readEmptySeedCooldowns(now.getTime() + 2_000, cooldownFile).air4future);
clearEmptySeed("air4future", now.getTime() + 3_000, cooldownFile);
const reset = recordUnproductiveSeed("air4future", now.getTime() + 4_000, cooldownFile);
assert.equal(reset.minutes, 45);
fs.rmSync(cooldownFile, { force: true });

assert.equal(followingScrollDecision({
  newCount: 1,
  target: 15,
  scrolls: 2,
  maxScrolls: 6,
  staleScrolls: 2,
  staleLimit: 2,
  timedOut: false,
}), "scroll");
assert.equal(followingScrollDecision({
  newCount: 1,
  target: 15,
  scrolls: 6,
  maxScrolls: 6,
  staleScrolls: 2,
  staleLimit: 2,
  timedOut: false,
}), "max_scrolls");

let delayState = null;
const opened = nextInspectionDelayLog({
  now: 200_000,
  dueAt: 0,
  intervalMs: 72_000,
  reason: "Waiting for eligible candidate",
  state: delayState,
});
delayState = opened.state;
assert.match(opened.line ?? "", /overdue 3m 20s/);
const tick = nextInspectionDelayLog({
  now: 202_000,
  dueAt: 0,
  intervalMs: 72_000,
  reason: "Waiting for eligible candidate",
  state: delayState,
});
assert.equal(tick.line, null);
const still = nextInspectionDelayLog({
  now: 260_000,
  dueAt: 0,
  intervalMs: 72_000,
  reason: "Waiting for eligible candidate",
  state: delayState,
});
assert.match(still.line ?? "", /Still waiting:/);

const intervalMs = 72_000;
assert.equal(missedInspectionOpportunities(intervalMs * 3, 0, intervalMs), 3);
assert.equal(throughputDegraded({
  running: true,
  inspectionsSinceProgress: 0,
  overdueMs: intervalMs * 3,
  intervalMs,
}), true);
assert.equal(throughputDegraded({
  running: true,
  inspectionsSinceProgress: 1,
  overdueMs: intervalMs * 3,
  intervalMs,
}), false);
const recovery = stallRecoveryAction();
assert.equal(recovery.moveInspectionClock, false);
assert.equal(recovery.message, "Discovery degraded — candidate starvation");
const report = formatThroughputReport({
  configuredPerHour: 50,
  actualLast60Minutes: 7,
  opportunities: 50,
  missed: 31,
  waitingMs: 31 * 60_000,
  sourcingMs: 18 * 60_000,
  inspectingMs: 2 * 60_000,
  degraded: true,
});
assert.match(report, /Configured: 50\/hr/);
assert.match(report, /Actual: 7\/hr/);
assert.match(report, /Candidate-starved: 31m 0s/);
assert.match(report, /Discovery degraded — candidate starvation/);

console.log("discovery starvation tests passed");
