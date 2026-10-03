import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { DEFAULT_OUTREACH_SETTINGS } from "../lib/outreach/defaults";
import { dryRunPlan, formatDryRun } from "../lib/outreach/dry-run-plan";
import { explainIdleQueue } from "../lib/outreach/idle-reason";
import {
  automationChange,
  bulkProspectActions,
  nextOutreachVersion,
  prospectOutreachFlags,
  requeueDecision,
  requeueSummary,
} from "../lib/outreach/requeue";

const cancelled = [
  { status: "cancelled", idempotencyKey: "p1:verify_profile:outreach-v1" },
  { status: "cancelled", idempotencyKey: "p1:follow_profile:outreach-v1" },
  { status: "completed", idempotencyKey: "p1:send_message:outreach-v1" },
];

const review = bulkProspectActions([
  { id: "a", status: "review", canRequeue: false, canSkip: true, canApprove: true },
  { id: "b", status: "review", canRequeue: false, canSkip: true, canApprove: true },
]);
assert.deepEqual(review.approveIds, ["a", "b"]);
assert.equal(review.requeueIds.length, 0);

const approved = bulkProspectActions([
  { id: "c", status: "approved", canRequeue: true, canSkip: true, canApprove: false },
  { id: "d", status: "approved", canRequeue: false, canSkip: true, canApprove: false },
]);
assert.deepEqual(approved.requeueIds, ["c"]);
assert.equal(approved.approveIds.length, 0);

const table = readFileSync("components/prospects/prospects-table.tsx", "utf8");
assert.match(table, /approveProspects/);
assert.match(table, /requeueProspects/);
assert.doesNotMatch(table, /queueProspect\(/);
assert.match(table, /Approve selected/);
assert.match(table, /Requeue selected/);
assert.match(table, /Approve all visible/);

const first = requeueDecision({ status: "approved", alreadyContacted: false, jobs: cancelled });
assert.equal(first.allowed, true);
if (first.allowed) assert.equal(first.version, 2);

const again = requeueDecision({
  status: "approved",
  alreadyContacted: false,
  jobs: [...cancelled, { status: "pending", idempotencyKey: "p1:verify_profile:outreach-v2" }],
});
assert.equal(again.allowed, false);
if (!again.allowed) assert.equal(again.reason, "already queued");

assert.equal(nextOutreachVersion(cancelled.map((job) => job.idempotencyKey)), 2);
assert.equal(
  requeueDecision({ status: "approved", alreadyContacted: true, jobs: cancelled }).allowed,
  false,
);
assert.equal(prospectOutreachFlags(cancelled).canRequeue, true);
assert.equal(prospectOutreachFlags([{ status: "pending", scheduledFor: "2026-10-03T14:00:00.000Z" }]).canRequeue, false);

const pause = automationChange(false, false);
assert.equal(pause.automationEnabled, false);
assert.equal(pause.cancelPendingJobs, false);
assert.equal(pause.changesProspectStatus, false);
assert.equal(automationChange(false, true).changesProspectStatus, false);
assert.equal(automationChange(true, true).cancelPendingJobs, false);

const outside = explainIdleQueue({
  now: new Date("2026-10-03T01:25:00.000Z"),
  timeZone: "America/Chicago",
  settings: DEFAULT_OUTREACH_SETTINGS,
  pendingScheduledFor: ["2026-10-03T14:14:00.000Z"],
  completedSendTimes: [],
});
assert.equal(outside.reason, "outside_active_hours");
assert.ok(outside.nextAt);

const none = explainIdleQueue({
  now: new Date("2026-10-03T15:00:00.000Z"),
  timeZone: "America/Chicago",
  settings: DEFAULT_OUTREACH_SETTINGS,
  pendingScheduledFor: [],
  completedSendTimes: [],
});
assert.equal(none.reason, "no_queued_jobs");
assert.notEqual(none.reason, outside.reason);

const hourly = explainIdleQueue({
  now: new Date("2026-10-03T15:00:00.000Z"),
  timeZone: "America/Chicago",
  settings: DEFAULT_OUTREACH_SETTINGS,
  pendingScheduledFor: ["2026-10-03T16:00:00.000Z"],
  completedSendTimes: Array.from({ length: DEFAULT_OUTREACH_SETTINGS.hourlyMaximum }, () => new Date("2026-10-03T15:10:00.000Z")),
});
assert.equal(hourly.reason, "hourly_limit_reached");

const plan = dryRunPlan({
  username: "yesserfpv",
  profileExists: true,
  observedUsername: "yesserfpv",
  relationship: "not_following",
  message: "Hi Zack. I’m Jackson.",
});
const printed = formatDryRun({
  username: "yesserfpv",
  relationship: "not_following",
  profileExists: true,
  plan,
});
assert.match(printed, /Would follow: YES/);
assert.match(printed, /Would send: YES/);
assert.match(printed, /No jobs were completed/);
assert.equal(plan.wouldFollow, true);
assert.match(requeueSummary({ requeued: 2, skipped: 1 }), /2 requeued/);
assert.match(requeueSummary({ requeued: 2, skipped: 1 }), /1 skipped/);

console.log("outreach recovery tests passed");
