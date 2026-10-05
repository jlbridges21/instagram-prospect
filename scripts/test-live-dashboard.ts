import assert from "node:assert/strict";
import { livePollDelay } from "../lib/discovery/policy";
import { queueHealth, type PaceJob } from "../lib/outreach/pace";
import { compareQueueJobs, mergeTabJobs } from "../lib/outreach/queue-sort";
import { formatCountdown } from "../lib/ui/countdown";
import { dashboardListenerCount, subscribeDashboardStatus } from "../components/worker/status-poll";
import { liveClockListenerCount, subscribeLiveClock } from "../components/ui/live-clock";

const now = Date.parse("2026-10-05T12:00:00.000Z");

assert.equal(formatCountdown(now, now), "Eligible now");
assert.equal(formatCountdown(now + 1000, now), "1s");
assert.equal(formatCountdown(now + 59_000, now), "59s");
assert.equal(formatCountdown(now + 60_000, now), "1m 00s");
assert.equal(formatCountdown(now + 122_000, now), "2m 02s");
assert.equal(formatCountdown(now + 3_661_000, now), "1h 01m");
assert.equal(formatCountdown(now - 5000, now), "Eligible now");
assert.equal(formatCountdown(null, now), "Eligible now");

const target = now + 90_000;
assert.equal(formatCountdown(target, now), "1m 30s");
assert.equal(formatCountdown(target, target + 10_000), "Eligible now");

assert.equal(livePollDelay(true), 4_000);
assert.equal(livePollDelay(false), 30_000);

const stopClock = subscribeLiveClock(() => undefined);
assert.equal(liveClockListenerCount(), 1);
stopClock();
assert.equal(liveClockListenerCount(), 0);

const stopPoll = subscribeDashboardStatus(() => undefined);
assert.equal(dashboardListenerCount(), 1);
stopPoll();
assert.equal(dashboardListenerCount(), 0);

const older = job("older", "completed", "2026-10-05T11:00:00.000Z");
const newer = job("newer", "completed", "2026-10-05T12:00:00.000Z");
assert.ok(compareQueueJobs("completed", newer, older) < 0);

const failedOlder = job("failed-older", "failed", "2026-10-05T11:00:00.000Z", "2026-10-05T11:00:00.000Z");
const failedNewer = job("failed-newer", "failed", "2026-10-05T12:00:00.000Z", "2026-10-05T12:00:00.000Z");
assert.ok(compareQueueJobs("failed", failedNewer, failedOlder) < 0);

const early = { ...job("early", "pending", null), scheduled_for: "2026-10-05T12:00:00.000Z", available_at: "2026-10-05T12:00:00.000Z" };
const late = { ...job("late", "pending", null), scheduled_for: "2026-10-05T13:00:00.000Z", available_at: "2026-10-05T13:00:00.000Z" };
assert.ok(compareQueueJobs("upcoming", early, late) < 0);

const startedEarlier = { ...job("started-earlier", "running", null), started_at: "2026-10-05T11:00:00.000Z" };
const startedLater = { ...job("started-later", "running", null), started_at: "2026-10-05T12:00:00.000Z" };
assert.ok(compareQueueJobs("progress", startedLater, startedEarlier) < 0);

const cancelledEarlier = { ...job("cancelled-earlier", "cancelled", null), cancelled_at: "2026-10-05T11:00:00.000Z" };
const cancelledLater = { ...job("cancelled-later", "cancelled", null), cancelled_at: "2026-10-05T12:00:00.000Z" };
assert.ok(compareQueueJobs("cancelled", cancelledLater, cancelledEarlier) < 0);

const merged = mergeTabJobs(
  [
    { id: "queued", status: "pending" },
    { id: "done", status: "completed" },
  ],
  [{ id: "fresh", status: "pending" }],
  ["pending", "retry_wait"],
);
assert.deepEqual(merged.map((row) => row.id), ["done", "fresh"]);

const before = queueHealth([
  pace("a", "pending"),
  pace("b", "pending"),
  pace("c", "retry_wait"),
]);
const after = queueHealth([
  pace("b", "pending"),
  pace("c", "retry_wait"),
]);
assert.equal(before.remaining, 3);
assert.equal(after.remaining, 2);
assert.equal(after.fresh, 1);

console.log("live dashboard ok");

function job(id: string, status: string, completedAt: string | null, failedAt: string | null = null) {
  return {
    id,
    status,
    scheduled_for: "2026-10-05T10:00:00.000Z",
    completed_at: completedAt,
    failed_at: failedAt,
    updated_at: failedAt ?? completedAt,
  };
}

function pace(id: string, status: string): PaceJob {
  return { id, prospectId: id, jobType: "verify_profile", status, scheduledFor: "2026-10-05T12:00:00.000Z" };
}
