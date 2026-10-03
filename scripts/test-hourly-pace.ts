import assert from "node:assert/strict";
import { CandidateQueue } from "../worker/discovery/queue";
import { discoveryStopDecision } from "../lib/discovery/policy";
import {
  acquisitionDecision,
  checkpointHoldDecision,
  formatHourlyWait,
  formatWorkerModes,
  hourlyInspectionPace,
  parseHourlyWaitEvent,
  queueThresholds,
} from "../lib/discovery/pacing";
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
assert.equal(hourlyInspectionPace({ stamps: stamps.slice(0, 10), now, limit: 10 }).full, true);
assert.match(formatHourlyWait({ count: full.count, limit: full.limit, resumesAt: full.resumesAt ?? now }), /30 \/ 30/);
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

console.log("hourly pace tests passed");
