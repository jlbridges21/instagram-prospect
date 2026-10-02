import {
  cleanProfileBio,
  countFromLabeledText,
  displayNameFromTitle,
  postUrlFromHref,
  profileUrlFor,
  relationshipFromCandidates,
  relationshipFromLabels,
  selectPrimaryRelationship,
  usernameFromHref,
} from "./parse";
import type { DomButton, DomLink, DomSnapshot, FeedCandidate, PageSignal, ProfileExtract } from "./types";

export function pageSignal(dom: DomSnapshot): PageSignal {
  const url = dom.url.toLowerCase();
  const text = dom.bodyText.toLowerCase();
  if (url.includes("/challenge/") || url.includes("/accounts/suspended") || text.includes("confirm it's you")) {
    return "instagram_checkpoint";
  }
  if (text.includes("try again later") || text.includes("action blocked")) return "action_blocked";
  if (text.includes("please wait a few minutes")) return "rate_limited";
  if (text.includes("sorry, this page isn't available")) return "profile_not_found";
  if (isLoginScreen(dom)) return "login_required";
  return null;
}

export function isLoginScreen(dom: DomSnapshot) {
  if (dom.hasPasswordField) return true;
  const hasLoginButton = dom.buttons.some((button) => /^log in$/i.test(button.name));
  const hasHome = dom.links.some((link) => /instagram\.com\/?$/.test(link.href) || link.href === "/");
  return hasLoginButton && !hasHome && dom.url.includes("/accounts/login");
}

export function isAuthenticatedHome(dom: DomSnapshot) {
  if (pageSignal(dom) === "login_required" || pageSignal(dom) === "instagram_checkpoint") return false;
  const onInstagram = dom.url.includes("instagram.com");
  const hasFeed = dom.articles.length > 0 || dom.links.some((link) => /\/direct\//.test(link.href));
  return onInstagram && hasFeed && !dom.hasPasswordField;
}

export function feedCandidates(dom: DomSnapshot): FeedCandidate[] {
  const found: FeedCandidate[] = [];
  const seen = new Set<string>();
  for (const article of dom.articles) {
    let username: string | null = null;
    let postUrl: string | null = null;
    for (const link of article.links) {
      username ??= usernameFromHref(link.href) ?? usernameFromHref(link.text.startsWith("@") ? `/${link.text.slice(1)}/` : "");
      postUrl ??= postUrlFromHref(link.href);
    }
    if (!username || seen.has(username)) continue;
    seen.add(username);
    found.push({ username, profileUrl: profileUrlFor(username), postUrl });
  }
  return found;
}

export function profileFromDom(dom: DomSnapshot, expectedUsername: string | null): ProfileExtract {
  return extractInstagramProfile(dom, expectedUsername);
}

export function extractInstagramProfile(dom: DomSnapshot, expectedUsername: string | null): ProfileExtract {
  let pathName = "";
  try {
    pathName = new URL(dom.url).pathname;
  } catch {
    pathName = "";
  }
  const username = usernameFromHref(pathName) ?? (expectedUsername ? expectedUsername.toLowerCase() : null);
  const strategies: Record<string, string> = {};
  const followers = followerCount(dom, strategies);
  const following = followingCount(dom, strategies);
  const fromHits = dom.exactRelationshipHits
    ? selectPrimaryRelationship(dom.exactRelationshipHits, dom.usernameBox, dom.optionsBox)
    : null;
  const fromRegion = !fromHits && dom.relationshipCandidates
    ? relationshipFromCandidates(dom.relationshipCandidates)
    : null;
  const relationshipButtons = (dom.headerButtons?.length ? dom.headerButtons : dom.buttons).flatMap(buttonNames);
  const relationship = fromHits
    ? fromHits.relationship
    : fromRegion
      ? fromRegion.relationship
      : relationshipFromLabels(relationshipButtons);
  strategies.relationship = fromHits
    ? fromHits.strategy
    : fromRegion
      ? fromRegion.strategy
      : dom.headerButtons?.length
        ? "header-button"
        : relationship === "unknown"
          ? "none"
          : "page-button";
  const displayName = chooseDisplayName(dom, username, strategies);
  const bio = chooseBio(dom, username, displayName, strategies);
  const picture = dom.images.find((image) => /profile picture/i.test(image.alt));
  if (picture?.src) strategies.profilePicture = "img-alt";
  const location = locationText(dom);
  if (location) strategies.location = "explicit-text";
  return {
    username,
    displayName,
    bio,
    followerCount: followers,
    followingCount: following,
    profilePictureUrl: picture?.src || null,
    relationship,
    locationText: location,
    profileIsPrivate: Boolean(dom.profileIsPrivate) || /this account is private/i.test(dom.bodyText),
    strategies,
  };
}

function buttonNames(button: DomButton) {
  return [button.text, button.label, button.name].filter((value): value is string => Boolean(value));
}

function linkTexts(link: DomLink) {
  return [link.title, link.label, link.text].filter((value): value is string => Boolean(value));
}

function followerCount(dom: DomSnapshot, strategies: Record<string, string>) {
  const followerLinks = dom.links.filter((link) => /\/followers\/?$/i.test(link.href) || linkTexts(link).some((text) => /follower/i.test(text)));
  const fromLink = countFromLabeledText(followerLinks.flatMap(linkTexts), "followers");
  if (fromLink !== null) {
    strategies.followers = followerLinks.some((link) => link.title || link.label) ? "header-link-label" : "header-link-text";
    return fromLink;
  }
  const fromButton = countFromLabeledText(dom.buttons.flatMap(buttonNames), "followers");
  if (fromButton !== null) {
    strategies.followers = "button-label";
    return fromButton;
  }
  const fromHeader = countFromLabeledText(dom.headerLines ?? [], "followers");
  if (fromHeader !== null) {
    strategies.followers = "header-text";
    return fromHeader;
  }
  const fromMeta = countFromLabeledText([dom.metaDescription], "followers");
  if (fromMeta !== null) {
    strategies.followers = "meta-description";
    return fromMeta;
  }
  strategies.followers = "unavailable";
  return null;
}

function followingCount(dom: DomSnapshot, strategies: Record<string, string>) {
  const links = dom.links.filter((link) => /\/following\/?$/i.test(link.href) || linkTexts(link).some((text) => /following/i.test(text) && !/follower/i.test(text)));
  const count = countFromLabeledText(
    [...links.flatMap(linkTexts), ...(dom.headerLines ?? []), dom.metaDescription],
    "following",
  );
  strategies.following = count === null ? "unavailable" : "labeled-text";
  return count;
}

function chooseDisplayName(dom: DomSnapshot, username: string | null, strategies: Record<string, string>) {
  const fromTitle = displayNameFromTitle(dom.title, username);
  if (fromTitle) {
    strategies.displayName = "document-title";
    return fromTitle;
  }
  const line = (dom.headerLines ?? []).find((item) => {
    const text = item.trim();
    if (!text || text.length > 80) return false;
    if (username && text.toLowerCase() === username) return false;
    if (/follower|following|posts|follow|message/i.test(text)) return false;
    return /[A-Za-z]/.test(text);
  });
  if (line) {
    strategies.displayName = "header-line";
    return line.trim();
  }
  strategies.displayName = "unavailable";
  return null;
}

function chooseBio(dom: DomSnapshot, username: string | null, displayName: string | null, strategies: Record<string, string>) {
  const lines = dom.headerLines ?? [];
  const cleaned = cleanProfileBio(lines, username, displayName);
  if (cleaned) {
    strategies.bio = "profile-header-lines";
    return cleaned;
  }
  if (dom.bioText) {
    const explicit = cleanProfileBio(dom.bioText.split("\n"), username, displayName);
    if (explicit) {
      strategies.bio = "bio-node";
      return explicit;
    }
  }
  const meta = bioFromMeta(dom.metaDescription, username);
  if (meta) {
    strategies.bio = "meta-description";
    return meta;
  }
  strategies.bio = "unavailable";
  return null;
}

function bioFromMeta(meta: string | null | undefined, username: string | null) {
  if (!meta) return null;
  const parts = meta.split(" - ").map((part) => part.trim()).filter(Boolean);
  const tail = parts.length > 1 ? parts.slice(1).join(" - ") : "";
  if (!tail || /see instagram photos/i.test(tail)) return null;
  return cleanProfileBio([tail], username, null);
}

function locationText(dom: DomSnapshot) {
  const line = (dom.headerLines ?? []).find((item) => /^(located in|based in|location:)\s+/i.test(item));
  return line?.replace(/^(located in|based in|location:)\s+/i, "").trim() || null;
}

export function hasMessageComposer(dom: DomSnapshot) {
  return dom.textboxes.some((box) => /message/i.test(box.name));
}

export function composerValue(dom: DomSnapshot) {
  return dom.textboxes.find((box) => /message/i.test(box.name))?.value ?? "";
}

export function hasPriorConversation(dom: DomSnapshot, outgoing: string) {
  const normalizedOutgoing = outgoing.trim();
  return dom.threadMessages.some((message) => message.trim() && message.trim() !== normalizedOutgoing);
}

export function messagingUnavailable(dom: DomSnapshot) {
  const text = dom.bodyText.toLowerCase();
  return text.includes("can't message") || text.includes("cannot message") || text.includes("not everyone can message");
}

