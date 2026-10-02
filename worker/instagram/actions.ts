import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { screenshotDir } from "../paths";
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
import { isExcludedRelationship, profileUrlFor, type FollowRelationship } from "./parse";
import { openUrl, readDom } from "./read-dom";

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

export async function readProfile(page: Page, username: string) {
  await openUrl(page, profileUrlFor(username));
  return inspectCurrent(page, username);
}

async function inspectCurrent(page: Page, username: string) {
  const dom = await readDom(page);
  const signal = pageSignal(dom);
  if (signal === "login_required" || signal === "instagram_checkpoint" || signal === "action_blocked" || signal === "rate_limited") {
    throw new AttentionError(signal, attentionMessage(signal));
  }
  if (signal === "profile_not_found") {
    return { profileExists: false as const, relationship: "unknown" as FollowRelationship, profile: profileFromDom(dom, username) };
  }
  return { profileExists: true as const, relationship: profileFromDom(dom, username).relationship, profile: profileFromDom(dom, username) };
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
