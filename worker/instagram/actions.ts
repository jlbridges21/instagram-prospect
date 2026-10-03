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
  conversationMatchesProspect,
  detectComposer,
  DM_OPEN_POLL_MS,
  DM_OPEN_WINDOW_MS,
  selectPrimaryMessageAction,
  SEND_CONFIRM_WINDOW_MS,
  sendConfirmation,
  sendRecoveryDecision,
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
  const opened = await waitForDirect(page, username, current.profile.displayName);
  return {
    relationship: current.relationship,
    messageAction: true,
    conversationOpened: opened.opened,
    conversationUsername: opened.matches ? username : null,
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
  const opened = await waitForDirect(page, username, current.profile.displayName, message);
  if (opened.signal) throw new AttentionError(opened.signal, attentionMessage(opened.signal));
  if (opened.exactOutbound) return { sent: true, alreadyPresent: true, profileExists: true };
  const decision = sendRecoveryDecision({
    sendAttempted: prior?.sendAttempted === true,
    exactOutboundPresent: opened.exactOutbound,
    composerFound: opened.composerFound,
    priorConversation: opened.existingConversation,
    conversationMatches: opened.matches,
  });
  if (decision.action === "review") return { sent: false, manualReview: true, sendAttempted: prior?.sendAttempted === true };
  if (decision.action === "existing_conversation") return { sent: false, existingConversation: true };
  if (decision.action === "retry_composer" || !opened.composerStrategy) {
    await saveComposerDebug(page, username, opened.dom);
    return { sent: false, composerNotFound: true, sendAttempted: false, profileExists: true };
  }
  const typed = await writeComposer(page, opened.composerStrategy, message);
  if (typed !== message) {
    return { sent: false, sendAttempted: false, profileExists: true };
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

const WRITE_COMPOSER_SOURCE = `({ strategy, text }) => {
  const nodes = [...document.querySelectorAll("textarea, [role='textbox'], [contenteditable='true']")];
  const node = nodes.find((box) => {
    const tag = box.tagName.toLowerCase();
    const role = (box.getAttribute("role") || "").toLowerCase();
    const label = box.getAttribute("aria-label") || "";
    const placeholder = box.getAttribute("placeholder") || "";
    const editable = box.getAttribute("contenteditable") === "true";
    if (strategy === "textarea-placeholder-message") return tag === "textarea" && /message/i.test(placeholder + " " + label);
    if (strategy === "role-textbox-contenteditable") return role === "textbox" && editable;
    if (strategy === "aria-label-message") return /message/i.test(label);
    return editable;
  });
  if (!node) return "";
  node.focus();
  if (node.tagName.toLowerCase() === "textarea") {
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
    if (descriptor && descriptor.set) descriptor.set.call(node, text);
    else node.value = text;
    node.dispatchEvent(new Event("input", { bubbles: true }));
    return node.value;
  }
  node.textContent = text;
  node.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
  return (node.innerText || node.textContent || "").trim();
}`;

async function clickMessageHit(page: Page, box: { x: number; y: number; width: number; height: number }) {
  const click = new Function(`return (${CLICK_MESSAGE_SOURCE})`)() as (payload: { x: number; y: number }) => boolean;
  return page.evaluate(click, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

async function writeComposer(page: Page, strategy: string, message: string) {
  const write = new Function(`return (${WRITE_COMPOSER_SOURCE})`)() as (payload: { strategy: string; text: string }) => string;
  return page.evaluate(write, { strategy, text: message });
}

async function waitForDirect(page: Page, username: string, displayName: string | null, locked = "") {
  const started = Date.now();
  let dom = await readDom(page);
  let composerReadyAt: number | null = null;
  while (Date.now() - started <= DM_OPEN_WINDOW_MS) {
    const signal = pageSignal(dom);
    if (signal === "instagram_checkpoint" || signal === "action_blocked" || signal === "rate_limited" || signal === "login_required") {
      return { signal, opened: false, matches: false, composerFound: false, composerStrategy: null, existingConversation: false, exactOutbound: false, dom };
    }
    const composer = detectComposer(dom.composerCandidates ?? []);
    const matches = conversationMatchesProspect({
      url: dom.url,
      header: dom.conversationHeader ?? "",
      username,
      displayName,
    });
    const exactOutbound = threadHasExactOutbound(dom.threadMessages, locked);
    const existingConversation = hasPriorConversation(dom, locked);
    if (composer.found && (exactOutbound || existingConversation || (composerReadyAt !== null && Date.now() - composerReadyAt >= 2_000))) {
      return {
        signal: null,
        opened: true,
        matches,
        composerFound: true,
        composerStrategy: composer.strategy,
        existingConversation,
        exactOutbound,
        dom,
      };
    }
    if (composer.found && composerReadyAt === null) composerReadyAt = Date.now();
    if (Date.now() - started >= DM_OPEN_WINDOW_MS) break;
    await page.waitForTimeout(DM_OPEN_POLL_MS);
    dom = await readDom(page);
  }
  const composer = detectComposer(dom.composerCandidates ?? []);
  return {
    signal: null,
    opened: composer.found || dom.url.includes("/direct/"),
    matches: conversationMatchesProspect({ url: dom.url, header: dom.conversationHeader ?? "", username, displayName }),
    composerFound: composer.found,
    composerStrategy: composer.strategy,
    existingConversation: hasPriorConversation(dom, locked),
    exactOutbound: threadHasExactOutbound(dom.threadMessages, locked),
    dom,
  };
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
