import assert from "node:assert/strict";
import { failurePlan } from "../lib/outreach/decisions";
import {
  detectComposer,
  messageAllowedForSequence,
  queueSendStatusLabel,
  selectPrimaryMessageAction,
  sendConfirmation,
  sendRecoveryDecision,
  sequenceOwnsFollow,
  shouldMarkContacted,
  threadHasExactOutbound,
  waitForComposer,
  type MessageHit,
} from "../lib/outreach/dm";
import { dryRunPlan, formatDryRun } from "../lib/outreach/dry-run-plan";
import { atomicReclaim } from "../lib/outreach/follow-confirm";

const usernameBox = { x: 200, y: 80, width: 120, height: 24 };
const near = { x: 420, y: 120, width: 80, height: 32 };

function hit(overrides: Partial<MessageHit> = {}): MessageHit {
  return {
    label: "Message",
    tag: "button",
    role: "",
    text: "Message",
    ariaLabel: "Message",
    inSuggestion: false,
    inNavigation: false,
    inDialog: false,
    box: near,
    ancestor: null,
    ...overrides,
  };
}

const locked = "Hi there.";
const owned = sequenceOwnsFollow({ followed: true, relationshipStatus: "following" });
assert.equal(owned, true);
assert.equal(sequenceOwnsFollow({ followed: false, skippedBecauseAlreadyFollowing: true }), false);
assert.equal(
  messageAllowedForSequence({
    relationship: "following",
    followCreatedBySequence: true,
    profileExists: true,
    message: locked,
  }),
  true,
);
assert.equal(
  messageAllowedForSequence({
    relationship: "following",
    followCreatedBySequence: false,
    profileExists: true,
    message: locked,
  }),
  false,
);

const allowed = dryRunPlan({
  username: "vsiaerial",
  profileExists: true,
  observedUsername: "vsiaerial",
  relationship: "following",
  message: locked,
  followCreatedBySequence: true,
  composerFound: true,
  existingConversation: false,
  composerChecked: true,
});
const allowedText = formatDryRun({
  username: "vsiaerial",
  relationship: "following",
  profileExists: true,
  plan: allowed,
});
assert.equal(allowed.wouldSend, true);
assert.match(allowedText, /Follow belongs to this outreach sequence/);
assert.match(allowedText, /Already completed/);
assert.match(allowedText, /Would open DM: YES/);
assert.match(allowedText, /Composer: found/);
assert.match(allowedText, /Existing conversation: NO/);
assert.match(allowedText, /Would send: YES/);
assert.match(allowedText, /No jobs were completed/);

const blocked = dryRunPlan({
  username: "vsiaerial",
  profileExists: true,
  observedUsername: "vsiaerial",
  relationship: "following",
  message: locked,
  followCreatedBySequence: false,
});
assert.equal(blocked.wouldSend, false);
assert.equal(blocked.wouldOpenDm, false);

const native = selectPrimaryMessageAction([hit()], usernameBox);
assert.equal(native.found, true);
assert.equal(native.strategy, "native-button");
const nested = selectPrimaryMessageAction(
  [hit({ tag: "span", role: "", box: { x: 430, y: 130, width: 40, height: 16 }, ancestor: { tag: "div", role: "button", box: near } })],
  usernameBox,
);
assert.equal(nested.found, true);
assert.equal(nested.strategy, "role-button-ancestor");
assert.equal(selectPrimaryMessageAction([hit({ label: "Messages", text: "Messages", ariaLabel: "Messages", inNavigation: true })], usernameBox).found, false);
assert.equal(selectPrimaryMessageAction([hit({ inSuggestion: true })], usernameBox).found, false);

assert.equal(
  detectComposer([{ tag: "textarea", role: "", ariaLabel: "", placeholder: "Message...", contentEditable: false, value: "", box: null, inConversation: true }]).strategy,
  "textarea-placeholder-message",
);
assert.equal(
  detectComposer([{ tag: "div", role: "textbox", ariaLabel: "", placeholder: "", contentEditable: true, value: "", box: null, inConversation: true }]).strategy,
  "role-textbox-contenteditable",
);
assert.equal(
  detectComposer([{ tag: "div", role: "", ariaLabel: "Message", placeholder: "", contentEditable: true, value: "", box: null, inConversation: true }]).strategy,
  "aria-label-message",
);

async function main() {
let clock = 0;
const delayed = await waitForComposer({
  now: () => clock,
  sleep: async (ms) => {
    clock += ms;
  },
  read: async () =>
    clock < 3000
      ? []
      : [{ tag: "div", role: "textbox", ariaLabel: "", placeholder: "", contentEditable: true, value: "", box: null, inConversation: true }],
  windowMs: 12_000,
  pollMs: 1_000,
});
assert.equal(delayed.found, true);
assert.equal(delayed.strategy, "role-textbox-contenteditable");

const missing = failurePlan({ attemptCount: 0, maxAttempts: 3, retryable: true });
assert.equal(missing.status, "retry_wait");
assert.equal(failurePlan({ attemptCount: 2, maxAttempts: 3, retryable: true }).status, "failed");
assert.equal(shouldMarkContacted({ sent: false }), false);
assert.equal(shouldMarkContacted({ sent: true }), true);

assert.equal(sendConfirmation({ composerText: locked, threadMessages: [], locked }), "uncertain");
assert.equal(sendRecoveryDecision({
  sendAttempted: true,
  exactOutboundPresent: false,
  composerFound: true,
  priorConversation: false,
  conversationMatches: true,
}).action, "review");
assert.equal(sendRecoveryDecision({
  sendAttempted: true,
  exactOutboundPresent: false,
  composerFound: true,
  priorConversation: false,
  conversationMatches: true,
}).send, false);

const now = new Date("2026-10-03T03:00:00.000Z");
const staleSend = {
  id: "send-1",
  status: "running",
  claimedBy: "worker-a",
  claimedAt: "2026-10-03T02:40:00.000Z",
  claimExpiresAt: "2026-10-03T02:45:00.000Z",
};
const reclaimed = atomicReclaim(staleSend, "worker-a", now, 300);
assert.ok(reclaimed);
assert.equal(reclaimed.claimedBy, "worker-a");
assert.equal(sendRecoveryDecision({
  sendAttempted: false,
  exactOutboundPresent: false,
  composerFound: true,
  priorConversation: false,
  conversationMatches: true,
}).action, "send");
assert.equal(threadHasExactOutbound([locked], locked), true);
assert.equal(sendRecoveryDecision({
  sendAttempted: false,
  exactOutboundPresent: true,
  composerFound: true,
  priorConversation: true,
  conversationMatches: true,
}).action, "complete");

assert.equal(queueSendStatusLabel({ job_type: "send_message", status: "retry_wait" }), "Retry scheduled");
assert.equal(
  queueSendStatusLabel({
    job_type: "send_message",
    status: "running",
    claim_expires_at: "2026-10-03T02:00:00.000Z",
    now,
  }),
  "Needs recovery",
);

console.log("dm and send recovery tests passed");
}

main();
