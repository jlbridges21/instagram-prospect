import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { claimPaceDecision, formatOutreachSelection, type PaceJob } from "../lib/outreach/pace";

const now = new Date("2026-10-08T19:00:00.000Z");

function job(id: string, prospectId: string, status: string, extra: Partial<PaceJob> = {}): PaceJob {
  return {
    id,
    prospectId,
    username: extra.username ?? prospectId,
    jobType: extra.jobType ?? "verify_profile",
    status,
    scheduledFor: now.toISOString(),
    availableAt: now.toISOString(),
    ...extra,
  };
}

function decide(jobs: PaceJob[], spacingSeconds = 0) {
  return claimPaceDecision({
    now,
    timeZone: "America/Chicago",
    minimumSpacingSeconds: spacingSeconds,
    hourlyMaximum: 40,
    dailyMaximum: 150,
    completedSendTimes: [],
    jobs,
  });
}

const futureRetry = job("retry", "later.account", "retry_wait", {
  jobType: "send_message",
  availableAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
});
const fresh = job("fresh", "fresh.account", "pending");
const futureAndFresh = decide([futureRetry, fresh]);
assert.equal(futureAndFresh.action, "claim");
assert.equal(futureAndFresh.username, "fresh.account");
assert.equal(futureAndFresh.selection, "fresh_ready");

const futureFollow = job("follow-later", "later.follow", "retry_wait", {
  jobType: "follow_profile",
  availableAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
  result: { followClickAttempted: true, nextVerificationAt: new Date(now.getTime() + 5 * 60_000).toISOString() },
});
const futureFollowAndFresh = decide([futureFollow, fresh]);
assert.equal(futureFollowAndFresh.action, "claim");
assert.equal(futureFollowAndFresh.username, "fresh.account");
assert.equal(futureFollowAndFresh.selection, "fresh_ready");

const dueRetry = job("due", "due.account", "retry_wait", { jobType: "verify_profile" });
const dueAndFresh = decide([dueRetry, fresh]);
assert.equal(dueAndFresh.action, "claim");
assert.equal(dueAndFresh.username, "fresh.account");
assert.equal(dueAndFresh.selection, "fresh_ready");

const onlyFuture = decide([futureRetry]);
assert.equal(onlyFuture.action, "wait");
assert.equal(onlyFuture.selection, "none");
assert.equal(onlyFuture.detail, "all jobs future scheduled");
assert.equal(onlyFuture.counts.freshReady, 0);
assert.equal(onlyFuture.counts.futureRetries, 1);

const approved = decide([
  job("verify", "approved.account", "pending", { jobType: "verify_profile" }),
  job("follow", "approved.account", "pending", { jobType: "follow_profile" }),
  job("send", "approved.account", "pending", { jobType: "send_message" }),
]);
assert.equal(approved.action, "claim");
assert.equal(approved.selection, "fresh_ready");
assert.equal(approved.counts.freshReady, 1);

const review = decide([
  job("old-follow", "old.account", "failed", {
    jobType: "follow_profile",
    result: { followClickAttempted: true, startupVerified: true, evidence: { relationship: "not_following" } },
  }),
  job("old-send", "old.account", "pending", { jobType: "send_message" }),
]);
assert.equal(review.action, "idle");
assert.equal(review.selection, "none");
assert.equal(review.counts.needsReview, 1);
assert.equal(review.counts.freshReady, 0);

const contacted = decide([
  job("done", "contacted.account", "completed", { jobType: "send_message" }),
]);
assert.equal(contacted.action, "idle");
assert.equal(contacted.selection, "none");
assert.equal(contacted.counts.completed, 1);
assert.equal(contacted.counts.freshReady, 0);

const text = formatOutreachSelection({
  counts: onlyFuture.counts,
  username: null,
  selection: "none",
  detail: onlyFuture.detail,
  nextAt: onlyFuture.at,
  timeZone: "America/Chicago",
  now,
});
assert.match(text, /Ready now: 0/);
assert.match(text, /Future retries: 1/);
assert.match(text, /reason:\nall jobs future scheduled/);

const dryRun = fs.readFileSync(path.join(process.cwd(), "scripts/agent-dry-run-next.ts"), "utf8");
assert.equal(dryRun.includes("playwright"), false);
assert.equal(dryRun.includes("claim_next_outreach_job"), false);
assert.equal(dryRun.includes("mouse.click"), false);
assert.equal(dryRun.includes("sendExactMessage"), false);

console.log("outreach selection tests passed");
