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

export type ActiveComposerCandidate = {
  tag: string;
  role: string;
  contentEditable: boolean;
  ariaLabel: string;
  placeholder: string;
  box: { x: number; y: number; width: number; height: number } | null;
  visible: boolean;
  hidden: boolean;
  insideActiveConversation: boolean;
  searchField: boolean;
  enabled: boolean;
};

export type ClassifiedComposerCandidate = ActiveComposerCandidate & {
  selected: boolean;
  reason: string;
};

function composerRejection(candidate: ActiveComposerCandidate) {
  const editable = candidate.contentEditable || candidate.tag === "textarea" || candidate.role === "textbox";
  if (!editable) return "not a composer";
  if (candidate.hidden || !candidate.visible) return "hidden";
  if (!candidate.box || candidate.box.width < 1 || candidate.box.height < 1) return "zero bounding box";
  if (!candidate.enabled) return "disabled";
  if (candidate.searchField) return "search field";
  if (!candidate.insideActiveConversation) return "outside active pane";
  return null;
}

export function selectActiveMessageComposer(candidates: ActiveComposerCandidate[]) {
  const annotated: ClassifiedComposerCandidate[] = candidates.map((candidate) => ({
    ...candidate,
    selected: false,
    reason: composerRejection(candidate) ?? "",
  }));
  const eligible = annotated.filter((candidate) => candidate.reason === "");
  if (eligible.length === 1) {
    eligible[0].selected = true;
    eligible[0].reason = "visible in active conversation";
    return { status: "selected" as const, selected: eligible[0], candidates: annotated };
  }
  if (eligible.length > 1) {
    eligible.forEach((candidate) => {
      candidate.reason = "more than one active composer";
    });
    return { status: "ambiguous" as const, selected: null, candidates: annotated };
  }
  return { status: "missing" as const, selected: null, candidates: annotated };
}

export function sameActiveComposer(
  before: { ariaLabel: string; role: string; box: { x: number; y: number; width: number; height: number } | null },
  after: { ariaLabel: string; role: string; box: { x: number; y: number; width: number; height: number } | null },
) {
  if (!before.box || !after.box) return false;
  return (
    before.role === after.role &&
    before.ariaLabel === after.ariaLabel &&
    Math.abs(before.box.x - after.box.x) <= 48 &&
    Math.abs(before.box.y - after.box.y) <= 80
  );
}

export const EXISTING_DRAFT_MISMATCH = "Existing composer draft does not match the queued message. Manual review required.";

export type ComposerDraft = "empty" | "queued-message" | "other-draft";

export function composerDraftDecision(queued: string, composer: string): ComposerDraft {
  if (normalizeComposerForComparison(composer) === "") return "empty";
  if (composerTextMatches(queued, composer)) return "queued-message";
  return "other-draft";
}

export function shouldInsertComposerText(draft: ComposerDraft) {
  return draft === "empty";
}

export function formatInitialComposer(draft: ComposerDraft) {
  if (draft === "queued-message") return "Initial composer:\nqueued message already present: YES";
  if (draft === "empty") return "Initial composer:\nempty";
  return "Initial composer:\nnon-matching draft present";
}

export function sendClickBudget(input: { gateOpen: boolean; sendAttempted: boolean; confirmationUncertain: boolean }) {
  if (!input.gateOpen || input.sendAttempted || input.confirmationUncertain) return 0;
  return 1;
}

export type SendGateInput = {
  recipientConfirmed: boolean;
  followOwnedBySequence: boolean;
  existingConversation: boolean;
  composerFound: boolean;
  composerSemanticMatch: boolean;
  sendAttempted: boolean;
};

export function sendGateDecision(input: SendGateInput) {
  const checks: Array<[string, boolean]> = [
    ["recipientConfirmed", input.recipientConfirmed],
    ["followOwnedBySequence", input.followOwnedBySequence],
    ["existingConversation", !input.existingConversation],
    ["composerFound", input.composerFound],
    ["composerSemanticMatch", input.composerSemanticMatch],
    ["sendAttempted", !input.sendAttempted],
  ];
  const blockingGate = checks.find(([, passed]) => !passed)?.[0] ?? null;
  return { allowed: blockingGate === null, blockingGate };
}

export function formatSendGate(input: SendGateInput) {
  const decision = sendGateDecision(input);
  const lines = [
    "Pre-send gate:",
    "",
    `recipientConfirmed: ${input.recipientConfirmed ? "yes" : "no"}`,
    `followOwnedBySequence: ${input.followOwnedBySequence ? "yes" : "no"}`,
    `existingConversation: ${input.existingConversation ? "yes" : "no"}`,
    `composerFound: ${input.composerFound ? "yes" : "no"}`,
    `composerSemanticMatch: ${input.composerSemanticMatch ? "yes" : "no"}`,
    `sendAttempted: ${input.sendAttempted ? "yes" : "no"}`,
    "",
    `Send allowed: ${decision.allowed ? "YES" : "NO"}`,
  ];
  if (decision.blockingGate) lines.push(`Blocking gate: ${decision.blockingGate}`);
  return lines.join("\n");
}

export function composerReadyToSend(input: {
  recipientConfirmed: boolean;
  followOwnedBySequence: boolean;
  existingConversation: boolean;
  composerFound: boolean;
  semanticMatch: boolean;
  sendAttempted: boolean;
}) {
  return sendGateDecision({
    recipientConfirmed: input.recipientConfirmed,
    followOwnedBySequence: input.followOwnedBySequence,
    existingConversation: input.existingConversation,
    composerFound: input.composerFound,
    composerSemanticMatch: input.semanticMatch,
    sendAttempted: input.sendAttempted,
  }).allowed;
}

export function inspectMaySend() {
  return false;
}

export function draftClearKeys(platform: string) {
  return [platform === "darwin" ? "Meta+a" : "Control+a", "Backspace"];
}

export function clearKeysIncludeEnter(keys: readonly string[]) {
  return keys.some((key) => /^enter$/i.test(key));
}

export function formatComposerCandidates(choice: ReturnType<typeof selectActiveMessageComposer>) {
  const lines = ["Composer candidates:"];
  if (choice.candidates.length === 0) lines.push("none");
  choice.candidates.forEach((candidate, index) => {
    const box = candidate.box;
    lines.push(`[${index}]`);
    lines.push(`tag: ${candidate.tag}`);
    lines.push(`role: ${candidate.role || "null"}`);
    lines.push(`contenteditable: ${candidate.contentEditable ? "yes" : "no"}`);
    lines.push(`aria-label: ${candidate.ariaLabel || "null"}`);
    lines.push(box ? `bounds: x=${box.x}, y=${box.y}, width=${box.width}, height=${box.height}` : "bounds: null");
    lines.push(`visible: ${candidate.visible ? "yes" : "no"}`);
    lines.push(`insideActiveConversation: ${candidate.insideActiveConversation ? "yes" : "no"}`);
    lines.push(`selected: ${candidate.selected ? "yes" : "no"}`);
    if (!candidate.selected && candidate.reason) lines.push(`reason: ${candidate.reason}`);
  });
  return lines.join("\n");
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

function sameDisplayName(value: string, displayName: string) {
  const display = displayName.trim().toLowerCase();
  const text = value.trim().toLowerCase();
  if (display.length < 2 || !text) return false;
  return text === display || text === `${display}'s profile picture`;
}

function activeHeader(candidates: RecipientCandidate[]) {
  return candidates.filter((candidate) => !candidate.scope || candidate.scope === "active-header");
}

export type HeaderClassification =
  | "identity_match"
  | "identity_conflict"
  | "supporting_identity"
  | "ui_control"
  | "irrelevant";

const UI_CONTROL =
  /^(go back|back|expand|close|info|details|video call|audio call|call|mute|unmute|search|chat|send|like|message|options|more|menu|emoji|gallery|inbox|messages|new message|minimize|maximize|thread details|view profile|instagram)$/i;

function uiControlLabel(value: string) {
  return UI_CONTROL.test(value.trim());
}

function profileAriaUsername(value: string) {
  const match = value.trim().match(/open the profile page of\s+@?([a-z0-9._]{1,30})\b/i);
  return match ? match[1].toLowerCase() : null;
}

function identityText(value: string) {
  const text = value.trim();
  const mention = text.match(/^@([a-z0-9._]{1,30})$/i);
  if (mention) return { username: mention[1].toLowerCase(), kind: "at" as const };
  const titled = text.match(/^([a-z0-9._]{1,30})\s*[·•|]\s*instagram$/i);
  if (titled) return { username: titled[1].toLowerCase(), kind: "username" as const };
  if (uiControlLabel(text)) return null;
  const bare = text.match(/^([a-z0-9._]{1,30})$/i);
  if (!bare) return null;
  const name = bare[1].toLowerCase();
  if (["instagram", "direct", "explore", "accounts", "reels", "stories"].includes(name)) return null;
  return { username: name, kind: "username" as const };
}

function namedProfilePicture(value: string) {
  const match = value.trim().match(/^(.+)'s profile picture$/i);
  return match?.[1].trim() || null;
}

export function classifyHeaderCandidate(
  candidate: RecipientCandidate,
  username: string,
  displayName: string,
): { classification: HeaderClassification; reason: string; match: "href" | "aria" | "at" | "username" | "display" | "avatar" | null } {
  const target = username.replace(/^@/, "").toLowerCase();
  const display = displayName.trim();
  if (candidate.scope === "outside") {
    return { classification: "irrelevant", reason: "outside the active conversation header", match: null };
  }
  const hrefUser = profileUsernameFromHref(candidate.href);
  const ariaUser = profileAriaUsername(candidate.ariaLabel) || profileAriaUsername(candidate.title);
  const textIdentity = identityText(candidate.text);
  const labelIdentity = identityText(candidate.ariaLabel);
  const identities = [hrefUser, ariaUser, textIdentity?.username ?? null, labelIdentity?.username ?? null].filter(
    (value): value is string => Boolean(value),
  );
  if (identities.some((value) => value !== target)) {
    return {
      classification: "identity_conflict",
      reason: hrefUser && hrefUser !== target ? "profile href belongs to another account" : "different participant in the active header",
      match: null,
    };
  }
  if (display) {
    const pictures = [candidate.alt, candidate.title, candidate.ariaLabel]
      .map(namedProfilePicture)
      .filter((name): name is string => Boolean(name));
    if (pictures.some((name) => !sameDisplayName(name, display))) {
      return { classification: "identity_conflict", reason: "different participant in the active header", match: null };
    }
  }
  if (hrefUser === target) return { classification: "identity_match", reason: "profile href matches target", match: "href" };
  if (ariaUser === target) return { classification: "identity_match", reason: "profile aria-label matches target", match: "aria" };
  if (textIdentity?.username === target || labelIdentity?.username === target) {
    const at = textIdentity?.kind === "at" || labelIdentity?.kind === "at";
    return {
      classification: "identity_match",
      reason: at ? "visible @username" : "visible username",
      match: at ? "at" : "username",
    };
  }
  const fields = [candidate.text, candidate.ariaLabel, candidate.title].map((value) => value.trim()).filter(Boolean);
  if (fields.length > 0 && fields.every(uiControlLabel)) {
    return { classification: "ui_control", reason: "generic header control", match: null };
  }
  if (display && (sameDisplayName(candidate.text, display) || sameDisplayName(candidate.ariaLabel, display))) {
    return { classification: "supporting_identity", reason: "display name in the active header", match: "display" };
  }
  if (display && (sameDisplayName(candidate.alt, display) || sameDisplayName(candidate.title, display) || [candidate.alt, candidate.title].some((value) => sameDisplayName(namedProfilePicture(value) ?? "", display)))) {
    return { classification: "supporting_identity", reason: "avatar matches the profile display name", match: "avatar" };
  }
  return { classification: "irrelevant", reason: "visible in active conversation header", match: null };
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
    const classified = classifyHeaderCandidate(candidate, username, display);
    return {
      ...candidate,
      accepted: classified.classification === "identity_match",
      reason: classified.reason,
      classification: classified.classification,
      match: classified.match,
    };
  });
  const provenanceOk =
    input.provenance.sourceProfileVerified &&
    input.provenance.messageActionClicked &&
    input.provenance.directOpenedFromProfile &&
    input.provenance.sourceProfileUsername.replace(/^@/, "").toLowerCase() === username;
  const conflict = evidence.find((item) => item.classification === "identity_conflict");
  if (conflict) {
    return {
      confirmed: false as const,
      strategy: null,
      evidence,
      ambiguousReason: "Conversation recipient could not be confirmed.",
    };
  }
  if (evidence.some((item) => item.match === "href")) {
    return { confirmed: true as const, strategy: "conversation-header-profile-link", evidence, ambiguousReason: null };
  }
  if (evidence.some((item) => item.match === "aria")) {
    return { confirmed: true as const, strategy: "conversation-header-aria-username", evidence, ambiguousReason: null };
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

export function directSurfaceLine(input: {
  directPath: string | null;
  paneFound: boolean;
  composerFound: boolean;
  messageActionClicked: boolean;
}) {
  if (input.directPath && /\/direct\//.test(input.directPath)) return `Direct URL: ${input.directPath}`;
  if (input.messageActionClicked && input.paneFound && input.composerFound) return "Direct surface: conversation overlay";
  return "Direct URL: not a direct thread";
}

export function formatHeaderInspect(input: {
  paneFound: boolean;
  directPath: string | null;
  candidates: RecipientCandidate[];
  displayName: string | null;
  usernameRendered: boolean;
  provenance: NavigationProvenance;
  composerFound: boolean;
}) {
  const username = input.provenance.sourceProfileUsername;
  const display = input.displayName ?? "";
  const conflicting = input.candidates.some(
    (candidate) => classifyHeaderCandidate(candidate, username, display).classification === "identity_conflict",
  );
  const lines = [
    `Active conversation pane: ${input.paneFound ? "found" : "not found"}`,
    directSurfaceLine({
      directPath: input.directPath,
      paneFound: input.paneFound,
      composerFound: input.composerFound,
      messageActionClicked: input.provenance.messageActionClicked,
    }),
    "",
    "Header candidates:",
  ];
  if (input.candidates.length === 0) lines.push("none");
  input.candidates.forEach((candidate, index) => {
    const box = candidate.box;
    const classified = classifyHeaderCandidate(candidate, username, display);
    lines.push(`[${index}]`);
    lines.push(`tag: ${candidate.tag || candidate.role || "unknown"}`);
    lines.push(`text: ${candidate.text ? `"${candidate.text}"` : "null"}`);
    lines.push(`aria-label: ${candidate.ariaLabel || "null"}`);
    lines.push(`href: ${candidate.href || "null"}`);
    lines.push(box ? `bounds: x=${box.x}, y=${box.y}, width=${box.width}, height=${box.height}` : "bounds: null");
    lines.push(`classification: ${classified.classification}`);
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
  lines.push(`conflicting recipient evidence: ${conflicting ? "yes" : "no"}`);
  return lines.join("\n");
}

const BLOCK_TAGS = new Set(["p", "div", "li", "blockquote", "h1", "h2", "h3"]);

export type SemanticNode = {
  type: "element" | "text";
  tag?: string;
  text?: string;
  children?: SemanticNode[];
};

export function readComposerSemanticText(node: SemanticNode | null) {
  if (!node) return "";
  if (node.type === "text") return node.text ?? "";
  if ((node.tag || "").toLowerCase() === "textarea") return node.text ?? "";
  const out: string[] = [];
  for (const child of node.children ?? []) appendSemanticNode(child, out);
  return out.join("");
}

function appendSemanticNode(node: SemanticNode, out: string[]) {
  if (node.type === "text") {
    out.push(node.text ?? "");
    return;
  }
  const tag = (node.tag || "").toLowerCase();
  if (tag === "br") {
    out.push("\n");
    return;
  }
  if (tag === "textarea") {
    out.push(node.text ?? "");
    return;
  }
  if (BLOCK_TAGS.has(tag)) {
    const current = out.join("");
    if (current.length > 0 && !current.endsWith("\n")) out.push("\n");
  }
  for (const child of node.children ?? []) appendSemanticNode(child, out);
}

export function normalizeComposerForComparison(text: string) {
  const unified = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, "");
  return unified.replace(/^\n+|\n+$/g, "").replace(/^[ \t\f\v]+|[ \t\f\v]+$/g, "");
}

export function verifyComposerMessage(composerText: string, queuedMessage: string) {
  const queuedNormalized = normalizeComposerForComparison(queuedMessage);
  const composerNormalized = normalizeComposerForComparison(composerText);
  return {
    rawMatch: queuedMessage === composerText,
    semanticMatch: queuedNormalized === composerNormalized,
    queuedRaw: queuedMessage,
    composerRaw: composerText,
    queuedNormalized,
    composerNormalized,
  };
}

export function composerTextMatches(queued: string, composer: string) {
  return verifyComposerMessage(composer, queued).semanticMatch;
}

export function shouldClickSend(semanticMatch: boolean) {
  return semanticMatch;
}

function formatCodePoint(char: string | undefined) {
  if (char === undefined) return "end of text";
  const code = char.codePointAt(0) ?? 0;
  return `U+${code.toString(16).toUpperCase().padStart(4, "0")} ${JSON.stringify(char)}`;
}

export function normalizationDifferences(queued: string, composer: string) {
  const notes: string[] = [];
  const samples = [queued, composer];
  if (samples.some((value) => value.includes("\r"))) notes.push("CRLF -> LF");
  if (samples.some((value) => value.includes("\u00A0"))) notes.push("NBSP -> space");
  if (samples.some((value) => /[\u200B\u200C\u200D\uFEFF]/.test(value))) notes.push("zero-width editor character removed");
  const stripped = samples.map((value) =>
    value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\u00A0/g, " ").replace(/[\u200B\u200C\u200D\uFEFF]/g, ""),
  );
  if (stripped.some((value) => value !== value.replace(/^\n+|\n+$/g, ""))) notes.push("trailing editor newline removed");
  if (stripped.some((value) => value.replace(/^\n+|\n+$/g, "") !== value.replace(/^\n+|\n+$/g, "").replace(/^[ \t\f\v]+|[ \t\f\v]+$/g, ""))) {
    notes.push("surrounding editor whitespace removed");
  }
  return notes;
}

export function compareComposerText(queued: string, composer: string) {
  const verification = verifyComposerMessage(composer, queued);
  const queuedNormalized = verification.queuedNormalized;
  const composerNormalized = verification.composerNormalized;
  const left = Array.from(queuedNormalized);
  const right = Array.from(composerNormalized);
  let mismatch: { index: number; queued: string; composer: string } | null = null;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) {
      mismatch = { index, queued: formatCodePoint(left[index]), composer: formatCodePoint(right[index]) };
      break;
    }
  }
  return {
    rawMatch: verification.rawMatch,
    semanticMatch: verification.semanticMatch,
    queuedLength: queued.length,
    composerLength: composer.length,
    queuedNormalizedLength: queuedNormalized.length,
    composerNormalizedLength: composerNormalized.length,
    notes: normalizationDifferences(queued, composer),
    mismatch,
  };
}

export function formatVerifiedComposer(verification: ReturnType<typeof verifyComposerMessage>) {
  const compared = compareComposerText(verification.queuedRaw, verification.composerRaw);
  const lines = [
    `Queued raw length: ${verification.queuedRaw.length}`,
    `Composer raw length: ${verification.composerRaw.length}`,
    "",
    "Queued message:",
    `length: ${verification.queuedRaw.length}`,
    `normalized length: ${verification.queuedNormalized.length}`,
    "",
    "Composer:",
    `length: ${verification.composerRaw.length}`,
    `normalized length: ${verification.composerNormalized.length}`,
    "",
    `Raw match: ${verification.rawMatch ? "yes" : "no"}`,
    `Semantic normalized match: ${verification.semanticMatch ? "yes" : "no"}`,
    `Raw comparison: ${verification.rawMatch ? "MATCH" : "DIFFERENT"}`,
    `Normalized semantic comparison: ${verification.semanticMatch ? "MATCH" : "DIFFERENT"}`,
  ];
  if (compared.notes.length > 0) {
    lines.push("");
    lines.push("Normalization differences:");
    compared.notes.forEach((note) => lines.push(`- ${note}`));
  }
  if (!verification.semanticMatch && compared.mismatch) {
    lines.push("");
    lines.push(`First semantic mismatch at character ${compared.mismatch.index}:`);
    lines.push(`queued: ${compared.mismatch.queued}`);
    lines.push(`composer: ${compared.mismatch.composer}`);
  }
  lines.push("");
  lines.push("Queued text:");
  lines.push(verification.queuedRaw);
  lines.push("");
  lines.push("Composer text:");
  lines.push(verification.composerRaw);
  return lines.join("\n");
}

export function formatComposerComparison(queued: string, composer: string) {
  return formatVerifiedComposer(verifyComposerMessage(composer, queued));
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
  if (normalizeComposerForComparison(input.composerText) === "") return "confirmed" as const;
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
  if (/thread identity/i.test(job.last_error ?? "")) {
    if (job.status === "retry_wait") return "Retrying — Thread identity not confirmed";
    if (job.status === "running" || job.status === "claimed") return "Needs attention — Could not save retry state";
  }
  if (job.status === "retry_wait") {
    if (
    job.last_error &&
    (/recipient|thread identity|previous attempt is uncertain|composer_text_mismatch|existing_draft_mismatch/i.test(job.last_error) ||
      job.last_error === "The composer text did not match the queued message, so it was not sent." ||
      job.last_error === EXISTING_DRAFT_MISMATCH)
  ) {
    return job.last_error;
  }
    return "Retry scheduled";
  }
  if (job.status === "failed") return job.last_error === EXISTING_DRAFT_MISMATCH ? job.last_error : "Failed";
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
