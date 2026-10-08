import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { confirmFollowAfterClick, followAttemptPlan, staleFollowReadReady } from "../lib/outreach/follow-confirm";
import {
  diagnosticFollowPlan,
  FOLLOW_DIAGNOSTIC_DELAYS_MS,
  FOLLOW_RESTRICTION_MESSAGE,
  followClickSettlement,
  prepareFollowClick,
  PREVIOUS_FOLLOW_NOT_CONFIRMED,
  unconfirmedFollowShouldPark,
  visibleFollowRestriction,
} from "../lib/outreach/follow-click";
import { claimPaceDecision, type PaceJob } from "../lib/outreach/pace";
import { formatDiscoveryStatus, formatOutreachStatus } from "../lib/status/operations";

const box = { x: 680, y: 180, width: 88, height: 32 };
const actions = fs.readFileSync(path.join(process.cwd(), "worker/instagram/actions.ts"), "utf8");
const diagnostic = fs.readFileSync(path.join(process.cwd(), "scripts/agent-test-follow.ts"), "utf8");
const dispatch = actions.slice(actions.indexOf("async function dispatchFreshFollow"), actions.indexOf("async function confirmRelationship"));
const follow = actions.slice(actions.indexOf("export async function followProfile"), actions.indexOf("export async function diagnoseFollowOnce"));

assert.ok(dispatch.indexOf("await readDom(page)") >= 0);
assert.ok(dispatch.indexOf("await readDom(page)") < dispatch.indexOf("page.mouse.click"));
assert.ok(follow.indexOf("await dispatchFreshFollow") < follow.indexOf("prior?.onClickDispatched?.()"));
assert.equal(follow.includes("onBeforeClick"), false);

assert.equal(prepareFollowClick({
  expectedUsername: "fresh.account",
  currentUsername: "someone.else",
  label: "Follow",
  box,
}).click, false);
assert.equal(prepareFollowClick({
  expectedUsername: "fresh.account",
  currentUsername: "fresh.account",
  label: "Following",
  box,
}).click, false);
assert.equal(prepareFollowClick({
  expectedUsername: "fresh.account",
  currentUsername: "fresh.account",
  label: "Follow",
  box,
}).click, true);
assert.equal(prepareFollowClick({
  expectedUsername: "fresh.account",
  currentUsername: "fresh.account",
  label: "Follow Back",
  box,
}).click, true);

assert.equal(followClickSettlement({ dispatched: true, relationship: "not_following", restriction: false }).state, "follow_not_confirmed");
assert.equal(followClickSettlement({ dispatched: true, relationship: "not_following", restriction: false }).confirmed, false);
assert.equal(followClickSettlement({ dispatched: true, relationship: "following", restriction: false }).state, "follow_confirmed");
assert.equal(followClickSettlement({ dispatched: true, relationship: "requested", restriction: false }).state, "follow_confirmed");
assert.equal(followClickSettlement({ dispatched: false, relationship: "not_following", restriction: false }).recordClick, false);
const restricted = followClickSettlement({ dispatched: true, relationship: "unknown", restriction: true });
assert.equal(restricted.pauseOutreach, true);
assert.equal(restricted.confirmed, false);
assert.equal(visibleFollowRestriction("Try again later"), "action_blocked");
assert.equal(visibleFollowRestriction("Couldn't follow this account"), "action_blocked");

const outreach = formatOutreachStatus({
  online: true,
  enabled: false,
  queueCount: 4,
  attention: "other",
  attentionText: FOLLOW_RESTRICTION_MESSAGE,
});
assert.equal(outreach.label, "Needs Attention");
assert.equal(outreach.reason, FOLLOW_RESTRICTION_MESSAGE);
const discovery = formatDiscoveryStatus({
  online: true,
  enabled: true,
  stopReason: null,
  hourly: null,
  attention: "other",
  attentionText: FOLLOW_RESTRICTION_MESSAGE,
  reviewCount: 1,
  reviewTarget: 25,
});
assert.equal(discovery.actual, "RUNNING");

assert.equal(unconfirmedFollowShouldPark({
  jobType: "follow_profile",
  status: "failed",
  followClickAttempted: true,
  relationship: "not_following",
  lastError: "Follow state could not be verified after click.",
}), true);
assert.equal(unconfirmedFollowShouldPark({
  jobType: "follow_profile",
  status: "failed",
  followClickAttempted: true,
  relationship: "not_following",
  lastError: PREVIOUS_FOLLOW_NOT_CONFIRMED,
}), false);
assert.equal(followAttemptPlan({ followClickAttempted: true, relationship: "not_following" }).click, false);

const now = new Date("2026-10-08T20:00:00.000Z");
function paceJob(id: string, prospectId: string, status: string, extra: Partial<PaceJob> = {}): PaceJob {
  return {
    id,
    prospectId,
    username: prospectId,
    jobType: extra.jobType ?? "follow_profile",
    status,
    scheduledFor: now.toISOString(),
    availableAt: now.toISOString(),
    ...extra,
  };
}
const oldFollow = paceJob("old", "greg.fabre", "failed", {
  result: {
    followClickAttempted: true,
    confirmation: "uncertain",
    startupVerified: true,
    evidence: { relationship: "not_following" },
  },
});
const freshFollow = paceJob("fresh", "fresh.account", "pending");
const pace = {
  now,
  timeZone: "America/Chicago",
  minimumSpacingSeconds: 0,
  hourlyMaximum: 20,
  dailyMaximum: 150,
  completedSendTimes: [] as Date[],
};
assert.equal(staleFollowReadReady(oldFollow, now), false);
assert.equal(claimPaceDecision({ ...pace, jobs: [oldFollow, freshFollow] }).prospectId, "fresh.account");
assert.notEqual(claimPaceDecision({ ...pace, jobs: [oldFollow] }).kind, "follow_verification");

assert.equal(diagnosticFollowPlan({ relationship: "not_following", alreadyClicked: false }).send, false);
assert.equal(diagnosticFollowPlan({ relationship: "not_following", alreadyClicked: false }).click, true);
assert.equal(diagnosticFollowPlan({ relationship: "not_following", alreadyClicked: true }).click, false);
assert.deepEqual(FOLLOW_DIAGNOSTIC_DELAYS_MS, [0, 250, 750, 1_500, 3_000, 5_000, 8_000]);
assert.equal(diagnostic.includes("sendExactMessage"), false);
assert.equal(diagnostic.includes("diagnoseFollowOnce"), true);
assert.equal(actions.includes("No DM was sent. Follow was clicked once."), true);

async function main() {
  let reads = 0;
  const stopped = await confirmFollowAfterClick({
    now: () => 0,
    sleep: async () => undefined,
    readRelationship: async () => {
      reads += 1;
      return "restricted";
    },
    refresh: async () => {
      throw new Error("A restriction must stop verification before a reload.");
    },
    delaysMs: [0, 1_000, 2_000, 4_000, 7_000],
    windowMs: 20_000,
  });
  assert.equal(stopped.confirmed, false);
  assert.equal(reads, 1);
  console.log("follow click tests passed");
}

main();
