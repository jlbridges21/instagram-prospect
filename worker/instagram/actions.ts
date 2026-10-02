import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { debugDir, screenshotDir } from "../paths";
import { AttentionError, SelectorError } from "./errors";
import {
  composerValue,
  feedCandidates,
  hasMessageComposer,
  hasPriorConversation,
  isAuthenticatedHome,
  messagingUnavailable,
  pageSignal,
  profileFromDom,
} from "./interpret";
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

export async function followProfile(page: Page, username: string) {
  const current = await readProfile(page, username);
  if (!current.profileExists) return { followed: false, relationshipStatus: "unknown" as const, profileExists: false };
  if (isExcludedRelationship(current.relationship)) {
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
  const after = await inspectCurrent(page, username);
  if (after.relationship === "following" || after.relationship === "requested") {
    return { followed: true, relationshipStatus: after.relationship, profileExists: true };
  }
  throw new SelectorError(`Follow was clicked for @${username}, but the result could not be confirmed.`);
}

export async function sendExactMessage(page: Page, username: string, message: string) {
  const current = await readProfile(page, username);
  if (!current.profileExists) {
    return { sent: false, profileExists: false };
  }
  if (current.profile.username && current.profile.username !== username.toLowerCase()) {
    throw new SelectorError(`The open profile is @${current.profile.username}, not @${username}.`);
  }
  if (!message.trim()) throw new SelectorError("The send job did not include the locked message.");
  if (current.relationship === "requested") {
    return { sent: false, dmUnavailable: true, profileExists: true };
  }
  if (current.relationship !== "following") {
    throw new SelectorError(`@${username} is not followed by this outreach sequence, so the message was not sent.`);
  }
  const messageButton = page.getByRole("button", { name: /^Message$/ });
  if ((await messageButton.count()) === 0) {
    const dom = await readDom(page);
    if (messagingUnavailable(dom)) return { sent: false, dmUnavailable: true };
    throw new SelectorError(`Could not find the message control for @${username}.`);
  }
  await messageButton.click({ timeout: ACTION_TIMEOUT_MS });
  const opened = await readDom(page);
  const openedSignal = pageSignal(opened);
  if (openedSignal === "instagram_checkpoint" || openedSignal === "action_blocked" || openedSignal === "rate_limited" || openedSignal === "login_required") {
    throw new AttentionError(openedSignal, attentionMessage(openedSignal));
  }
  if (hasPriorConversation(opened, message)) {
    return { sent: false, existingConversation: true };
  }
  if (!hasMessageComposer(opened)) {
    throw new SelectorError(`Could not find the message composer for @${username}.`);
  }
  const box = page.getByRole("textbox", { name: /message/i });
  await box.fill(message, { timeout: ACTION_TIMEOUT_MS });
  const typed = await readDom(page);
  if (composerValue(typed) !== message) {
    throw new SelectorError("The composer text did not match the queued message, so it was not sent.");
  }
  const send = page.getByRole("button", { name: /^Send$/ });
  await send.click({ timeout: ACTION_TIMEOUT_MS });
  const confirmed = await readDom(page);
  const inThread = confirmed.threadMessages.some((item) => item.trim() === message.trim());
  if (!inThread || composerValue(confirmed) === message) {
    throw new SelectorError("The message click did not show a confirmed thread entry.");
  }
  return { sent: true };
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
  if (!current.profileExists || !message) return report;
  const messageButton = page.getByRole("button", { name: /^Message$/ });
  if ((await messageButton.count()) === 0) return report;
  await messageButton.click({ timeout: ACTION_TIMEOUT_MS });
  const opened = await readDom(page);
  const openedSignal = pageSignal(opened);
  if (openedSignal === "instagram_checkpoint" || openedSignal === "action_blocked" || openedSignal === "rate_limited" || openedSignal === "login_required") {
    throw new AttentionError(openedSignal, attentionMessage(openedSignal));
  }
  if (hasPriorConversation(opened, message)) {
    return { ...report, existingConversation: true, wouldSend: false };
  }
  if (!hasMessageComposer(opened)) return report;
  const box = page.getByRole("textbox", { name: /message/i });
  await box.fill(message, { timeout: ACTION_TIMEOUT_MS });
  const typed = await readDom(page);
  return {
    ...report,
    wouldSend: composerValue(typed) === message && current.relationship === "not_following",
  };
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
