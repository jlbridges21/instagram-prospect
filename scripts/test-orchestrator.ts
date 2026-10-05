import assert from "node:assert/strict";
import { BrowserActionLock, discoveryShouldYield, earliestWake, nextOrchestratorStep } from "../lib/worker/orchestrator";
import { formatCurrentAction, formatDiscoveryStatus, formatOutreachAction, formatOutreachStatus } from "../lib/status/operations";

const now = Date.parse("2026-10-04T01:54:00.000Z");
const sixMinutes = 6 * 60 * 1000;
const fortyFiveMinutes = 45 * 60 * 1000;

const outreachNow = nextOrchestratorStep({
  now,
  attention: false,
  heartbeatDueAt: now + 15_000,
  outreach: { desired: true, critical: false, eligibleNow: true, nextEligibleAt: now },
  discovery: { desired: true, eligibleNow: false, nextEligibleAt: now + fortyFiveMinutes, inspectionInProgress: false },
});
assert.equal(outreachNow.action, "outreach");

const duringHourlyWait = nextOrchestratorStep({
  now: now + 10 * 60 * 1000,
  attention: false,
  heartbeatDueAt: now + 10 * 60 * 1000 + 15_000,
  outreach: { desired: true, critical: false, eligibleNow: true, nextEligibleAt: now + 10 * 60 * 1000 },
  discovery: { desired: true, eligibleNow: false, nextEligibleAt: now + fortyFiveMinutes, inspectionInProgress: false },
});
assert.equal(duringHourlyWait.action, "outreach");

const spacingGap = nextOrchestratorStep({
  now,
  attention: false,
  heartbeatDueAt: now + 15_000,
  outreach: { desired: true, critical: false, eligibleNow: false, nextEligibleAt: now + sixMinutes },
  discovery: { desired: true, eligibleNow: true, nextEligibleAt: null, inspectionInProgress: false },
});
assert.equal(spacingGap.action, "discovery");

const collecting = discoveryShouldYield({ hourlyFull: false, outreachDueNow: true, inspectionInProgress: false });
assert.equal(collecting.yield, true);
assert.equal(collecting.finishCurrentInspection, false);

const inspecting = discoveryShouldYield({ hourlyFull: false, outreachDueNow: true, inspectionInProgress: true });
assert.equal(inspecting.finishCurrentInspection, true);
assert.equal(inspecting.yield, true);

const afterInspection = nextOrchestratorStep({
  now,
  attention: false,
  heartbeatDueAt: now + 15_000,
  outreach: { desired: true, critical: false, eligibleNow: true, nextEligibleAt: now },
  discovery: { desired: true, eligibleNow: true, nextEligibleAt: null, inspectionInProgress: false },
});
assert.equal(afterInspection.action, "outreach");

const hourlyYield = discoveryShouldYield({ hourlyFull: true, outreachDueNow: true, inspectionInProgress: false });
assert.equal(hourlyYield.yield, true);

const lock = new BrowserActionLock();
assert.equal(lock.heldBy(), null);
assert.equal(lock.tryAcquire("discovery"), true);
lock.release("discovery");
assert.equal(lock.heldBy(), null);
assert.equal(lock.tryAcquire("outreach"), true);
lock.release("outreach");
assert.equal(lock.heldBy(), null);

lock.tryAcquire("outreach", true);
assert.equal(lock.isCritical(), true);
assert.equal(lock.tryAcquire("discovery"), false);
lock.release("outreach");
assert.equal(lock.heldBy(), null);

const wake = earliestWake({
  now,
  heartbeatDueAt: now + fortyFiveMinutes,
  outreach: { nextEligibleAt: now + sixMinutes },
  discovery: { nextEligibleAt: now + fortyFiveMinutes },
});
assert.equal(wake, now + sixMinutes);

const discovery = formatDiscoveryStatus({
  online: true,
  enabled: true,
  stopReason: null,
  hourly: { count: 30, limit: 30, resumesAt: new Date(now + fortyFiveMinutes).toISOString() },
  attention: null,
  reviewCount: 4,
  reviewTarget: 20,
});
const outreach = formatOutreachStatus({
  online: true,
  enabled: true,
  queueCount: 3,
  attention: null,
  acting: true,
});
assert.equal(discovery.actual, "RUNNING");
assert.match(discovery.reason, /Next profile inspection/);
assert.equal(outreach.actual, "RUNNING");
assert.doesNotMatch(formatOutreachAction({
  task: "discovery_hourly_wait",
  username: null,
  waiting: null,
}), /Discovery/);
assert.match(formatOutreachAction({
  task: "executing_verify_profile",
  username: "nomadic_explorista",
  waiting: null,
}), /Verifying @nomadic_explorista/);
assert.match(formatCurrentAction("executing_send_message", "nomadic_explorista", true), /Sending message/);
assert.doesNotMatch(formatCurrentAction("executing_send_message", "nomadic_explorista", true), /hourly Discovery/);

const yielding = formatDiscoveryStatus({
  online: true,
  enabled: true,
  stopReason: null,
  hourly: null,
  attention: null,
  reviewCount: 4,
  reviewTarget: 20,
  yieldingToOutreach: true,
});
assert.equal(yielding.actual, "RUNNING");
assert.match(yielding.reason, /yielding to Outreach/);

console.log("orchestrator tests passed");
