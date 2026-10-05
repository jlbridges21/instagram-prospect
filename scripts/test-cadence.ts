import assert from "node:assert/strict";
import { discoveryDue, inspectionIntervalMs, scheduleNextInspection } from "../lib/discovery/cadence";
import { claimPaceDecision, type PaceJob } from "../lib/outreach/pace";

assert.equal(inspectionIntervalMs(30), 120_000);
assert.equal(inspectionIntervalMs(60), 60_000);
assert.equal(inspectionIntervalMs(10), 360_000);

const start = Date.parse("2026-10-05T17:00:00.000Z");
let next = start;
const interval = inspectionIntervalMs(30);
const inspected: number[] = [];
for (let step = 0; step < 5; step += 1) {
  assert.equal(discoveryDue(next, next), true);
  const completedAt = next + 10_000;
  inspected.push(completedAt);
  next = scheduleNextInspection({ now: completedAt, intervalMs: interval, previousNextAt: next, completedAt });
}
assert.deepEqual(inspected.map((value) => value - start), [10_000, 130_000, 250_000, 370_000, 490_000]);
assert.equal(next - start, 600_000);

const delayedComplete = start + 5 * 60_000 + 10_000;
const afterDelay = scheduleNextInspection({
  now: delayedComplete,
  intervalMs: interval,
  previousNextAt: start,
  completedAt: delayedComplete,
});
assert.equal(afterDelay, delayedComplete + interval);
assert.ok(afterDelay - delayedComplete >= interval);

const now = Date.parse("2026-10-05T18:00:00.000Z");
const fresh: PaceJob = {
  id: "fresh",
  prospectId: "fresh-prospect",
  username: "freshuser",
  jobType: "verify_profile",
  status: "pending",
  scheduledFor: new Date(now + 6 * 60 * 60 * 1000).toISOString(),
  createdAt: new Date(now - 60_000).toISOString(),
};
const retry: PaceJob = {
  id: "retry",
  prospectId: "retry-prospect",
  username: "retryuser",
  jobType: "send_message",
  status: "retry_wait",
  scheduledFor: new Date(now - 60_000).toISOString(),
  availableAt: new Date(now + 5 * 60_000).toISOString(),
  createdAt: new Date(now - 120_000).toISOString(),
};
const parent: PaceJob = { ...retry, id: "retry-parent", jobType: "follow_profile", status: "completed" };
const decision = claimPaceDecision({
  now: new Date(now),
  timeZone: "America/Chicago",
  minimumSpacingSeconds: 0,
  hourlyMaximum: 40,
  dailyMaximum: 150,
  completedSendTimes: [],
  jobs: [fresh, retry, parent],
});
assert.equal(decision.action, "claim");
assert.equal(decision.username, "freshuser");

let clock = start;
let sends = 0;
let freshLeft = 28;
let retryAt: number | null = null;
for (let minute = 0; minute < 6 * 60; minute += 1) {
  clock = start + minute * 60_000;
  if (minute % 17 === 0 && minute > 0) continue;
  if (sends < 28 && (sends === 0 || clock >= start + sends * 360_000)) {
    if (minute % 11 === 0) retryAt = clock + 5 * 60_000;
    else {
      freshLeft -= 1;
      sends += 1;
    }
  } else if (retryAt != null && clock >= retryAt) {
    sends += 1;
    retryAt = null;
  }
}
assert.ok(freshLeft < 28);
assert.equal(sends > 0, true);
assert.ok(sends <= 60);

console.log("cadence tests passed");
