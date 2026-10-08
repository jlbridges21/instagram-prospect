import assert from "node:assert/strict";
import { DEFAULT_OUTREACH_SETTINGS } from "../lib/outreach/defaults";
import {
  atomicReclaim,
  confirmFollowAfterClick,
  expiredFollowNeedsStamp,
  isPreexistingFollow,
  orphanedFollowAction,
  recoverFollowDecision,
  shouldCompleteFollowWithoutClick,
  staleFollowRecovery,
  staleReclaimDecision,
  uncertainFollowResult,
} from "../lib/outreach/follow-confirm";
import { explainIdleQueue } from "../lib/outreach/idle-reason";
import { formatThroughputReport, outreachBlockReason } from "../lib/discovery/throughput";

async function main() {
  let clock = 0;
  const samples = ["not_following", "not_following", "not_following", "following"];
  let reads = 0;
  const confirmed = await confirmFollowAfterClick({
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    readRelationship: async () => samples[Math.min(reads++, samples.length - 1)] ?? "unknown",
    refresh: async () => undefined,
    windowMs: 12_000,
    pollMs: 1_000,
  });
  assert.equal(confirmed.confirmed, true);
  assert.equal(confirmed.relationship, "following");
  assert.equal(confirmed.clicks, 1);

  const requested = await confirmFollowAfterClick({
    now: () => 0,
    sleep: async () => undefined,
    readRelationship: async () => "requested",
    refresh: async () => undefined,
    windowMs: 1_000,
    pollMs: 1_000,
  });
  assert.equal(requested.confirmed, true);
  assert.equal(requested.relationship, "requested");

  let refreshCount = 0;
  clock = 0;
  const uncertain = await confirmFollowAfterClick({
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    readRelationship: async () => "not_following",
    refresh: async () => {
      refreshCount += 1;
    },
    windowMs: 4_000,
    pollMs: 1_000,
  });
  assert.equal(uncertain.confirmed, false);
  assert.equal(uncertain.clicks, 1);
  assert.equal(refreshCount, 1);
  assert.deepEqual(uncertainFollowResult(), {
    followClickAttempted: true,
    confirmation: "uncertain",
    error_code: "follow_confirmation_uncertain",
  });

  const prior = { followClickAttempted: true, verifyNotFollowing: true, executionStarted: true };
  assert.equal(shouldCompleteFollowWithoutClick({ ...prior, relationship: "following" }), true);
  assert.equal(shouldCompleteFollowWithoutClick({ ...prior, relationship: "requested" }), true);
  assert.equal(
    shouldCompleteFollowWithoutClick({
      relationship: "following",
      followClickAttempted: false,
      verifyNotFollowing: false,
      executionStarted: false,
    }),
    false,
  );
  assert.equal(
    isPreexistingFollow({
      relationship: "following",
      followClickAttempted: false,
      verifyNotFollowing: false,
      executionStarted: false,
    }),
    true,
  );

  const now = new Date("2026-10-03T02:19:00.000Z");
  const evening = { ...DEFAULT_OUTREACH_SETTINGS, activeEnd: "23:00" };
  const blocked = explainIdleQueue({
    now,
    timeZone: "America/Chicago",
    settings: evening,
    completedSendTimes: [],
    jobs: [
      {
        status: "running",
        jobType: "follow_profile",
        scheduledFor: "2026-10-03T02:06:00.000Z",
        username: "vsiaerial",
        claimExpiresAt: "2026-10-03T02:30:00.000Z",
      },
      {
        status: "pending",
        jobType: "send_message",
        scheduledFor: "2026-10-03T02:10:00.000Z",
        dependsOnStatus: "running",
        dependsOnType: "follow_profile",
        username: "vsiaerial",
      },
    ],
  });
  assert.notEqual(blocked.reason, "next_job_scheduled_for");
  assert.equal(blocked.nextAt, null);
  assert.match(blocked.message, /Follow account/);
  assert.doesNotMatch(blocked.message, /not due yet/);

  const dependency = explainIdleQueue({
    now,
    timeZone: "America/Chicago",
    settings: evening,
    completedSendTimes: [],
    jobs: [
      {
        status: "pending",
        jobType: "send_message",
        scheduledFor: "2026-10-03T02:10:00.000Z",
        dependsOnStatus: "running",
        dependsOnType: "follow_profile",
        username: "vsiaerial",
      },
    ],
  });
  assert.equal(dependency.reason, "stale_follow");
  assert.equal(dependency.nextAt, null);
  assert.doesNotMatch(dependency.message, /to complete/);

  const future = explainIdleQueue({
    now,
    timeZone: "America/Chicago",
    settings: evening,
    completedSendTimes: [],
    jobs: [
      {
        status: "pending",
        jobType: "send_message",
        scheduledFor: "2026-10-03T03:40:00.000Z",
        dependsOnStatus: "completed",
        username: "vsiaerial",
      },
    ],
  });
  assert.equal(future.reason, "next_job_scheduled_for");
  assert.equal(future.nextAt, "2026-10-03T03:40:00.000Z");

  const past = explainIdleQueue({
    now,
    timeZone: "America/Chicago",
    settings: evening,
    completedSendTimes: [],
    jobs: [
      {
        status: "pending",
        jobType: "send_message",
        scheduledFor: "2026-10-03T02:10:00.000Z",
        dependsOnStatus: "completed",
      },
    ],
  });
  assert.notEqual(past.reason, "next_job_scheduled_for");
  assert.equal(past.nextAt, null);

  assert.equal(
    expiredFollowNeedsStamp({
      job_type: "follow_profile",
      status: "running",
      started_at: "2026-10-03T02:06:00.000Z",
      claim_expires_at: "2026-10-03T02:11:00.000Z",
      result: null,
      now,
    }),
    true,
  );
  assert.equal(
    expiredFollowNeedsStamp({
      job_type: "follow_profile",
      status: "running",
      started_at: "2026-10-03T02:06:00.000Z",
      claim_expires_at: "2026-10-03T02:11:00.000Z",
      result: uncertainFollowResult(),
      now,
    }),
    false,
  );

  const stale = {
    id: "follow-1",
    status: "running",
    claimedBy: "worker-a",
    claimedAt: "2026-10-03T02:06:00.000Z",
    claimExpiresAt: "2026-10-03T02:11:00.000Z",
  };
  const reclaimed = atomicReclaim(stale, "worker-a", now, 300);
  assert.ok(reclaimed);
  assert.equal(reclaimed.claimedBy, "worker-a");
  assert.equal(reclaimed.status, "claimed");
  assert.ok(new Date(reclaimed.claimExpiresAt ?? 0).getTime() > now.getTime());
  assert.notEqual(reclaimed.claimExpiresAt, stale.claimExpiresAt);
  const stolen = atomicReclaim(reclaimed, "worker-b", now, 300);
  assert.equal(stolen, null);
  assert.equal(staleReclaimDecision(reclaimed, now, "worker-b").ok, false);
  const active = { ...stale, claimExpiresAt: new Date(now.getTime() + 60_000).toISOString(), claimedBy: "worker-a" };
  assert.equal(atomicReclaim(active, "worker-b", now, 300), null);

  const attempted = { followClickAttempted: true, verifyNotFollowing: true, executionStarted: true };
  const following = recoverFollowDecision({ ...attempted, relationship: "following" });
  const requestedRecovery = recoverFollowDecision({ ...attempted, relationship: "requested" });
  const missed = recoverFollowDecision({ ...attempted, relationship: "not_following" });
  assert.equal(following.action, "complete");
  assert.equal(following.clicks, 0);
  assert.equal(following.stopBeforeSend, true);
  assert.equal(requestedRecovery.action, "complete");
  assert.equal(requestedRecovery.clicks, 0);
  assert.equal(missed.action, "review");
  assert.equal(missed.clicks, 0);
  assert.equal(missed.stopBeforeSend, true);
  assert.equal(new Date(reclaimed.claimExpiresAt ?? 0).getTime() - now.getTime(), 300_000);
  assert.equal(atomicReclaim({ ...stale, status: "completed" }, "worker-a", now, 300), null);
  assert.equal(atomicReclaim({ ...stale, status: "cancelled" }, "worker-a", now, 300), null);
  assert.equal(atomicReclaim({ ...stale, status: "failed" }, "worker-a", now, 300), null);
  const claimError = (lease: { claimedBy: string | null; claimExpiresAt: string | null }, workerId: string, at: Date) => {
    if (lease.claimedBy !== workerId) return "This job belongs to another worker.";
    if (!lease.claimExpiresAt || new Date(lease.claimExpiresAt).getTime() <= at.getTime()) {
      return "The claim on this job has expired.";
    }
    return null;
  };
  assert.equal(claimError(stale, "worker-a", now), "The claim on this job has expired.");
  assert.equal(claimError(reclaimed, "worker-a", now), null);
  assert.notEqual(reclaimed.claimedAt, stale.claimedAt);

  const failedFollow = explainIdleQueue({
    now,
    timeZone: "America/Chicago",
    settings: evening,
    completedSendTimes: [],
    jobs: [
      {
        status: "pending",
        jobType: "send_message",
        scheduledFor: "2026-10-03T02:10:00.000Z",
        availableAt: "2026-10-03T02:10:00.000Z",
        dependsOnStatus: "failed",
        dependsOnType: "follow_profile",
        username: "greg.fabre",
      },
    ],
  });
  assert.equal(failedFollow.reason, "follow_needs_review");
  assert.equal(failedFollow.nextAt, null);
  assert.match(failedFollow.message, /@greg\.fabre/);
  assert.match(failedFollow.message, /needs review/);
  assert.doesNotMatch(failedFollow.message, /to complete/);
  assert.equal(outreachBlockReason(failedFollow.reason), "followVerificationUncertain");
  assert.equal(outreachBlockReason("stale_follow"), "followVerificationUncertain");
  const overdue = formatThroughputReport({
    configuredPerHour: 60,
    actualLast60Minutes: 28,
    opportunities: 60,
    missed: 0,
    lifetimeMissed: 0,
    waitingMs: 0,
    sourcingMs: 0,
    inspectingMs: 0,
    degraded: false,
    outreachBlocked: {
      minimumSpacing: 0,
      followVerificationUncertain: 1,
      recipientVerification: 0,
      browserUnavailable: 0,
      retryBackoff: 0,
    },
  });
  assert.match(overdue, /Current overdue slots: 0/);
  assert.match(overdue, /follow verification uncertain: 1/);
  assert.doesNotMatch(overdue, /Lifetime missed slots/);

  const restarted = {
    followClickAttempted: true,
    claimExpiresAt: "2026-10-03T02:00:00.000Z",
    reconciliationReadAt: null,
    localTaskAlive: false,
    now: now.getTime(),
  };
  assert.equal(orphanedFollowAction({ ...restarted, status: "failed" }), "read");
  assert.equal(orphanedFollowAction({ ...restarted, status: "running" }), "read");
  assert.equal(orphanedFollowAction({ ...restarted, status: "running", localTaskAlive: true, claimExpiresAt: "2026-10-03T02:30:00.000Z" }), "active");
  assert.equal(orphanedFollowAction({ ...restarted, status: "failed", reconciliationReadAt: now.toISOString() }), "terminal");
  assert.equal(staleFollowRecovery({ followClickAttempted: true, relationship: "following", attempts: 3 }).click, false);
  assert.equal(staleFollowRecovery({ followClickAttempted: true, relationship: "following", attempts: 3 }).action, "confirm");
  assert.equal(staleFollowRecovery({ followClickAttempted: true, relationship: "requested", attempts: 3 }).action, "confirm");
  assert.equal(staleFollowRecovery({ followClickAttempted: true, relationship: "not_following", attempts: 3 }).action, "needs_review");
  assert.equal(staleFollowRecovery({ followClickAttempted: true, relationship: "not_following", attempts: 3 }).click, false);
  assert.equal(staleFollowRecovery({ followClickAttempted: true, relationship: "unknown", attempts: 1 }).action, "retry");
  assert.equal(staleFollowRecovery({ followClickAttempted: true, relationship: "unknown", attempts: 3 }).action, "needs_review");

  console.log("follow confirmation tests passed");
}

main();
