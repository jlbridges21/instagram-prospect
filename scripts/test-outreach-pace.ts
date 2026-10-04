import assert from "node:assert/strict";
import { claimPaceDecision, jobIsUncertain, nextProspectSlot, reflowPlan, type PaceJob } from "../lib/outreach/pace";
import { nextSendInstant } from "../lib/outreach/scheduler";
import { zonedParts, zonedTimeToUtc } from "../lib/outreach/time";
import { DEFAULT_OUTREACH_SETTINGS } from "../lib/outreach/defaults";

const zone = "America/Chicago";
const at = (hour: number, minute: number) => zonedTimeToUtc({ year: 2026, month: 10, day: 3, hour, minute }, zone);

const bradFinished = at(20, 30);
const next = nextProspectSlot({
  now: bradFinished,
  timeZone: zone,
  minimumSpacingSeconds: 360,
  hourlyMaximum: 10,
  dailyMaximum: 50,
  completedSendTimes: [bradFinished],
});
const nextParts = zonedParts(next.at, zone);
assert.equal(next.reason, "minimum_spacing");
assert.equal(nextParts.hour, 20);
assert.equal(nextParts.minute, 36);

const ignoredWindow = nextSendInstant({
  now: bradFinished,
  timeZone: zone,
  settings: { ...DEFAULT_OUTREACH_SETTINGS, activeStart: "09:00", activeEnd: "19:00", minimumActionDelaySeconds: 360, hourlyMaximum: 10, dailyMaximum: 50 },
  occupied: [bradFinished],
  seed: "legacy-window",
});
assert.equal(zonedParts(ignoredWindow, zone).hour, 20);
assert.equal(zonedParts(ignoredWindow, zone).minute, 36);

const oldest = new Date(bradFinished.getTime() - 50 * 60 * 1000);
const hourlySends = Array.from({ length: 10 }, (_, index) => new Date(oldest.getTime() + index * 60 * 1000));
const hourly = nextProspectSlot({
  now: bradFinished,
  timeZone: zone,
  minimumSpacingSeconds: 360,
  hourlyMaximum: 10,
  dailyMaximum: 50,
  completedSendTimes: hourlySends,
});
assert.equal(hourly.reason, "hourly_limit");
assert.equal(hourly.at.getTime(), oldest.getTime() + 60 * 60 * 1000);

const dailySends = Array.from({ length: 50 }, (_, index) => new Date(at(9, 0).getTime() + index * 60 * 1000));
const daily = nextProspectSlot({
  now: bradFinished,
  timeZone: zone,
  minimumSpacingSeconds: 360,
  hourlyMaximum: 100,
  dailyMaximum: 50,
  completedSendTimes: dailySends,
});
const dailyParts = zonedParts(daily.at, zone);
assert.equal(daily.reason, "daily_limit");
assert.equal(dailyParts.day, 4);
assert.equal(dailyParts.hour, 0);
assert.equal(dailyParts.minute, 0);

function pending(id: string, prospectId: string, type: PaceJob["jobType"], scheduledFor: string, extra: Partial<PaceJob> = {}): PaceJob {
  return {
    id,
    prospectId,
    username: prospectId,
    jobType: type,
    status: "pending",
    scheduledFor,
    availableAt: scheduledFor,
    ...extra,
  };
}

const midnight = "2026-10-04T05:00:00.000Z";
const queued = [
  pending("v", "next-prospect", "verify_profile", midnight),
  pending("f", "next-prospect", "follow_profile", midnight),
  pending("s", "next-prospect", "send_message", midnight),
];
const completed: PaceJob = {
  id: "done",
  prospectId: "brad",
  username: "bradsflights",
  jobType: "send_message",
  status: "completed",
  scheduledFor: bradFinished.toISOString(),
  completedAt: bradFinished.toISOString(),
};
const uncertain: PaceJob = {
  id: "unsure",
  prospectId: "hold",
  username: "hold",
  jobType: "send_message",
  status: "pending",
  scheduledFor: midnight,
  result: { confirmation: "uncertain", sendAttempted: true },
};
assert.equal(jobIsUncertain(uncertain), true);
assert.equal(jobIsUncertain(completed), false);

const plan = reflowPlan({
  now: bradFinished,
  timeZone: zone,
  minimumSpacingSeconds: 360,
  hourlyMaximum: 10,
  dailyMaximum: 50,
  completedSendTimes: [bradFinished],
  jobs: [...queued, completed, uncertain, pending("hold-verify", "hold", "verify_profile", midnight)],
});
assert.deepEqual(plan.updates.map((update) => update.id).sort(), ["f", "s", "v"]);
assert.equal(plan.updates[0]?.scheduledFor, next.at.toISOString());
assert.equal(plan.updates.some((update) => update.id === "done" || update.id === "unsure"), false);

const decision = claimPaceDecision({
  now: bradFinished,
  timeZone: zone,
  minimumSpacingSeconds: 360,
  hourlyMaximum: 10,
  dailyMaximum: 50,
  completedSendTimes: [bradFinished],
  jobs: queued,
});
assert.equal(decision.action, "wait");
assert.equal(decision.reason, "minimum_spacing");
assert.equal(decision.username, "next-prospect");

console.log("outreach pace tests passed");
