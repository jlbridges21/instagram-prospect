export const DM_OPEN_WINDOW_MS = 12_000;
export const DM_OPEN_POLL_MS = 1_000;
export const SEND_CONFIRM_WINDOW_MS = 8_000;

export type MessageHit = {
  label: string;
  tag: string;
  role: string;
  text: string;
  ariaLabel: string;
  inSuggestion: boolean;
  inNavigation: boolean;
  inDialog: boolean;
  box: { x: number; y: number; width: number; height: number } | null;
  ancestor: {
    tag: string;
    role: string;
    box: { x: number; y: number; width: number; height: number } | null;
  } | null;
};

export type ComposerCandidate = {
  tag: string;
  role: string;
  ariaLabel: string;
  placeholder: string;
  contentEditable: boolean;
  value: string;
  box: { x: number; y: number; width: number; height: number } | null;
  inConversation: boolean;
};

export function exactMessageLabel(value: string) {
  const text = value.trim().replace(/\s+/g, " ");
  if (/^message\.\.\.$/i.test(text)) return "Message...";
  if (/^message$/i.test(text)) return "Message";
  return "";
}

export function sequenceOwnsFollow(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const record = result as { followed?: boolean; skippedBecauseAlreadyFollowing?: boolean };
  return record.followed === true && record.skippedBecauseAlreadyFollowing !== true;
}

export function messageAllowedForSequence(input: {
  relationship: string;
  followCreatedBySequence: boolean;
  profileExists: boolean;
  message: string | null;
}) {
  if (!input.profileExists || !input.message?.trim()) return false;
  if (input.relationship === "not_following") return true;
  if (!input.followCreatedBySequence) return false;
  return input.relationship === "following" || input.relationship === "requested";
}

export function selectPrimaryMessageAction(
  hits: MessageHit[],
  usernameBox?: { x: number; y: number; width: number; height: number } | null,
) {
  const accepted = hits.filter((hit) => {
    if (!exactMessageLabel(hit.label) && !exactMessageLabel(hit.text) && !exactMessageLabel(hit.ariaLabel)) return false;
    if (hit.inSuggestion || hit.inNavigation || hit.inDialog) return false;
    const clickable =
      hit.tag === "button" ||
      hit.role === "button" ||
      hit.ancestor?.tag === "button" ||
      hit.ancestor?.role === "button";
    if (!clickable) return false;
    const point = hit.ancestor?.box || hit.box;
    if (!usernameBox || !point) return false;
    const dy = point.y - usernameBox.y;
    return dy >= -120 && dy <= 360 && Math.abs(point.x - usernameBox.x) < 1100;
  });
  const winner = accepted[0];
  if (!winner) return { found: false as const, strategy: null, hit: null };
  const strategy = winner.tag === "button" ? "native-button" : "role-button-ancestor";
  return { found: true as const, strategy, hit: winner };
}

export function detectComposer(candidates: ComposerCandidate[]) {
  const scoped = candidates.some((candidate) => candidate.inConversation)
    ? candidates.filter((candidate) => candidate.inConversation)
    : candidates;
  const strategies: Array<{ id: string; match: (candidate: ComposerCandidate) => boolean }> = [
    {
      id: "textarea-placeholder-message",
      match: (candidate) => candidate.tag === "textarea" && /message/i.test(`${candidate.placeholder} ${candidate.ariaLabel}`),
    },
    {
      id: "role-textbox-contenteditable",
      match: (candidate) => candidate.role === "textbox" && candidate.contentEditable,
    },
    {
      id: "aria-label-message",
      match: (candidate) => /message/i.test(candidate.ariaLabel),
    },
    {
      id: "contenteditable-conversation-footer",
      match: (candidate) => candidate.contentEditable && candidate.inConversation,
    },
  ];
  for (const strategy of strategies) {
    const index = scoped.findIndex(strategy.match);
    if (index >= 0) return { found: true as const, strategy: strategy.id, candidate: scoped[index] };
  }
  return { found: false as const, strategy: null, candidate: null };
}

export function composerCandidatesFromSnapshot(dom: {
  composerCandidates?: ComposerCandidate[];
  textboxes?: Array<{ name: string; value: string }>;
}) {
  if (dom.composerCandidates && dom.composerCandidates.length > 0) return dom.composerCandidates;
  return (dom.textboxes ?? []).map((box) => ({
    tag: "textarea",
    role: "textbox",
    ariaLabel: box.name,
    placeholder: box.name,
    contentEditable: false,
    value: box.value,
    box: null,
    inConversation: true,
  }));
}

export type RecipientCandidate = {
  text: string;
  href: string;
  role: string;
  ariaLabel: string;
  title: string;
  alt: string;
  tag?: string;
  clickable?: boolean;
  scope?: "active-header" | "outside";
  box?: { x: number; y: number; width: number; height: number } | null;
};

export type NavigationProvenance = {
  sourceProfileUsername: string;
  sourceProfileVerified: boolean;
  messageActionClicked: boolean;
  directOpenedFromProfile: boolean;
};

export function profileUsernameFromHref(href: string) {
  const path = href.split("?")[0].split("#")[0].replace(/^https?:\/\/(www\.)?instagram\.com/i, "");
  const match = path.match(/^\/([A-Za-z0-9._]{1,30})\/?$/i);
  if (!match) return null;
  const name = match[1].toLowerCase();
  if (["direct", "explore", "accounts", "reels", "stories", "p"].includes(name)) return null;
  return name;
}

function candidateBlob(candidate: RecipientCandidate) {
  return [candidate.text, candidate.ariaLabel, candidate.title, candidate.alt].join(" ").replace(/\s+/g, " ").trim();
}

function sameDisplayName(value: string, displayName: string) {
  const display = displayName.trim().toLowerCase();
  const text = value.trim().toLowerCase();
  if (display.length < 2 || !text) return false;
  return text === display || text === `${display}'s profile picture`;
}

function activeHeader(candidates: RecipientCandidate[]) {
  return candidates.filter((candidate) => !candidate.scope || candidate.scope === "active-header");
}

function isChromeLabel(value: string) {
  return /^(message|send|like|info|details|close|back|search|audio call|video call|chat)$/i.test(value.trim());
}

function isOtherParticipant(value: string, username: string, displayName: string) {
  const text = value.trim();
  if (!text || isChromeLabel(text) || /message/i.test(text)) return false;
  if (text.toLowerCase() === username || text.toLowerCase() === `@${username}`) return false;
  if (displayName && sameDisplayName(text, displayName)) return false;
  const mention = text.match(/^@([a-z0-9._]{1,30})$/i);
  if (mention) return mention[1].toLowerCase() !== username;
  if (/^[a-z0-9._]{1,30}$/i.test(text) && text.toLowerCase() !== username) return true;
  if (/^profile picture$/i.test(text)) return false;
  if (!displayName || displayName.length < 2) return false;
  return text.length >= 2 && text.length <= 60 && /[a-z]/i.test(text);
}

export function confirmConversationRecipient(input: {
  username: string;
  displayName?: string | null;
  candidates: RecipientCandidate[];
  provenance: NavigationProvenance;
}) {
  const username = input.username.replace(/^@/, "").toLowerCase();
  const display = input.displayName?.trim() ?? "";
  const header = activeHeader(input.candidates);
  const evidence = input.candidates.map((candidate) => {
    if (candidate.scope === "outside") {
      return { ...candidate, accepted: false, reason: "outside the active conversation header" };
    }
    const hrefUser = profileUsernameFromHref(candidate.href);
    if (hrefUser && hrefUser !== username) {
      return { ...candidate, accepted: false, reason: "profile href belongs to another account" };
    }
    if ([candidate.text, candidate.ariaLabel, candidate.alt, candidate.title].some((value) => isOtherParticipant(value, username, display))) {
      return { ...candidate, accepted: false, reason: "different participant in the active header" };
    }
    if (hrefUser === username) {
      return { ...candidate, accepted: true, reason: "profile href matches target" };
    }
    const blob = candidateBlob(candidate);
    if (new RegExp(`(^|\\s)@${username}(\\s|$)`, "i").test(blob)) {
      return { ...candidate, accepted: true, reason: "visible @username" };
    }
    if (new RegExp(`(^|\\s)${username}(\\s|$)`, "i").test(blob)) {
      return { ...candidate, accepted: true, reason: "visible username" };
    }
    if (display && (sameDisplayName(candidate.text, display) || sameDisplayName(candidate.ariaLabel, display))) {
      return { ...candidate, accepted: false, reason: "display name in the active header" };
    }
    if (display && (sameDisplayName(candidate.alt, display) || sameDisplayName(candidate.title, display))) {
      return { ...candidate, accepted: false, reason: "avatar matches the profile display name" };
    }
    return { ...candidate, accepted: false, reason: "visible in active conversation header" };
  });
  const provenanceOk =
    input.provenance.sourceProfileVerified &&
    input.provenance.messageActionClicked &&
    input.provenance.directOpenedFromProfile &&
    input.provenance.sourceProfileUsername.replace(/^@/, "").toLowerCase() === username;
  const conflict = evidence.find(
    (item) => item.reason === "profile href belongs to another account" || item.reason === "different participant in the active header",
  );
  if (conflict) {
    return {
      confirmed: false as const,
      strategy: null,
      evidence,
      ambiguousReason: "Conversation recipient could not be confirmed.",
    };
  }
  if (evidence.some((item) => item.reason === "profile href matches target")) {
    return { confirmed: true as const, strategy: "conversation-header-profile-link", evidence, ambiguousReason: null };
  }
  if (evidence.some((item) => item.reason === "visible @username")) {
    return { confirmed: true as const, strategy: "conversation-header-at-username", evidence, ambiguousReason: null };
  }
  if (evidence.some((item) => item.reason === "visible username")) {
    return { confirmed: true as const, strategy: "conversation-header-username", evidence, ambiguousReason: null };
  }
  const displayMatched = evidence.some((item) => item.reason === "display name in the active header");
  const avatarMatched = evidence.some((item) => item.reason === "avatar matches the profile display name");
  if (displayMatched && provenanceOk) {
    return {
      confirmed: true as const,
      strategy: "conversation-header-display-name-plus-provenance",
      evidence,
      ambiguousReason: null,
    };
  }
  if (avatarMatched && provenanceOk) {
    return {
      confirmed: true as const,
      strategy: "conversation-header-avatar-alt",
      evidence,
      ambiguousReason: null,
    };
  }
  return {
    confirmed: false as const,
    strategy: null,
    evidence,
    ambiguousReason: header.length === 0 || provenanceOk
      ? "Composer was found but thread identity was not confirmed."
      : "Conversation recipient could not be confirmed.",
  };
}

export function formatHeaderInspect(input: {
  paneFound: boolean;
  directPath: string | null;
  candidates: RecipientCandidate[];
  displayName: string | null;
  usernameRendered: boolean;
  provenance: NavigationProvenance;
  conflicting: boolean;
  composerFound: boolean;
}) {
  const lines = [
    `Active conversation pane: ${input.paneFound ? "found" : "not found"}`,
    `Direct URL: ${input.directPath || "not a direct thread"}`,
    "",
    "Header candidates:",
  ];
  if (input.candidates.length === 0) lines.push("none");
  input.candidates.forEach((candidate, index) => {
    const box = candidate.box;
    lines.push(`[${index}]`);
    lines.push(`tag: ${candidate.tag || candidate.role || "unknown"}`);
    lines.push(`text: ${candidate.text ? `"${candidate.text}"` : "null"}`);
    lines.push(`aria-label: ${candidate.ariaLabel || "null"}`);
    lines.push(`href: ${candidate.href || "null"}`);
    lines.push(box ? `bounds: x=${box.x}, y=${box.y}, width=${box.width}, height=${box.height}` : "bounds: null");
    lines.push(`reason: ${candidate.scope === "outside" ? "outside the active conversation header" : "visible in active conversation header"}`);
  });
  lines.push("");
  lines.push("Conversation recipient evidence:");
  lines.push(`display name: ${input.displayName || "not found"}`);
  lines.push(`username: ${input.usernameRendered ? "rendered" : "not directly rendered"}`);
  lines.push("");
  lines.push("Navigation provenance:");
  lines.push(`source profile verified: ${input.provenance.sourceProfileVerified ? "yes" : "no"}`);
  lines.push(`source username: ${input.provenance.sourceProfileUsername}`);
  lines.push(`main Message action clicked: ${input.provenance.messageActionClicked ? "yes" : "no"}`);
  lines.push(`Direct opened immediately: ${input.provenance.directOpenedFromProfile ? "yes" : "no"}`);
  lines.push(`composer found: ${input.composerFound ? "yes" : "no"}`);
  lines.push(`conflicting recipient evidence: ${input.conflicting ? "yes" : "none"}`);
  return lines.join("\n");
}

export function sendAllowed(input: {
  recipientConfirmed: boolean;
  existingConversation: boolean;
  composerFound: boolean;
  lockedMessageMatches: boolean;
  followOwnedBySequence: boolean;
}) {
  return (
    input.recipientConfirmed &&
    !input.existingConversation &&
    input.composerFound &&
    input.lockedMessageMatches &&
    input.followOwnedBySequence
  );
}

export function threadHasExactOutbound(messages: string[], locked: string) {
  const expected = locked.trim();
  if (!expected) return false;
  return messages.some((message) => message.trim() === expected);
}

export function sendRecoveryDecision(input: {
  sendAttempted: boolean;
  exactOutboundPresent: boolean;
  composerFound: boolean;
  priorConversation: boolean;
  conversationMatches: boolean;
}) {
  if (input.exactOutboundPresent) return { action: "complete" as const, send: false as const, reason: null };
  if (input.sendAttempted) {
    return { action: "review" as const, send: false as const, reason: "Send state from a previous attempt is uncertain." };
  }
  if (input.priorConversation) return { action: "existing_conversation" as const, send: false as const, reason: null };
  if (!input.composerFound) return { action: "retry_composer" as const, send: false as const, reason: null };
  if (!input.conversationMatches) {
    return {
      action: "review" as const,
      send: false as const,
      reason: "Composer was found but thread identity was not confirmed.",
    };
  }
  return { action: "send" as const, send: true as const, reason: null };
}

export function sendConfirmation(input: { composerText: string; threadMessages: string[]; locked: string }) {
  const locked = input.locked.trim();
  if (threadHasExactOutbound(input.threadMessages, locked)) return "confirmed" as const;
  if (input.composerText.trim() === "") return "confirmed" as const;
  return "uncertain" as const;
}

export function shouldMarkContacted(result: { sent?: boolean }) {
  return result.sent === true;
}

export async function waitForComposer(input: {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  read: () => Promise<ComposerCandidate[]>;
  windowMs?: number;
  pollMs?: number;
}) {
  const windowMs = input.windowMs ?? DM_OPEN_WINDOW_MS;
  const pollMs = input.pollMs ?? DM_OPEN_POLL_MS;
  const started = input.now();
  let found = detectComposer(await input.read());
  while (!found.found && input.now() - started < windowMs) {
    await input.sleep(pollMs);
    found = detectComposer(await input.read());
  }
  return found;
}

export function queueSendStatusLabel(job: {
  job_type: string;
  status: string;
  claim_expires_at?: string | null;
  last_error?: string | null;
  now?: Date;
}) {
  if (job.job_type !== "send_message") return null;
  if (job.status === "retry_wait") {
    if (job.last_error && /recipient|thread identity|previous attempt is uncertain/i.test(job.last_error)) return job.last_error;
    return "Retry scheduled";
  }
  if (job.status === "failed") return "Failed";
  if (job.status === "running" || job.status === "claimed") {
    const now = job.now ?? new Date();
    const expires = job.claim_expires_at ? new Date(job.claim_expires_at).getTime() : 0;
    if (!job.claim_expires_at || expires <= now.getTime()) return "Needs recovery";
  }
  return null;
}

export function sendWasAttempted(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false;
  const record = result as { sendAttempted?: boolean; confirmation?: string };
  return record.sendAttempted === true || record.confirmation === "uncertain";
}
