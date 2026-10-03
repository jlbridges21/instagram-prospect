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

export function conversationMatchesProspect(input: {
  url: string;
  header: string;
  username: string;
  displayName?: string | null;
}) {
  const header = input.header.toLowerCase();
  const username = input.username.replace(/^@/, "").toLowerCase();
  if (username && header.includes(username)) return true;
  const display = input.displayName?.trim().toLowerCase() ?? "";
  return display.length > 1 && header.includes(display);
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
  if (input.exactOutboundPresent) return { action: "complete" as const, send: false as const };
  if (input.sendAttempted) return { action: "review" as const, send: false as const };
  if (input.priorConversation) return { action: "existing_conversation" as const, send: false as const };
  if (!input.composerFound) return { action: "retry_composer" as const, send: false as const };
  if (!input.conversationMatches) return { action: "review" as const, send: false as const };
  return { action: "send" as const, send: true as const };
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
  now?: Date;
}) {
  if (job.job_type !== "send_message") return null;
  if (job.status === "retry_wait") return "Retry scheduled";
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
