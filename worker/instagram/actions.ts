import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { debugDir, screenshotDir } from "../paths";
import { AttentionError, SelectorError } from "./errors";
import {
  composerValue,
  feedCandidates,
  hasPriorConversation,
  isAuthenticatedHome,
  messagingUnavailable,
  pageSignal,
  profileFromDom,
} from "./interpret";
import {
  type ActiveComposerCandidate,
  composerDraftDecision,
  confirmConversationRecipient,
  EXISTING_DRAFT_MISMATCH,
  type NavigationProvenance,
  detectComposer,
  draftClearKeys,
  formatComposerCandidates,
  formatSendGate,
  formatVerifiedComposer,
  normalizeComposerForComparison,
  sendGateDecision,
  verifyComposerMessage,
  DM_OPEN_POLL_MS,
  DM_OPEN_WINDOW_MS,
  selectPrimaryMessageAction,
  SEND_CONFIRM_WINDOW_MS,
  sendConfirmation,
  sendRecoveryDecision,
  sameActiveComposer,
  selectActiveMessageComposer,
  threadHasExactOutbound,
} from "../../lib/outreach/dm";
import {
  confirmFollowAfterClick,
  isPreexistingFollow,
  shouldCompleteFollowWithoutClick,
} from "../../lib/outreach/follow-confirm";
import { isExcludedRelationship, profileUrlFor, selectPrimaryRelationship, type FollowRelationship } from "./parse";
import { openUrl, readDom } from "./read-dom";
import type { DomSnapshot } from "./types";

const ACTION_TIMEOUT_MS = 8_000;

export async function pageNeedsAttention(page: Page) {
  const dom = await readDom(page);
  const signal = pageSignal(dom);
  if (signal === "login_required" || signal === "instagram_checkpoint" || signal === "action_blocked" || signal === "rate_limited") {
    return signal;
  }
  return null;
}

export async function ensureHome(page: Page) {
  await openUrl(page, "https://www.instagram.com/");
  const dom = await readDom(page);
  const signal = pageSignal(dom);
  if (signal === "login_required" || signal === "instagram_checkpoint" || signal === "action_blocked" || signal === "rate_limited") {
    throw new AttentionError(signal, attentionMessage(signal));
  }
  if (!isAuthenticatedHome(dom)) {
    throw new AttentionError("login_required", "Sign in to Instagram in the browser window. The worker will continue after login.");
  }
  return feedCandidates(dom);
}

export async function readProfile(page: Page, username: string, options?: { debug?: boolean; screenshot?: boolean }) {
  await openUrl(page, profileUrlFor(username));
  return inspectCurrent(page, username, options);
}

async function inspectCurrent(page: Page, username: string, options?: { debug?: boolean; screenshot?: boolean }) {
  await page.waitForSelector("header, main", { timeout: ACTION_TIMEOUT_MS }).catch(() => undefined);
  let dom = await readDom(page);
  let profile = profileFromDom(dom, username);
  const started = Date.now();
  while (Date.now() - started < ACTION_TIMEOUT_MS && profile.relationship === "unknown") {
    await new Promise((resolve) => setTimeout(resolve, 500));
    dom = await readDom(page);
    profile = profileFromDom(dom, username);
  }
  const signal = pageSignal(dom);
  if (signal === "login_required" || signal === "instagram_checkpoint" || signal === "action_blocked" || signal === "rate_limited") {
    throw new AttentionError(signal, attentionMessage(signal));
  }
  if (signal === "profile_not_found") {
    return { profileExists: false as const, relationship: "unknown" as FollowRelationship, profile };
  }
  if (options?.debug || process.argv.includes("--debug")) {
    const choice = selectPrimaryRelationship(dom.exactRelationshipHits ?? [], dom.usernameBox, dom.optionsBox);
    console.log(`@${username}`);
    console.log("global exact relationship candidates:");
    if (choice.decisions.length === 0) console.log("  none");
    choice.decisions.forEach((decision, index) => {
      const box = decision.box ? `${decision.box.x}/${decision.box.y}/${decision.box.width}/${decision.box.height}` : "none";
      const ancestorBox = decision.ancestorBox ? `${decision.ancestorBox.x}/${decision.ancestorBox.y}/${decision.ancestorBox.width}/${decision.ancestorBox.height}` : "none";
      console.log(`Candidate ${index}:`);
      console.log(`label: "${decision.label}"`);
      console.log(`element: ${decision.tag || "unknown"}`);
      console.log(`interactive ancestor: ${decision.ancestorTag || "none"}${decision.ancestorRole ? ` role=${decision.ancestorRole}` : ""}`);
      console.log(`element box: ${box}`);
      console.log(`ancestor box: ${ancestorBox}`);
      console.log(`distance from username: ${decision.distance ?? "unknown"}`);
      console.log(`accepted as primary: ${decision.accepted ? "true" : "false"}`);
      console.log(`reason: ${decision.reason}`);
    });
    console.log("accepted primary action:");
    console.log(choice.acceptedLabel || "none");
    console.log("relationship:");
    console.log(profile.relationship);
    console.log(`strategy: ${profile.strategies.relationship}`);
    console.log(`followers: ${profile.followerCount ?? "unknown"} (${profile.strategies.followers ?? "none"})`);
    console.log(`display_name: ${profile.displayName ?? "unknown"} (${profile.strategies.displayName ?? "none"})`);
    console.log(`bio_length: ${profile.bio?.length ?? 0} (${profile.strategies.bio ?? "none"})`);
    if (profile.relationship === "unknown" || profile.followerCount === null) {
      saveDebugSnapshot(username, dom);
    }
  }
  if (options?.screenshot) {
    const url = page.url();
    if (!url.includes("/accounts/login") && !url.includes("/challenge/")) {
      fs.mkdirSync(debugDir(), { recursive: true });
      const file = path.join(debugDir(), `inspect-${username}.png`);
      await page.screenshot({ path: file, fullPage: false }).catch(() => undefined);
      console.log(`Screenshot: ${file}`);
    }
  }
  return { profileExists: true as const, relationship: profile.relationship, profile };
}

function saveDebugSnapshot(username: string, dom: DomSnapshot) {
  fs.mkdirSync(debugDir(), { recursive: true });
  const file = path.join(debugDir(), `${Date.now()}-${username}.json`);
  const safe = {
    url: dom.url,
    title: dom.title,
    headerLines: dom.headerLines ?? [],
    headerButtons: dom.headerButtons ?? [],
    relationshipCandidates: (dom.relationshipCandidates ?? []).map((candidate) => ({
      tag: candidate.tag,
      role: candidate.role,
      text: candidate.text,
      ariaLabel: candidate.ariaLabel,
      title: candidate.title,
      href: candidate.href,
      tabIndex: candidate.tabIndex,
      scope: candidate.scope,
      isInteractive: candidate.isInteractive === true,
    })),
    exactRelationshipHits: (dom.exactRelationshipHits ?? []).map((hit) => ({
      label: hit.label,
      tag: hit.tag,
      role: hit.role,
      text: hit.text,
      ariaLabel: hit.ariaLabel,
      title: hit.title,
      href: hit.href,
      tabIndex: hit.tabIndex,
      box: hit.box,
      inSuggestion: hit.inSuggestion,
      inDialog: hit.inDialog,
      otherUsername: hit.otherUsername,
      ancestor: hit.ancestor,
    })),
    buttons: dom.buttons.slice(0, 30),
    links: dom.links.filter((link) => /follower|following|posts/i.test(`${link.text} ${link.label ?? ""} ${link.href}`)).slice(0, 20),
    metaDescription: dom.metaDescription ?? null,
  };
  fs.writeFileSync(file, JSON.stringify(safe, null, 2));
}

export async function followProfile(
  page: Page,
  username: string,
  prior?: { followClickAttempted?: boolean; executionStarted?: boolean; verifyNotFollowing?: boolean },
) {
  const current = await readProfile(page, username);
  const context = {
    relationship: current.relationship,
    followClickAttempted: prior?.followClickAttempted === true,
    verifyNotFollowing: prior?.verifyNotFollowing === true,
    executionStarted: prior?.executionStarted === true,
  };
  if (!current.profileExists) return { followed: false, relationshipStatus: "unknown" as const, profileExists: false };
  if (shouldCompleteFollowWithoutClick(context)) {
    return {
      followed: true,
      relationshipStatus: current.relationship,
      profileExists: true,
      recoveredWithoutClick: true,
    };
  }
  if (isPreexistingFollow(context) || (isExcludedRelationship(current.relationship) && !context.followClickAttempted && !context.executionStarted)) {
    return {
      followed: false,
      relationshipStatus: current.relationship,
      skippedBecauseAlreadyFollowing: true,
      profileExists: true,
    };
  }
  if (current.relationship !== "not_following") {
    throw new SelectorError(`Could not determine follow relationship for @${username}.`);
  }
  const button = page.getByRole("button", { name: /^Follow$/ });
  await button.click({ timeout: ACTION_TIMEOUT_MS });
  const confirmation = await confirmFollowAfterClick({
    now: () => Date.now(),
    sleep: (ms) => page.waitForTimeout(ms),
    readRelationship: async () => (await inspectCurrent(page, username)).relationship,
    refresh: async () => {
      await page.reload({ waitUntil: "domcontentloaded" });
    },
  });
  if (confirmation.confirmed) {
    return { followed: true, relationshipStatus: confirmation.relationship, profileExists: true };
  }
  return {
    followed: false,
    followClickAttempted: true,
    confirmation: "uncertain" as const,
    relationshipStatus: confirmation.relationship,
    profileExists: true,
  };
}

export async function getPrimaryMessageAction(page: Page, username: string) {
  await readProfile(page, username);
  const dom = await readDom(page);
  const choice = selectPrimaryMessageAction(dom.messageActionHits ?? [], dom.usernameBox);
  return { ...choice, relationship: profileFromDom(dom, username).relationship, displayName: profileFromDom(dom, username).displayName };
}

export async function inspectDirectMessage(page: Page, username: string) {
  const current = await readProfile(page, username);
  const action = selectPrimaryMessageAction((await readDom(page)).messageActionHits ?? [], (await readDom(page)).usernameBox);
  if (!action.found || !action.hit?.box) {
    return {
      relationship: current.relationship,
      messageAction: false,
      conversationOpened: false,
      conversationUsername: null as string | null,
      composerFound: false,
      composerStrategy: null as string | null,
      existingConversation: false,
      profileExists: current.profileExists,
    };
  }
  const clicked = await clickMessageHit(page, action.hit.box);
  if (!clicked) {
    return {
      relationship: current.relationship,
      messageAction: false,
      conversationOpened: false,
      conversationUsername: null,
      composerFound: false,
      composerStrategy: null,
      existingConversation: false,
      profileExists: current.profileExists,
    };
  }
  const opened = await waitForDirect(page, username, current.profile.displayName, "", current.profile.username === username.toLowerCase());
  if (!opened.existingConversation) {
    await saveRecipientDebug(page, username, opened.dom, opened.recipient.ambiguousReason);
  }
  return {
    relationship: current.relationship,
    messageAction: true,
    conversationOpened: opened.opened,
    conversationUsername: opened.recipient.confirmed ? username : null,
    recipientConfirmed: opened.recipient.confirmed,
    recipientStrategy: opened.recipient.strategy,
    recipientReason: opened.recipient.ambiguousReason,
    recipientCandidates: opened.recipient.evidence,
    headerCandidates: opened.dom.recipientCandidates ?? [],
    paneFound: opened.dom.activeConversationFound === true,
    directPath: opened.dom.directPath ?? "",
    displayName: current.profile.displayName,
    sourceVerified: current.profile.username === username.toLowerCase(),
    conflicting: opened.recipient.evidence.some((item) => item.classification === "identity_conflict"),
    composerFound: opened.composerFound,
    composerStrategy: opened.composerStrategy,
    existingConversation: opened.existingConversation,
    profileExists: current.profileExists,
  };
}

export async function sendExactMessage(
  page: Page,
  username: string,
  message: string,
  prior?: { followCreatedBySequence?: boolean; sendAttempted?: boolean },
) {
  const current = await readProfile(page, username);
  if (!current.profileExists) return { sent: false, profileExists: false };
  if (current.profile.username && current.profile.username !== username.toLowerCase()) {
    throw new SelectorError(`The open profile is @${current.profile.username}, not @${username}.`);
  }
  if (!message.trim()) throw new SelectorError("The send job did not include the locked message.");
  const owned = prior?.followCreatedBySequence === true;
  if ((current.relationship === "following" || current.relationship === "requested") && !owned) {
    return { sent: false, preexistingFollow: true, profileExists: true };
  }
  if (current.relationship !== "following" && current.relationship !== "requested") {
    throw new SelectorError(`@${username} is not followed by this outreach sequence, so the message was not sent.`);
  }
  const dom = await readDom(page);
  if (messagingUnavailable(dom)) return { sent: false, dmUnavailable: true, profileExists: true };
  const action = selectPrimaryMessageAction(dom.messageActionHits ?? [], dom.usernameBox);
  if (!action.found || !action.hit?.box) {
    await saveComposerDebug(page, username, dom);
    return { sent: false, composerNotFound: true, sendAttempted: false, profileExists: true };
  }
  const clicked = await clickMessageHit(page, action.hit.box);
  if (!clicked) {
    await saveComposerDebug(page, username, dom);
    return { sent: false, composerNotFound: true, sendAttempted: false, profileExists: true };
  }
  const opened = await waitForDirect(page, username, current.profile.displayName, message, current.profile.username === username.toLowerCase());
  if (
    opened.signal === "login_required" ||
    opened.signal === "instagram_checkpoint" ||
    opened.signal === "action_blocked" ||
    opened.signal === "rate_limited"
  ) {
    throw new AttentionError(opened.signal, attentionMessage(opened.signal));
  }
  if (opened.exactOutbound) return { sent: true, alreadyPresent: true, profileExists: true };
  const decision = sendRecoveryDecision({
    sendAttempted: prior?.sendAttempted === true,
    exactOutboundPresent: opened.exactOutbound,
    composerFound: opened.composerFound,
    priorConversation: opened.existingConversation,
    conversationMatches: opened.recipient.confirmed,
  });
  if (decision.action === "review") {
    return {
      sent: false,
      manualReview: prior?.sendAttempted === true,
      recipientUnconfirmed: prior?.sendAttempted !== true,
      ambiguousReason: decision.reason,
      sendAttempted: prior?.sendAttempted === true,
      profileExists: true,
    };
  }
  if (decision.action === "existing_conversation") return { sent: false, existingConversation: true };
  const inserted = await insertLockedMessage(page, message, "send");
  if (!inserted.composerSelected) {
    console.log(inserted.candidatesText);
    await saveComposerDebug(page, username, opened.dom);
    return { sent: false, composerNotFound: true, sendAttempted: false, profileExists: true };
  }
  if (inserted.draft === "queued-message") {
    console.log("Composer already contains queued message.");
    console.log("No duplicate insertion required.");
  }
  if (inserted.draft === "other-draft") {
    console.log(EXISTING_DRAFT_MISMATCH);
    return { sent: false, sendAttempted: false, existingDraftMismatch: true, profileExists: true };
  }
  const verification = verifyComposerMessage(inserted.composerText, message);
  const gate = {
    recipientConfirmed: opened.recipient.confirmed,
    followOwnedBySequence: owned,
    existingConversation: opened.existingConversation,
    composerFound: inserted.composerSelected,
    composerSemanticMatch: verification.semanticMatch,
    sendAttempted: prior?.sendAttempted === true,
  };
  console.log(formatVerifiedComposer(verification));
  console.log("");
  console.log(formatSendGate(gate));
  const decisionGate = sendGateDecision(gate);
  if (!decisionGate.allowed) {
    if (decisionGate.blockingGate === "composerSemanticMatch") {
      return { sent: false, sendAttempted: false, composerTextMismatch: true, profileExists: true };
    }
    if (decisionGate.blockingGate === "existingConversation") return { sent: false, existingConversation: true, profileExists: true };
    if (decisionGate.blockingGate === "sendAttempted") {
      return { sent: false, manualReview: true, sendAttempted: true, ambiguousReason: "Send state from a previous attempt is uncertain.", profileExists: true };
    }
    if (decisionGate.blockingGate === "followOwnedBySequence") return { sent: false, preexistingFollow: true, profileExists: true };
    if (decisionGate.blockingGate === "recipientConfirmed") {
      return { sent: false, recipientUnconfirmed: true, sendAttempted: false, ambiguousReason: "Conversation recipient could not be confirmed.", profileExists: true };
    }
    return { sent: false, composerNotFound: true, sendAttempted: false, profileExists: true };
  }
  const send = page.getByRole("button", { name: /^Send$/ });
  await send.click({ timeout: ACTION_TIMEOUT_MS });
  const confirmed = await confirmSend(page, message);
  if (confirmed === "confirmed") return { sent: true, profileExists: true };
  return { sent: false, sendAttempted: true, confirmation: "uncertain" as const, profileExists: true };
}

const CLICK_MESSAGE_SOURCE = `({ x, y }) => {
  const nodes = [...document.querySelectorAll("button, [role='button'], a, span, div")];
  let best = null;
  let bestDistance = 48;
  for (const el of nodes) {
    const aria = (el.getAttribute("aria-label") || "").trim();
    const text = (el.innerText || el.textContent || "").trim().replace(/\\s+/g, " ");
    if (!/^message(?:\\.\\.\\.)?$/i.test(aria) && !/^message(?:\\.\\.\\.)?$/i.test(text)) continue;
    if (el.closest("nav, [role='navigation']")) continue;
    const rect = el.getBoundingClientRect();
    const distance = Math.hypot((rect.x + rect.width / 2) - x, (rect.y + rect.height / 2) - y);
    if (distance <= bestDistance) {
      best = el;
      bestDistance = distance;
    }
  }
  if (!best) return false;
  let target = best;
  for (let depth = 0; target && depth < 6; depth += 1) {
    const tag = target.tagName.toLowerCase();
    const role = (target.getAttribute("role") || "").toLowerCase();
    if (tag === "button" || role === "button" || tag === "a") break;
    target = target.parentElement;
  }
  (target || best).click();
  return true;
}`;

const ACTIVE_COMPOSER_SOURCE = `() => {
  function semanticText(root) {
    if (!root) return "";
    const tagName = root.tagName ? root.tagName.toLowerCase() : "";
    if (tagName === "textarea") return String(root.value || "");
    const blocks = { p: 1, div: 1, li: 1, blockquote: 1, h1: 1, h2: 1, h3: 1 };
    const out = [];
    function append(node) {
      if (!node) return;
      if (node.nodeType === 3) {
        out.push(node.nodeValue || "");
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName.toLowerCase();
      if (tag === "br") {
        out.push("\\n");
        return;
      }
      if (blocks[tag]) {
        const current = out.join("");
        if (current.length && current.charAt(current.length - 1) !== "\\n") out.push("\\n");
      }
      for (let index = 0; index < node.childNodes.length; index += 1) append(node.childNodes[index]);
    }
    for (let index = 0; index < root.childNodes.length; index += 1) append(root.childNodes[index]);
    return out.join("");
  }
  function isHidden(el) {
    if (el.getAttribute("aria-hidden") === "true" || el.hasAttribute("hidden")) return true;
    const style = window.getComputedStyle(el);
    return style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0;
  }
  function isSearch(el) {
    const label = ((el.getAttribute("aria-label") || "") + " " + (el.getAttribute("placeholder") || "")).toLowerCase();
    return label.includes("search") || Boolean(el.closest && el.closest("nav, [role='navigation']"));
  }
  function paneFrom(anchor) {
    const composerBox = anchor.getBoundingClientRect();
    let node = anchor.parentElement;
    let pane = null;
    for (let depth = 0; node && node !== document.body && depth < 14; depth += 1) {
      const rect = node.getBoundingClientRect();
      const includesInbox = rect.width > composerBox.width + 280 && rect.left < composerBox.left - 180;
      if (includesInbox) break;
      if (rect.width >= 260 && rect.height >= 220 && rect.left <= composerBox.left && rect.right >= composerBox.right - 8) pane = node;
      node = node.parentElement;
    }
    return pane;
  }
  function collect() {
    const nodes = [...document.querySelectorAll("textarea, [role='textbox'], [contenteditable='true']")];
    let anchor = null;
    let bestBottom = -1;
    for (const el of nodes) {
      if (isHidden(el) || isSearch(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      const bottom = rect.y + rect.height;
      if (bottom >= bestBottom) {
        bestBottom = bottom;
        anchor = el;
      }
    }
    const pane = anchor ? paneFrom(anchor) : null;
    const candidates = nodes.map((el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const hidden = isHidden(el);
      return {
        tag: el.tagName.toLowerCase(),
        role: (el.getAttribute("role") || "").toLowerCase(),
        contentEditable: el.getAttribute("contenteditable") === "true",
        ariaLabel: (el.getAttribute("aria-label") || "").slice(0, 80),
        placeholder: (el.getAttribute("placeholder") || "").slice(0, 80),
        box: rect.width >= 1 && rect.height >= 1 ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : null,
        visible: !hidden && style.visibility !== "hidden" && rect.width >= 1 && rect.height >= 1,
        hidden,
        insideActiveConversation: Boolean(pane && pane.contains(el)),
        searchField: isSearch(el),
        enabled: !el.disabled && el.getAttribute("aria-disabled") !== "true" && el.getAttribute("contenteditable") !== "false",
      };
    });
    return { nodes, candidates };
  }
  function activeElement() {
    const collected = collect();
    const eligible = [];
    collected.candidates.forEach((candidate, index) => {
      const editable = candidate.contentEditable || candidate.tag === "textarea" || candidate.role === "textbox";
      if (!editable || candidate.hidden || !candidate.visible || !candidate.box || !candidate.enabled || candidate.searchField || !candidate.insideActiveConversation) return;
      eligible.push(collected.nodes[index]);
    });
    return eligible.length === 1 ? eligible[0] : null;
  }
  return { collect, semanticText, activeElement };
}`;

async function clickMessageHit(page: Page, box: { x: number; y: number; width: number; height: number }) {
  const click = new Function(`return (${CLICK_MESSAGE_SOURCE})`)() as (payload: { x: number; y: number }) => boolean;
  return page.evaluate(click, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

export async function getActiveMessageComposer(page: Page) {
  const read = new Function(`return () => (${ACTIVE_COMPOSER_SOURCE})().collect()`)() as () => { candidates: ActiveComposerCandidate[] };
  const collected = await page.evaluate(read);
  return selectActiveMessageComposer(collected.candidates);
}

async function readActiveComposerText(page: Page) {
  const read = new Function(`return () => {
    const api = (${ACTIVE_COMPOSER_SOURCE})();
    const el = api.activeElement();
    return el ? api.semanticText(el) : null;
  }`)() as () => string | null;
  return page.evaluate(read);
}

async function composerIsFocused(page: Page) {
  const read = new Function(`return () => {
    const el = (${ACTIVE_COMPOSER_SOURCE})().activeElement();
    const active = document.activeElement;
    return Boolean(el && active && (active === el || el.contains(active)));
  }`)() as () => boolean;
  return page.evaluate(read);
}

async function focusActiveComposer(page: Page) {
  const choice = await getActiveMessageComposer(page);
  if (choice.status !== "selected" || !choice.selected?.box) return false;
  const box = choice.selected.box;
  await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 24));
  await page.waitForTimeout(200);
  return composerIsFocused(page);
}

async function dispatchInsertText(page: Page, message: string) {
  const dispatch = new Function(`return (text) => {
    const el = (${ACTIVE_COMPOSER_SOURCE})().activeElement();
    if (!el) return false;
    el.focus();
    const before = new InputEvent("beforeinput", { bubbles: true, cancelable: true, data: text, inputType: "insertText" });
    const prevented = !el.dispatchEvent(before);
    if (!prevented) document.execCommand("insertText", false, text);
    return true;
  }`)() as (text: string) => boolean;
  return page.evaluate(dispatch, message);
}

async function typeMessageWithoutEnter(page: Page, message: string) {
  const parts = message.split("\n");
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index]) await page.keyboard.type(parts[index], { delay: 0 });
    if (index < parts.length - 1) await page.keyboard.insertText("\n");
  }
}

async function insertLockedMessage(page: Page, message: string, mode: "send" | "inspect") {
  const before = await getActiveMessageComposer(page);
  const candidatesText = formatComposerCandidates(before);
  if (before.status !== "selected" || !before.selected) {
    return {
      composerSelected: false,
      focused: false,
      initiallyEmpty: false,
      sameComposer: false,
      method: null as string | null,
      composerText: "",
      beforeLength: null as number | null,
      candidatesText,
      clearNote: "",
      blockReason: "More than one composer matched, or none was inside the active conversation.",
      draft: null as "empty" | "queued-message" | "other-draft" | null,
    };
  }
  const beforeText = (await readActiveComposerText(page)) ?? "";
  const draft = composerDraftDecision(message, beforeText);
  if (draft === "other-draft") {
    return {
      composerSelected: true,
      focused: false,
      initiallyEmpty: false,
      sameComposer: true,
      method: null,
      composerText: beforeText,
      beforeLength: beforeText.length,
      candidatesText,
      clearNote: "",
      blockReason: EXISTING_DRAFT_MISMATCH,
      draft,
    };
  }
  if (draft === "queued-message") {
    return {
      composerSelected: true,
      focused: true,
      initiallyEmpty: false,
      sameComposer: true,
      method: "already-present",
      composerText: beforeText,
      beforeLength: beforeText.length,
      candidatesText,
      clearNote: "",
      blockReason: null,
      draft,
    };
  }
  const focused = await focusActiveComposer(page);
  if (!focused) {
    return {
      composerSelected: true,
      focused: false,
      initiallyEmpty: true,
      sameComposer: true,
      method: null,
      composerText: beforeText,
      beforeLength: beforeText.length,
      candidatesText,
      clearNote: "",
      blockReason: "Composer focused: no",
      draft: "empty" as const,
    };
  }
  await page.keyboard.insertText(message);
  await page.waitForTimeout(600);
  let method = "keyboard.insertText";
  let composerText = (await readActiveComposerText(page)) ?? "";
  if (mode === "inspect" && normalizeComposerForComparison(composerText) === "") {
    await dispatchInsertText(page, message);
    await page.waitForTimeout(600);
    const afterInput = (await readActiveComposerText(page)) ?? "";
    if (normalizeComposerForComparison(afterInput) !== "") {
      method = "beforeinput-insertText";
      composerText = afterInput;
    } else {
      await typeMessageWithoutEnter(page, message);
      await page.waitForTimeout(600);
      method = "keyboard.type-segments";
      composerText = (await readActiveComposerText(page)) ?? "";
    }
  }
  const after = await getActiveMessageComposer(page);
  const sameComposer = Boolean(after.selected && sameActiveComposer(before.selected, after.selected));
  return {
    composerSelected: after.status === "selected",
    focused: true,
    initiallyEmpty: true,
    sameComposer,
    method,
    composerText,
    beforeLength: beforeText.length,
    candidatesText,
    clearNote: "",
    blockReason: null,
    draft: "empty" as const,
  };
}

async function clearComposerDraft(page: Page) {
  const focused = await focusActiveComposer(page);
  if (!focused) return { cleared: false, note: "Composer draft remains. Nothing was sent." };
  for (const key of draftClearKeys(process.platform)) {
    await page.keyboard.press(key);
  }
  await page.waitForTimeout(300);
  const remaining = (await readActiveComposerText(page)) ?? "";
  if (normalizeComposerForComparison(remaining) === "") return { cleared: true, note: "Composer cleared after inspection: yes" };
  return { cleared: false, note: "Composer draft remains. Nothing was sent." };
}

function directSnapshot(
  dom: DomSnapshot,
  username: string,
  displayName: string | null,
  locked: string,
  sourceVerified: boolean,
  signal: ReturnType<typeof pageSignal>,
) {
  const composer = detectComposer(dom.composerCandidates ?? []);
  const opened = composer.found || dom.url.includes("/direct/") || (dom.recipientCandidates ?? []).length > 0;
  const provenance: NavigationProvenance = {
    sourceProfileUsername: username,
    sourceProfileVerified: sourceVerified,
    messageActionClicked: true,
    directOpenedFromProfile: opened,
  };
  const recipient = confirmConversationRecipient({
    username,
    displayName,
    candidates: dom.recipientCandidates ?? [],
    provenance,
  });
  return {
    signal,
    opened,
    recipient,
    composerFound: composer.found,
    composerStrategy: composer.strategy,
    existingConversation: hasPriorConversation(dom, locked),
    exactOutbound: threadHasExactOutbound(dom.threadMessages, locked),
    dom,
  };
}

async function waitForDirect(page: Page, username: string, displayName: string | null, locked = "", sourceVerified = false) {
  const started = Date.now();
  let dom = await readDom(page);
  let composerReadyAt: number | null = null;
  while (Date.now() - started <= DM_OPEN_WINDOW_MS) {
    const signal = pageSignal(dom);
    if (signal === "instagram_checkpoint" || signal === "action_blocked" || signal === "rate_limited" || signal === "login_required") {
      return directSnapshot(dom, username, displayName, locked, sourceVerified, signal);
    }
    const snapshot = directSnapshot(dom, username, displayName, locked, sourceVerified, null);
    if (snapshot.composerFound && (snapshot.exactOutbound || snapshot.existingConversation || snapshot.recipient.confirmed || (composerReadyAt !== null && Date.now() - composerReadyAt >= 2_000))) {
      return snapshot;
    }
    if (snapshot.composerFound && composerReadyAt === null) composerReadyAt = Date.now();
    if (Date.now() - started >= DM_OPEN_WINDOW_MS) break;
    await page.waitForTimeout(DM_OPEN_POLL_MS);
    dom = await readDom(page);
  }
  return directSnapshot(dom, username, displayName, locked, sourceVerified, null);
}

async function confirmSend(page: Page, message: string) {
  const started = Date.now();
  while (Date.now() - started <= SEND_CONFIRM_WINDOW_MS) {
    const dom = await readDom(page);
    if (threadHasExactOutbound(dom.threadMessages, message) || sendConfirmation({ composerText: composerValue(dom), threadMessages: dom.threadMessages, locked: message }) === "confirmed") {
      return "confirmed" as const;
    }
    if (Date.now() - started >= SEND_CONFIRM_WINDOW_MS) break;
    await page.waitForTimeout(DM_OPEN_POLL_MS);
  }
  return "uncertain" as const;
}

async function saveComposerDebug(page: Page, username: string, dom: DomSnapshot) {
  const url = dom.url || page.url();
  if (url.includes("/accounts/login") || url.includes("/challenge/")) return;
  fs.mkdirSync(debugDir(), { recursive: true });
  const base = path.join(debugDir(), `dm-${username}-composer-missing`);
  await page.screenshot({ path: `${base}.png`, fullPage: false }).catch(() => undefined);
  const safe = {
    url,
    conversationHeader: dom.conversationHeader ?? "",
    buttons: (dom.buttons ?? []).slice(0, 30).map((button) => ({ name: button.name.slice(0, 80) })),
    composers: (dom.composerCandidates ?? []).map((candidate) => ({
      tag: candidate.tag,
      role: candidate.role,
      ariaLabel: candidate.ariaLabel,
      placeholder: candidate.placeholder,
      contentEditable: candidate.contentEditable,
      box: candidate.box,
    })),
    textboxes: (dom.textboxes ?? []).map((box) => ({
      tag: "textbox",
      ariaLabel: box.name,
    })),
  };
  fs.writeFileSync(`${base}.json`, JSON.stringify(safe, null, 2));
}

async function saveRecipientDebug(page: Page, username: string, dom: DomSnapshot, reason: string | null) {
  const url = dom.url || page.url();
  if (url.includes("/accounts/login") || url.includes("/challenge/")) return;
  fs.mkdirSync(debugDir(), { recursive: true });
  const base = path.join(debugDir(), `dm-${username}-header-inspect`);
  const privateHistory = dom.threadMessages.some((item) => item.trim().length > 0);
  if (!privateHistory) {
    await page.screenshot({ path: `${base}.png`, fullPage: false }).catch(() => undefined);
  }
  fs.writeFileSync(
    `${base}.json`,
    JSON.stringify(
      {
        url,
        reason,
        conversationHeader: dom.conversationHeader ?? "",
        recipients: (dom.recipientCandidates ?? []).map((candidate) => ({
          text: candidate.text,
          href: candidate.href,
          role: candidate.role,
          ariaLabel: candidate.ariaLabel,
          title: candidate.title,
          alt: candidate.alt,
        })),
      },
      null,
      2,
    ),
  );
}

export async function inspectComposerMessage(page: Page, username: string, message: string) {
  const current = await readProfile(page, username);
  const dom = await readDom(page);
  const action = selectPrimaryMessageAction(dom.messageActionHits ?? [], dom.usernameBox);
  if (!action.found || !action.hit?.box) {
    return { recipientConfirmed: false, composerFound: false, existingConversation: false, inserted: false, cleared: false, clearNote: "", composerText: "", reason: "Message action was not found." };
  }
  const clicked = await clickMessageHit(page, action.hit.box);
  if (!clicked) {
    return { recipientConfirmed: false, composerFound: false, existingConversation: false, inserted: false, cleared: false, clearNote: "", composerText: "", reason: "Message action could not be opened." };
  }
  const opened = await waitForDirect(page, username, current.profile.displayName, message, current.profile.username === username.toLowerCase());
  if (!opened.recipient.confirmed) {
    return {
      recipientConfirmed: false,
      composerFound: opened.composerFound,
      existingConversation: opened.existingConversation,
      inserted: false,
      cleared: false,
      clearNote: "",
      composerText: "",
      reason: opened.recipient.ambiguousReason,
    };
  }
  if (opened.existingConversation) {
    return {
      recipientConfirmed: true,
      composerFound: opened.composerFound,
      existingConversation: true,
      inserted: false,
      cleared: false,
      clearNote: "",
      composerText: "",
      reason: "An existing conversation is visible, so the composer was not changed.",
    };
  }
  const inserted = await insertLockedMessage(page, message, "inspect");
  let clearNote = "";
  let cleared = false;
  if (inserted.method && inserted.method !== "already-present") {
    const clearedResult = await clearComposerDraft(page);
    cleared = clearedResult.cleared;
    clearNote = clearedResult.note;
  }
  return {
    recipientConfirmed: true,
    composerFound: inserted.composerSelected,
    existingConversation: false,
    inserted: Boolean(inserted.method),
    cleared,
    clearNote,
    composerText: inserted.composerText,
    reason: inserted.blockReason,
    candidatesText: inserted.candidatesText,
    beforeLength: inserted.beforeLength,
    focused: inserted.focused,
    method: inserted.method,
    initiallyEmpty: inserted.initiallyEmpty,
    draft: inserted.draft,
  };
}

export async function previewOutreach(page: Page, username: string, message: string | null) {
  const current = await readProfile(page, username);
  const report = {
    profileExists: current.profileExists,
    username: current.profile.username,
    relationship: current.relationship,
    followers: current.profile.followerCount,
    displayName: current.profile.displayName,
    wouldFollow: current.profileExists && current.relationship === "not_following",
    wouldSend: false,
    existingConversation: false,
    message: message ?? "",
  };
  return report;
}

export async function scrollFeed(page: Page) {
  await page.mouse.wheel(0, 700);
}

export async function saveErrorScreenshot(page: Page, action: string) {
  const url = page.url();
  if (url.includes("/accounts/login") || url.includes("/challenge/")) return null;
  fs.mkdirSync(screenshotDir(), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(screenshotDir(), `${stamp}-${action}.png`);
  await page.screenshot({ path: file, fullPage: false }).catch(() => undefined);
  return file;
}

function attentionMessage(signal: "login_required" | "instagram_checkpoint" | "action_blocked" | "rate_limited") {
  if (signal === "login_required") {
    return "Sign in to Instagram in the browser window. The worker will continue after login.";
  }
  if (signal === "instagram_checkpoint") return "Instagram is asking for a checkpoint. Resolve it in the browser window. Automation is paused.";
  if (signal === "action_blocked") return "Instagram blocked an action. Automation is paused until you review the browser window.";
  return "Instagram asked the worker to wait. Automation is paused.";
}
