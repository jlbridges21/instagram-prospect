import { parseFollowerCount, postUrlFromHref, profileUrlFor, relationshipFromLabels, usernameFromHref } from "./parse";
import type { DomSnapshot, FeedCandidate, PageSignal, ProfileExtract } from "./types";

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
  let pathName = "";
  try {
    pathName = new URL(dom.url).pathname;
  } catch {
    pathName = "";
  }
  const username = usernameFromHref(pathName) ?? expectedUsername;
  const followerLink = dom.links.find((link) => /follower/i.test(link.text));
  const followingLink = dom.links.find((link) => /following/i.test(link.text) && !/follower/i.test(link.text));
  const picture = dom.images.find((image) => /profile picture/i.test(image.alt));
  const displayName = dom.title.replace(/\s*[•|].*$/, "").replace(/^\(@[^)]+\)\s*/, "").trim() || null;
  return {
    username,
    displayName: displayName && displayName.toLowerCase() !== "instagram" ? displayName : null,
    bio: dom.bioText?.trim() || null,
    followerCount: parseFollowerCount(followerLink?.text ?? null),
    followingCount: parseFollowerCount(followingLink?.text ?? null),
    profilePictureUrl: picture?.src || null,
    relationship: relationshipFromLabels(dom.buttons.map((button) => button.name)),
  };
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

