import assert from "node:assert/strict";
import { sendRecoveryDecision } from "../lib/outreach/dm";
import {
  JobQuarantine,
  cappedFailurePlan,
  existingFailureRecord,
  persistFailure,
  reconcileRunningSend,
  retryDelayMinutes,
} from "../lib/outreach/failure-sync";
import { formatDiscoveryStatus, formatOutreachStatus, isStateSyncFailure } from "../lib/status/operations";

const unconfirmed = sendRecoveryDecision({
  sendAttempted: false,
  exactOutboundPresent: false,
  composerFound: true,
  priorConversation: false,
  conversationMatches: false,
});
assert.equal(unconfirmed.send, false);
assert.match(unconfirmed.reason ?? "", /thread identity was not confirmed/);

const now = Date.parse("2026-10-04T02:30:00.000Z");
const second = cappedFailurePlan({ attemptCount: 1, maxAttempts: 3, retryable: true });
assert.equal(second.status, "retry_wait");
assert.equal(second.delayMinutes, 15);
assert.equal(second.attemptCount, 2);
const scheduled = new Date(now + second.delayMinutes! * 60 * 1000).toISOString();
assert.equal(scheduled, "2026-10-04T02:45:00.000Z");

const stuck = cappedFailurePlan({ attemptCount: 4, maxAttempts: 3, retryable: true });
assert.equal(stuck.attemptCount, 4);
assert.equal(stuck.incremented, false);
assert.equal(stuck.status, "failed");
assert.ok(stuck.attemptCount <= 3 + 1);

const recorded = {
  status: "retry_wait",
  attempt_count: 2,
  result: { error_code: "recipient_confirmation_failed", sendAttempted: false },
};
assert.deepEqual(existingFailureRecord(recorded, "recipient_confirmation_failed"), {
  status: "retry_wait",
  attemptCount: 2,
});
assert.equal(existingFailureRecord(recorded, "recipient_confirmation_failed")?.attemptCount, 2);
assert.equal(cappedFailurePlan({ attemptCount: recorded.attempt_count, maxAttempts: 3, retryable: true }).attemptCount, 2 + 1);
const replay = existingFailureRecord(recorded, "recipient_confirmation_failed");
assert.equal(replay?.attemptCount, recorded.attempt_count);

const quarantine = new JobQuarantine();
let browserRuns = 0;
function browserOnce(jobId: string) {
  if (!quarantine.allowsBrowser(jobId)) return;
  browserRuns += 1;
  quarantine.noteBrowserRun(jobId, "nomadic_explorista");
}
browserOnce("job-1");
browserOnce("job-1");
assert.equal(browserRuns, 1);

async function main() {
let writes = 0;
const savedOnSecond = await persistFailure({
  write: async () => {
    writes += 1;
    if (writes < 2) throw new Error("Could not record the job failure.");
  },
  sleep: async () => undefined,
  log: () => undefined,
});
assert.equal(savedOnSecond.ok, true);
assert.equal(savedOnSecond.attempts, 2);
assert.equal(writes, 2);
quarantine.clear("job-1");
assert.equal(quarantine.allowsBrowser("job-1"), true);

const blockedQuarantine = new JobQuarantine();
blockedQuarantine.noteBrowserRun("job-1", "nomadic_explorista");
let failedWrites = 0;
const blocked = await persistFailure({
  write: async () => {
    failedWrites += 1;
    throw new Error("Could not record the job failure.");
  },
  sleep: async () => undefined,
  log: () => undefined,
});
assert.equal(blocked.ok, false);
assert.equal(failedWrites, 4);
blockedQuarantine.markBlocked("job-1");
assert.equal(blockedQuarantine.allowsBrowser("job-1"), false);
assert.equal(blockedQuarantine.browserRuns("job-1"), 1);

const other = new JobQuarantine();
other.noteBrowserRun("bad", "nomadic_explorista");
assert.equal(other.allowsBrowser("other-prospect"), true);

const restarted = reconcileRunningSend(
  {
    job_type: "send_message",
    status: "running",
    attempt_count: 4,
    max_attempts: 3,
    available_at: "2026-10-04T02:37:26.249Z",
    result: { error_code: "recipient_confirmation_failed", sendAttempted: false },
    last_error: "Composer was found but thread identity was not confirmed.",
  },
  new Date(now),
);
assert.equal(restarted?.status, "failed");
assert.equal(restarted?.attempt_count, 4);
assert.equal(restarted?.claimed_by_worker_id, null);

const uncertain = reconcileRunningSend(
  {
    job_type: "send_message",
    status: "running",
    attempt_count: 1,
    max_attempts: 3,
    available_at: new Date(now).toISOString(),
    result: { sendAttempted: true, confirmation: "uncertain" },
    last_error: null,
  },
  new Date(now),
);
assert.equal(uncertain, null);

const outreach = formatOutreachStatus({
  online: true,
  enabled: true,
  queueCount: 2,
  attention: null,
  stateSync: { username: "nomadic_explorista" },
});
assert.equal(outreach.actual, "BLOCKED");
assert.match(outreach.reason, /synchronize Outreach job state/);
assert.match(outreach.detail ?? "", /@nomadic_explorista/);
assert.match(outreach.detail ?? "", /No DM was sent/);

const discovery = formatDiscoveryStatus({
  online: true,
  enabled: true,
  stopReason: null,
  hourly: null,
  attention: null,
  reviewCount: 1,
  reviewTarget: 20,
});
assert.equal(discovery.actual, "RUNNING");
assert.equal(isStateSyncFailure("Could not save retry state for @nomadic_explorista. No DM was sent."), true);
assert.equal(retryDelayMinutes(4, 3), null);

console.log("failure sync tests passed");
}

main();
