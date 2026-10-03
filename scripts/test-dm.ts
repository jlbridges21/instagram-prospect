import assert from "node:assert/strict";
import { failurePlan } from "../lib/outreach/decisions";
import {
  classifyHeaderCandidate,
  clearKeysIncludeEnter,
  compareComposerText,
  composerReadyToSend,
  composerTextMatches,
  confirmConversationRecipient,
  detectComposer,
  directSurfaceLine,
  formatHeaderInspect,
  messageAllowedForSequence,
  sendAllowed,
  queueSendStatusLabel,
  selectPrimaryMessageAction,
  draftClearKeys,
  inspectMaySend,
  readComposerSemanticText,
  sendConfirmation,
  sameActiveComposer,
  selectActiveMessageComposer,
  sendRecoveryDecision,
  shouldClickSend,
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

const blank = { ariaLabel: "", title: "", alt: "" };
const noProof = {
  sourceProfileUsername: "vsiaerial",
  sourceProfileVerified: false,
  messageActionClicked: false,
  directOpenedFromProfile: false,
};
const proof = {
  sourceProfileUsername: "vsiaerial",
  sourceProfileVerified: true,
  messageActionClicked: true,
  directOpenedFromProfile: true,
};
const href = confirmConversationRecipient({
  username: "vsiaerial",
  displayName: "VSI Aerial",
  candidates: [{ text: "VSI Aerial", href: "/vsiaerial/", role: "link", ...blank }],
  provenance: noProof,
});
assert.equal(href.confirmed, true);
assert.equal(href.strategy, "conversation-header-profile-link");
assert.equal(href.evidence[0]?.reason, "profile href matches target");
const atName = confirmConversationRecipient({
  username: "vsiaerial",
  candidates: [{ text: "@vsiaerial", href: "", role: "link", ...blank }],
  provenance: noProof,
});
assert.equal(atName.confirmed, true);
assert.equal(atName.strategy, "conversation-header-at-username");
const plainName = confirmConversationRecipient({
  username: "vsiaerial",
  candidates: [{ text: "vsiaerial", href: "", role: "link", ...blank }],
  provenance: noProof,
});
assert.equal(plainName.confirmed, true);
assert.equal(plainName.strategy, "conversation-header-username");
const displayOnly = confirmConversationRecipient({
  username: "vsiaerial",
  displayName: "VSI Aerial",
  candidates: [{ text: "VSI Aerial", href: "", role: "link", ...blank }],
  provenance: noProof,
});
assert.equal(displayOnly.confirmed, false);
const displayWithProof = confirmConversationRecipient({
  username: "vsiaerial",
  displayName: "VSI Aerial",
  candidates: [{ text: "VSI Aerial", href: "", role: "link", ...blank }],
  provenance: proof,
});
assert.equal(displayWithProof.confirmed, true);
assert.equal(displayWithProof.strategy, "conversation-header-display-name-plus-provenance");
const other = confirmConversationRecipient({
  username: "vsiaerial",
  displayName: "VSI Aerial",
  candidates: [{ text: "Someone", href: "/someone/", role: "link", ...blank }],
  provenance: proof,
});
assert.equal(other.confirmed, false);
const headerBox = { x: 480, y: 20, width: 120, height: 24 };
const spanName = confirmConversationRecipient({
  username: "vsiaerial",
  displayName: "VSI Aerial",
  candidates: [{ text: "VSI Aerial", href: "", role: "span", tag: "span", ariaLabel: "", title: "", alt: "", scope: "active-header", box: headerBox, clickable: false }],
  provenance: proof,
});
assert.equal(spanName.confirmed, true);
assert.equal(spanName.strategy, "conversation-header-display-name-plus-provenance");
const buttonName = confirmConversationRecipient({
  username: "vsiaerial",
  displayName: "VSI Aerial",
  candidates: [{ text: "VSI Aerial", href: "", role: "button", tag: "button", ariaLabel: "", title: "", alt: "", scope: "active-header", clickable: true, box: headerBox }],
  provenance: proof,
});
assert.equal(buttonName.confirmed, true);
const avatar = confirmConversationRecipient({
  username: "vsiaerial",
  displayName: "VSI Aerial",
  candidates: [{ text: "", href: "", role: "img", tag: "img", ariaLabel: "", title: "", alt: "VSI Aerial's profile picture", scope: "active-header", box: headerBox }],
  provenance: proof,
});
assert.equal(avatar.confirmed, true);
assert.equal(avatar.strategy, "conversation-header-avatar-alt");
const inboxOnly = confirmConversationRecipient({
  username: "vsiaerial",
  displayName: "VSI Aerial",
  candidates: [{ text: "VSI Aerial", href: "", role: "span", tag: "span", ariaLabel: "", title: "", alt: "", scope: "outside", box: { x: 20, y: 200, width: 80, height: 20 } }],
  provenance: proof,
});
assert.equal(inboxOnly.confirmed, false);
const wrongName = confirmConversationRecipient({
  username: "vsiaerial",
  displayName: "VSI Aerial",
  candidates: [{ text: "Other Shop", href: "", role: "button", tag: "button", ariaLabel: "", title: "", alt: "", scope: "active-header", box: headerBox }],
  provenance: proof,
});
assert.equal(wrongName.confirmed, false);
const noIdentity = confirmConversationRecipient({
  username: "vsiaerial",
  displayName: "VSI Aerial",
  candidates: [],
  provenance: proof,
});
assert.equal(noIdentity.confirmed, false);
assert.equal(noIdentity.strategy, null);
const chrome = (text: string) => ({ text, href: "", role: "button", tag: "button", ariaLabel: "", title: "", alt: "", scope: "active-header" as const });
const liveThread = confirmConversationRecipient({
  username: "vsiaerial",
  displayName: "VSI Aerial",
  candidates: [
    chrome("Go back"),
    { text: "VSI Aerial", href: "/vsiaerial/", role: "link", tag: "a", ariaLabel: "Open the profile page of vsiaerial", title: "", alt: "", scope: "active-header" },
    chrome("Expand"),
    chrome("Close"),
    { text: "vsiaerial · Instagram", href: "", role: "span", tag: "span", ariaLabel: "", title: "", alt: "", scope: "active-header" },
  ],
  provenance: proof,
});
assert.equal(liveThread.confirmed, true);
assert.equal(liveThread.strategy, "conversation-header-profile-link");
assert.equal(liveThread.evidence.some((item) => item.classification === "identity_conflict"), false);
assert.equal(liveThread.evidence[0]?.classification, "ui_control");
assert.equal(liveThread.evidence[1]?.classification, "identity_match");
assert.equal(liveThread.evidence[4]?.classification, "identity_match");
const unrelatedControls = confirmConversationRecipient({
  username: "vsiaerial",
  displayName: "VSI Aerial",
  candidates: [
    { text: "VSI Aerial", href: "/vsiaerial/", role: "link", ...blank },
    chrome("Info"),
    chrome("Mute"),
    chrome("Video call"),
  ],
  provenance: noProof,
});
assert.equal(unrelatedControls.confirmed, true);
assert.equal(unrelatedControls.evidence.some((item) => item.classification === "identity_conflict"), false);
const mixedAccounts = confirmConversationRecipient({
  username: "vsiaerial",
  displayName: "VSI Aerial",
  candidates: [
    { text: "VSI Aerial", href: "/vsiaerial/", role: "link", ...blank },
    { text: "Other", href: "/differentuser/", role: "link", ...blank },
  ],
  provenance: proof,
});
assert.equal(mixedAccounts.confirmed, false);
assert.equal(mixedAccounts.evidence.some((item) => item.classification === "identity_conflict"), true);
const ariaOnly = confirmConversationRecipient({
  username: "vsiaerial",
  displayName: "VSI Aerial",
  candidates: [{ text: "VSI Aerial", href: "", role: "button", ariaLabel: "Open the profile page of vsiaerial", title: "", alt: "" }],
  provenance: noProof,
});
assert.equal(ariaOnly.confirmed, true);
assert.equal(ariaOnly.strategy, "conversation-header-aria-username");
assert.equal(classifyHeaderCandidate({ text: "Go back", href: "", role: "button", ariaLabel: "", title: "", alt: "" }, "vsiaerial", "VSI Aerial").classification, "ui_control");
assert.equal(classifyHeaderCandidate({ text: "Expand", href: "", role: "button", ariaLabel: "", title: "", alt: "" }, "vsiaerial", "VSI Aerial").classification, "ui_control");
assert.equal(classifyHeaderCandidate({ text: "Close", href: "", role: "button", ariaLabel: "", title: "", alt: "" }, "vsiaerial", "VSI Aerial").classification, "ui_control");
assert.equal(directSurfaceLine({ directPath: "", paneFound: true, composerFound: true, messageActionClicked: true }), "Direct surface: conversation overlay");
assert.equal(directSurfaceLine({ directPath: "/direct/t/123/", paneFound: true, composerFound: true, messageActionClicked: true }), "Direct URL: /direct/t/123/");
const overlayPrint = formatHeaderInspect({
  paneFound: true,
  directPath: "",
  candidates: [{ text: "Go back", href: "", role: "button", ariaLabel: "", title: "", alt: "" }],
  displayName: "VSI Aerial",
  usernameRendered: true,
  provenance: proof,
  composerFound: true,
});
assert.match(overlayPrint, /Direct surface: conversation overlay/);
assert.match(overlayPrint, /classification: ui_control/);
const unconfirmed = sendRecoveryDecision({
  sendAttempted: false,
  exactOutboundPresent: false,
  composerFound: true,
  priorConversation: false,
  conversationMatches: false,
});
assert.equal(unconfirmed.action, "review");
assert.equal(unconfirmed.send, false);
assert.equal(unconfirmed.reason, "Composer was found but thread identity was not confirmed.");
assert.equal(
  sendAllowed({
    recipientConfirmed: true,
    existingConversation: false,
    composerFound: true,
    lockedMessageMatches: true,
    followOwnedBySequence: true,
  }),
  true,
);
assert.equal(shouldMarkContacted({ sent: false }), false);

const queued = "Hello\n\nWorld";
assert.equal(composerTextMatches(queued, "Hello\r\n\r\nWorld"), true);
assert.equal(composerTextMatches("Hello world", "Hello\u00A0world"), true);
assert.equal(composerTextMatches("Hello", "Hello\n"), true);
assert.equal(composerTextMatches("Hello", "Hello\u200B"), true);
assert.equal(composerTextMatches("it\u2019s", "it's"), false);
assert.equal(composerTextMatches("Hello world", "Hello there"), false);
assert.equal(composerTextMatches("Hello", "hello"), false);
assert.equal(composerTextMatches("Hello\n\nWorld", "Hello\nWorld"), false);
assert.equal(composerTextMatches("Hello world", "Hello  world"), false);
const paragraphs = readComposerSemanticText({
  type: "element",
  tag: "div",
  children: [
    { type: "element", tag: "p", children: [{ type: "text", text: "Hello" }] },
    { type: "element", tag: "p", children: [{ type: "text", text: "World" }] },
  ],
});
assert.equal(composerTextMatches("Hello\nWorld", paragraphs), true);
const trailingBreak = readComposerSemanticText({
  type: "element",
  tag: "div",
  children: [{ type: "element", tag: "p", children: [{ type: "text", text: "Hello" }, { type: "element", tag: "br" }] }],
});
assert.equal(composerTextMatches("Hello", trailingBreak), true);
const spaced = readComposerSemanticText({
  type: "element",
  tag: "div",
  children: [{ type: "element", tag: "p", children: [{ type: "text", text: "Hello  world" }] }],
});
assert.equal(spaced, "Hello  world");
assert.equal(composerTextMatches("Hello world", spaced), false);
const mismatch = compareComposerText("it\u2019s", "it's");
assert.equal(mismatch.semanticMatch, false);
assert.equal(mismatch.mismatch?.queued, `U+2019 ${JSON.stringify("\u2019")}`);
const activeBox = { x: 400, y: 700, width: 320, height: 40 };
const activeComposer = {
  tag: "div",
  role: "textbox",
  contentEditable: true,
  ariaLabel: "Message",
  placeholder: "",
  box: activeBox,
  visible: true,
  hidden: false,
  insideActiveConversation: true,
  searchField: false,
  enabled: true,
};
const outsidePane = {
  ...activeComposer,
  ariaLabel: "Inbox",
  box: { x: 20, y: 200, width: 220, height: 32 },
  insideActiveConversation: false,
};
const chosen = selectActiveMessageComposer([outsidePane, activeComposer]);
assert.equal(chosen.status, "selected");
assert.equal(chosen.selected?.ariaLabel, "Message");
assert.equal(chosen.candidates[0]?.reason, "outside active pane");
const searchChoice = selectActiveMessageComposer([
  { ...activeComposer, ariaLabel: "Search", searchField: true, box: { x: 20, y: 80, width: 220, height: 32 } },
  activeComposer,
]);
assert.equal(searchChoice.status, "selected");
assert.equal(searchChoice.candidates[0]?.reason, "search field");
const hiddenChoice = selectActiveMessageComposer([
  { ...activeComposer, hidden: true, visible: false },
  activeComposer,
]);
assert.equal(hiddenChoice.status, "selected");
assert.equal(hiddenChoice.candidates[0]?.reason, "hidden");
const ambiguous = selectActiveMessageComposer([
  activeComposer,
  { ...activeComposer, box: { x: 400, y: 640, width: 320, height: 36 } },
]);
assert.equal(ambiguous.status, "ambiguous");
assert.equal(ambiguous.selected, null);
const rerendered = selectActiveMessageComposer([{ ...activeComposer, box: { x: 404, y: 706, width: 320, height: 40 } }]);
assert.equal(rerendered.status, "selected");
assert.equal(sameActiveComposer(chosen.selected!, rerendered.selected!), true);
const stale = { ...activeComposer, ariaLabel: "Search", box: { x: 20, y: 80, width: 200, height: 32 } };
assert.equal(sameActiveComposer(chosen.selected!, stale), false);
const paragraphMessage = "Hi vsiaerial\n\nI'd love to connect";
assert.equal(composerTextMatches(paragraphMessage, paragraphMessage), true);
assert.equal(paragraphMessage.split("\n")[1], "");
assert.equal(shouldClickSend(false), false);
assert.equal(
  composerReadyToSend({
    recipientConfirmed: true,
    existingConversation: false,
    composerSelected: true,
    focusConfirmed: true,
    initiallyEmpty: true,
    semanticMatch: composerTextMatches(paragraphMessage, ""),
  }),
  false,
);
assert.equal(
  composerReadyToSend({
    recipientConfirmed: true,
    existingConversation: false,
    composerSelected: true,
    focusConfirmed: true,
    initiallyEmpty: true,
    semanticMatch: composerTextMatches(paragraphMessage, "Hello there"),
  }),
  false,
);
assert.equal(
  composerReadyToSend({
    recipientConfirmed: true,
    existingConversation: false,
    composerSelected: true,
    focusConfirmed: true,
    initiallyEmpty: true,
    semanticMatch: composerTextMatches(paragraphMessage, paragraphMessage),
  }),
  true,
);
assert.equal(inspectMaySend(), false);
assert.equal(clearKeysIncludeEnter(draftClearKeys("darwin")), false);
assert.equal(clearKeysIncludeEnter(draftClearKeys("win32")), false);
assert.equal(draftClearKeys("win32").includes("Backspace"), true);
assert.equal(shouldClickSend(composerTextMatches(queued, "Hello\r\n\r\nWorld")), true);
assert.equal(
  sendAllowed({
    recipientConfirmed: true,
    existingConversation: false,
    composerFound: true,
    lockedMessageMatches: composerTextMatches(queued, "Hello\r\n\r\nWorld"),
    followOwnedBySequence: true,
  }),
  true,
);
assert.equal(
  sendAllowed({
    recipientConfirmed: true,
    existingConversation: false,
    composerFound: true,
    lockedMessageMatches: composerTextMatches("Hello", "hello"),
    followOwnedBySequence: true,
  }),
  false,
);
assert.equal(
  queueSendStatusLabel({ job_type: "send_message", status: "retry_wait", last_error: "composer_text_mismatch" }),
  "composer_text_mismatch",
);
assert.equal(queueSendStatusLabel({ job_type: "send_message", status: "retry_wait" }), "Retry scheduled");
assert.equal(
  queueSendStatusLabel({
    job_type: "send_message",
    status: "retry_wait",
    last_error: "Composer was found but thread identity was not confirmed.",
  }),
  "Composer was found but thread identity was not confirmed.",
);
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
