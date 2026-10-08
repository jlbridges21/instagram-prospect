import assert from "node:assert/strict";
import { discoveryMissReason } from "../lib/discovery/throughput";
import { stallRecoveryAction } from "../lib/discovery/cadence";
import {
  followAttemptPlan,
  followClickLatched,
  latchFollowClick,
  nextFollowVerification,
  shouldAnnounceUncertainFollow,
  shouldAnnounceVerificationStart,
} from "../lib/outreach/follow-confirm";
import { claimPaceDecision, type PaceJob } from "../lib/outreach/pace";
import { BrowserActionLock, browserLeaseAllowsForceRelease, nextOrchestratorStep, releaseAfterUncertainFollow } from "../lib/worker/orchestrator";

const now = new Date("2026-10-08T14:00:00.000Z");

assert.deepEqual(followAttemptPlan({ followClickAttempted: false, relationship: "not_following" }), {
  click: true,
  action: "click",
});
assert.deepEqual(followAttemptPlan({ followClickAttempted: true, relationship: "following" }), {
  click: false,
  action: "complete",
});
assert.deepEqual(followAttemptPlan({ followClickAttempted: true, relationship: "not_following" }), {
  click: false,
  action: "verify",
});
assert.equal(followAttemptPlan({ followClickAttempted: true, relationship: "unknown" }).click, false);

const first = nextFollowVerification({ attemptsSoFar: 0, now: now.getTime() });
assert.equal(first.action, "retry_later");
assert.equal(first.minutes, 8);
assert.equal(first.state, "follow_verification_uncertain");
const second = nextFollowVerification({ attemptsSoFar: 1, now: now.getTime() });
assert.equal(second.action, "retry_later");
assert.equal(second.minutes, 25);
const review = nextFollowVerification({ attemptsSoFar: 2, now: now.getTime() });
assert.equal(review.action, "needs_review");
assert.equal(review.status, "failed");
assert.equal(nextFollowVerification({ attemptsSoFar: 3, now: now.getTime(), manual: true }).action, "needs_review");

function job(id: string, prospectId: string, status: string, extra: Partial<PaceJob> = {}): PaceJob {
  return {
    id,
    prospectId,
    username: prospectId,
    jobType: "follow_profile",
    status,
    scheduledFor: now.toISOString(),
    availableAt: now.toISOString(),
    ...extra,
  };
}

const fresh = job("fresh-follow", "fresh", "pending");
const uncertain = job("mister", "mister_mke", "retry_wait", {
  result: { followClickAttempted: true, confirmation: "uncertain" },
  availableAt: new Date(now.getTime() + 8 * 60_000).toISOString(),
});
const paced = claimPaceDecision({
  now,
  timeZone: "America/Chicago",
  minimumSpacingSeconds: 0,
  hourlyMaximum: 20,
  dailyMaximum: 150,
  completedSendTimes: [],
  jobs: [fresh, uncertain],
});
assert.equal(paced.action, "claim");
assert.equal(paced.prospectId, "fresh");
assert.notEqual(paced.kind, "follow_verification");

const notDue = claimPaceDecision({
  now,
  timeZone: "America/Chicago",
  minimumSpacingSeconds: 0,
  hourlyMaximum: 20,
  dailyMaximum: 150,
  completedSendTimes: [],
  jobs: [uncertain],
});
assert.equal(notDue.action, "wait");
assert.equal(notDue.kind, undefined);

const dueUncertain = job("mister-due", "mister_mke", "retry_wait", {
  result: { followClickAttempted: true, confirmation: "uncertain" },
});
const onlyDue = claimPaceDecision({
  now,
  timeZone: "America/Chicago",
  minimumSpacingSeconds: 0,
  hourlyMaximum: 20,
  dailyMaximum: 150,
  completedSendTimes: [],
  jobs: [dueUncertain],
});
assert.equal(onlyDue.kind, "follow_verification");

latchFollowClick("a59727b3-f32d-4966-ba73-0933fc4acdcf");
assert.equal(followClickLatched("a59727b3-f32d-4966-ba73-0933fc4acdcf"), true);
assert.equal(followAttemptPlan({ followClickAttempted: followClickLatched("a59727b3-f32d-4966-ba73-0933fc4acdcf"), relationship: "not_following" }).click, false);

const lock = new BrowserActionLock();
lock.tryAcquire("outreach", true);
assert.equal(lock.isCritical(), true);
const held = releaseAfterUncertainFollow({
  persisted: true,
  clearSideEffect: () => undefined,
  releaseLock: () => lock.release("outreach"),
});
assert.equal(held.released, true);
assert.equal(lock.heldBy(), null);
const kept = new BrowserActionLock();
kept.tryAcquire("outreach", true);
const blocked = releaseAfterUncertainFollow({
  persisted: false,
  clearSideEffect: () => undefined,
  releaseLock: () => kept.release("outreach"),
});
assert.equal(blocked.released, false);
assert.equal(kept.heldBy(), "outreach");
assert.equal(browserLeaseAllowsForceRelease({ phase: "click", heldMs: 120_000, maxVerifyMs: 30_000 }), false);
assert.equal(browserLeaseAllowsForceRelease({ phase: "verify", heldMs: 20_000, maxVerifyMs: 30_000 }), false);
assert.equal(browserLeaseAllowsForceRelease({ phase: "verify", heldMs: 30_000, maxVerifyMs: 30_000 }), true);

const step = nextOrchestratorStep({
  now: now.getTime(),
  attention: false,
  heartbeatDueAt: now.getTime() + 60_000,
  outreach: { desired: true, critical: false, eligibleNow: false, nextEligibleAt: now.getTime() + 8 * 60_000 },
  discovery: { desired: true, eligibleNow: true, nextEligibleAt: now.getTime(), inspectionInProgress: false },
});
assert.equal(step.action, "discovery");

assert.equal(discoveryMissReason({
  outreachOwnsBrowser: true,
  browserRecovering: false,
  candidateStarved: true,
  waitingForSlot: false,
}), "outreach_browser");
assert.equal(stallRecoveryAction("outreach_browser").message, "Discovery waiting — Outreach owns the browser");
assert.notEqual(stallRecoveryAction("outreach_browser").message, "Discovery degraded — candidate starvation");

assert.equal(shouldAnnounceUncertainFollow("a59727b3-f32d-4966-ba73-0933fc4acdcf"), true);
assert.equal(shouldAnnounceUncertainFollow("a59727b3-f32d-4966-ba73-0933fc4acdcf"), false);
assert.equal(shouldAnnounceVerificationStart("a59727b3-f32d-4966-ba73-0933fc4acdcf", 1_000), true);
assert.equal(shouldAnnounceVerificationStart("a59727b3-f32d-4966-ba73-0933fc4acdcf", 2_000), false);

console.log("follow orchestration tests passed");
