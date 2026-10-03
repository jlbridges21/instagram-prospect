import assert from "node:assert/strict";
import { DEFAULT_OUTREACH_SETTINGS } from "../lib/outreach/defaults";
import {
  confirmFollowAfterClick,
  expiredFollowNeedsStamp,
  isPreexistingFollow,
  shouldCompleteFollowWithoutClick,
  uncertainFollowResult,
} from "../lib/outreach/follow-confirm";
import { explainIdleQueue } from "../lib/outreach/idle-reason";

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
  assert.equal(dependency.reason, "dependency_not_complete");
  assert.equal(dependency.nextAt, null);

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

  console.log("follow confirmation tests passed");
}

main();
