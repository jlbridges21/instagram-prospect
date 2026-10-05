import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CandidateQueue } from "../worker/discovery/queue";
import { discoveryStopDecision } from "../lib/discovery/policy";
import {
  acquisitionDecision,
  checkpointHoldDecision,
  formatHourlyWait,
  formatWorkerModes,
  getDiscoveryHourlyState,
  hourlyActual,
  hourlyInspectionPace,
  parseHourlyWaitEvent,
  queueThresholds,
  reserveInspectionSlot,
} from "../lib/discovery/pacing";
import { nextOrchestratorStep } from "../lib/worker/orchestrator";
import { readHourlyStamps, writeHourlyStamps } from "../worker/discovery/hourly-history";
import { prospectCompletionLine } from "../lib/outreach/completion-log";
import { workerMayClaim } from "../lib/outreach/decisions";

const now = Date.parse("2026-10-03T22:00:00.000Z");
const hour = 60 * 60 * 1000;
const stamps = Array.from({ length: 30 }, (_, index) => now - index * 1000);
const full = hourlyInspectionPace({ stamps, now, limit: 30 });
assert.equal(full.full, true);
assert.equal(full.count, 30);
assert.ok(full.resumesAt != null && full.resumesAt > now);

const open = hourlyInspectionPace({ stamps, now: now + hour + 5, limit: 30 });
assert.equal(open.full, false);
assert.equal(hourlyInspectionPace({ stamps: stamps.slice(0, 29), now, limit: 30 }).full, false);
const overnight = Date.parse("2026-10-03T07:00:00.000Z");
const afternoon = Date.parse("2026-10-03T20:00:00.000Z");
assert.equal(hourlyInspectionPace({ stamps: [overnight - 1000], now: overnight, limit: 30 }).full, false);
assert.equal(hourlyInspectionPace({ stamps: [afternoon - 1000], now: afternoon, limit: 30 }).full, false);
assert.equal(discoveryStopDecision({ currentReview: 1, target: 20, sessionInspections: 1, dailyInspections: 1, dailyAi: 0 }).reason, null);
assert.equal(discoveryStopDecision({ currentReview: 1, target: 20, sessionInspections: 1, dailyInspections: 500, dailyAi: 0 }).reason, "daily_inspection_cap");
assert.equal(hourlyInspectionPace({ stamps: stamps.slice(0, 10), now, limit: 10 }).full, true);
assert.match(formatHourlyWait({ count: full.count, limit: full.limit, resumesAt: full.resumesAt ?? now }), /30 \/ 30/);
assert.match(formatHourlyWait({ count: full.count, limit: full.limit, resumesAt: full.resumesAt ?? now }), /Next profile slot opens at/);
assert.equal(parseHourlyWaitEvent(`Discovery hourly wait | count=30 | limit=30 | resumes=${new Date(full.resumesAt ?? now).toISOString()}`)?.limit, 30);

const queue = new CandidateQueue(10);
for (let index = 0; index < 10; index += 1) {
  queue.enqueue({
    username: `pilot${index}`,
    profileUrl: "https://www.instagram.com/",
    source: "home_feed",
    sourcePostUrl: null,
    sourceThumbnailUrl: null,
    discoveredAt: new Date(now).toISOString(),
  });
}
const thresholds = queueThresholds(10);
let holding = false;
let decision = acquisitionDecision({
  pending: queue.pendingCount(),
  highWater: thresholds.highWater,
  lowWater: thresholds.lowWater,
  holding,
  hourlyFull: true,
});
holding = decision.holding;
assert.equal(decision.acquire, false);
assert.equal(decision.reason, "hourly_pace");
const preserved = queue.pendingCandidates().map((item) => item.username);
assert.deepEqual(preserved, queue.pendingCandidates().map((item) => item.username));
assert.equal(queue.pendingCount(), 10);

decision = acquisitionDecision({
  pending: 4,
  highWater: 10,
  lowWater: 5,
  holding: false,
  hourlyFull: false,
});
assert.equal(decision.acquire, true);
decision = acquisitionDecision({
  pending: 10,
  highWater: 10,
  lowWater: 5,
  holding: false,
  hourlyFull: false,
});
assert.equal(decision.acquire, false);
assert.equal(decision.reason, "high_water");
decision = acquisitionDecision({
  pending: 7,
  highWater: 10,
  lowWater: 5,
  holding: true,
  hourlyFull: false,
});
assert.equal(decision.acquire, false);
decision = acquisitionDecision({
  pending: 5,
  highWater: 10,
  lowWater: 5,
  holding: true,
  hourlyFull: false,
});
assert.equal(decision.acquire, true);

assert.equal(
  discoveryStopDecision({
    currentReview: 4,
    target: 20,
    sessionInspections: 30,
    dailyInspections: 30,
    dailyAi: 10,
  }).pauseDiscovery,
  false,
);

assert.equal(
  workerMayClaim({
    automationEnabled: false,
    workerEnabled: true,
    requesterId: "worker",
    maxActiveWorkers: 1,
    onlineWorkers: [{ id: "worker", startedAt: "2026-10-03T22:00:00.000Z" }],
  }).allowed,
  false,
);
assert.equal(
  workerMayClaim({
    automationEnabled: true,
    workerEnabled: true,
    requesterId: "worker",
    maxActiveWorkers: 1,
    onlineWorkers: [{ id: "worker", startedAt: "2026-10-03T22:00:00.000Z" }],
  }).allowed,
  true,
);

assert.equal(prospectCompletionLine({ username: "bradsflights", jobType: "verify_profile", sequenceComplete: false }), null);
assert.equal(prospectCompletionLine({ username: "bradsflights", jobType: "follow_profile", sequenceComplete: false }), null);
assert.equal(prospectCompletionLine({ username: "bradsflights", jobType: "send_message", sequenceComplete: false }), null);
assert.equal(
  prospectCompletionLine({ username: "bradsflights", jobType: "send_message", sequenceComplete: true }),
  "Completed outreach for @bradsflights.",
);

const hold = checkpointHoldDecision();
assert.equal(hold.claimOutreach, false);
assert.equal(hold.inspectProfiles, false);
assert.equal(hold.collectCandidates, false);
assert.equal(hold.databaseTogglesChanged, false);
assert.match(formatWorkerModes({ discovery: "WAITING", outreach: "PAUSED" }), /WAITING — hourly pace/);
assert.match(formatWorkerModes({ discovery: "RUNNING", outreach: "PAUSED" }), /Outreach: PAUSED/);

const oldest = now - hour + 1_000;
const secondOldest = oldest + 5 * 60 * 1000;
const rolling = [oldest, secondOldest, ...Array.from({ length: 28 }, (_, index) => now - index * 1000)];
const waiting = getDiscoveryHourlyState({ stamps: rolling, now, limit: 30 });
assert.equal(waiting.count, 30);
assert.equal(waiting.limited, true);
assert.equal(waiting.nextEligibleAt, oldest + hour);
assert.equal(hourlyActual({ enabled: true, limited: true }), "WAITING");

const opened = getDiscoveryHourlyState({ stamps: rolling, now: oldest + hour, limit: 30 });
assert.equal(opened.count, 29);
assert.equal(opened.limited, false);
assert.equal(hourlyActual({ enabled: true, limited: false }), "RUNNING");
const reserved = reserveInspectionSlot({ stamps: opened.stamps, now: oldest + hour, limit: 30 });
assert.equal(reserved.ok, true);
assert.equal(reserved.state.count, 30);
assert.equal(reserved.state.limited, true);
assert.equal(reserved.state.nextEligibleAt, secondOldest + hour);

const together = [...Array.from({ length: 3 }, () => now - hour), ...Array.from({ length: 27 }, () => now - 1_000)];
const beforeBatch = getDiscoveryHourlyState({ stamps: together, now: now - 1, limit: 30 });
assert.equal(beforeBatch.count, 30);
const afterBatch = getDiscoveryHourlyState({ stamps: together, now, limit: 30 });
assert.equal(afterBatch.count, 27);
assert.equal(afterBatch.limited, false);

const stale = getDiscoveryHourlyState({ stamps: [now - hour - 1], now, limit: 30 });
assert.equal(stale.limited, false);
assert.equal(stale.nextEligibleAt, null);
const staleStep = nextOrchestratorStep({
  now,
  attention: false,
  heartbeatDueAt: now + 30_000,
  outreach: { desired: false, critical: false, eligibleNow: false, nextEligibleAt: null },
  discovery: { desired: true, eligibleNow: false, nextEligibleAt: now - 1, inspectionInProgress: false },
});
assert.equal(staleStep.sleepMs, 0);

const shared = getDiscoveryHourlyState({ stamps: rolling, now, limit: 30 });
const sharedStep = nextOrchestratorStep({
  now,
  attention: false,
  heartbeatDueAt: now + 30_000,
  outreach: { desired: false, critical: false, eligibleNow: false, nextEligibleAt: null },
  discovery: { desired: true, eligibleNow: !shared.limited, nextEligibleAt: shared.nextEligibleAt, inspectionInProgress: false },
});
assert.equal(shared.limited, true);
assert.equal(sharedStep.action, "sleep");
assert.notEqual(hourlyActual({ enabled: true, limited: shared.limited }), "RUNNING");

const blocked = reserveInspectionSlot({ stamps: waiting.stamps, now, limit: 30 });
assert.equal(blocked.ok, false);
assert.equal(blocked.state.count, 30);

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "hourly-history-"));
process.env.WORKER_STATE_DIR = stateDir;
writeHourlyStamps(waiting.stamps);
const afterBrowserRestart = readHourlyStamps(now);
assert.equal(getDiscoveryHourlyState({ stamps: afterBrowserRestart, now, limit: 30 }).count, 30);
const afterWorkerRestart = readHourlyStamps(now);
assert.equal(getDiscoveryHourlyState({ stamps: afterWorkerRestart, now, limit: 30 }).limited, true);
fs.rmSync(stateDir, { recursive: true, force: true });

console.log("hourly pace tests passed");
