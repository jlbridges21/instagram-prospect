import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { shouldSkipKnownProspect } from "../lib/prospects/discovery-check";
import { SelectorError } from "../worker/instagram/errors";
import {
  composerValue,
  feedCandidates,
  hasMessageComposer,
  hasPriorConversation,
  isAuthenticatedHome,
  isLoginScreen,
  pageSignal,
  profileFromDom,
} from "../worker/instagram/interpret";
import {
  cleanProfileBio,
  countFromLabeledText,
  displayNameFromTitle,
  parseFollowerCount,
  postUrlFromHref,
  profileUrlFor,
  controlRelationship,
  relationshipFromCandidates,
  relationshipFromLabels,
  usernameFromHref,
} from "../worker/instagram/parse";
import { READ_DOM_SOURCE } from "../worker/instagram/read-dom";
import { startupBlock } from "../worker/version";
import type { DomSnapshot, RelationshipCandidate } from "../worker/instagram/types";

const failures: string[] = [];

function check(name: string, condition: boolean) {
  if (!condition) failures.push(name);
  else console.log(`ok ${name}`);
}

function snapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    url: "https://www.instagram.com/",
    title: "Instagram",
    bodyText: "",
    links: [],
    buttons: [],
    images: [],
    textboxes: [],
    articles: [],
    hasPasswordField: false,
    threadMessages: [],
    bioText: null,
    ...overrides,
  };
}

check("12.4K followers", parseFollowerCount("12.4K followers") === 12400);
check("1.2M", parseFollowerCount("1.2M") === 1_200_000);
check("2.1M", parseFollowerCount("2.1m") === 2_100_000);
check("comma count", parseFollowerCount("1,234") === 1234);
check("plain count", parseFollowerCount("542") === 542);
check("unparseable is null", parseFollowerCount("lots") === null);
check("empty is null", parseFollowerCount("") === null);

check("username from profile href", usernameFromHref("/aerial.studio/") === "aerial.studio");
check("reserved explore is ignored", usernameFromHref("/explore/") === null);
check("post href is not a username", usernameFromHref("/p/abc123/") === null);
check("post url", postUrlFromHref("/p/AbC123/") === "https://www.instagram.com/p/AbC123/");
check("reel url", postUrlFromHref("https://www.instagram.com/reel/ZZ9/") === "https://www.instagram.com/reel/ZZ9/");
check("profile url", profileUrlFor("aerial.studio") === "https://www.instagram.com/aerial.studio/");

check("follow", relationshipFromLabels(["Follow", "Message"]) === "not_following");
check("following", relationshipFromLabels(["Following"]) === "following");
check("requested", relationshipFromLabels(["Requested"]) === "requested");
check("unknown relationship", relationshipFromLabels(["Share"]) === "unknown");
check(
  "401 startup message",
  startupBlock(401, "6") === "Worker API authentication failed. Verify that WORKER_API_SECRET matches the value configured in Vercel.",
);
check("version mismatch message", startupBlock(200, "7") === "Worker update required. Run git pull && npm install.");
check("compatible version", startupBlock(200, "6") === null);
check("follow back is not following", relationshipFromLabels(["Follow Back", "Message"]) === "not_following");
check("message with follow", relationshipFromLabels(["Message", "Follow"]) === "not_following");
check("message with following", relationshipFromLabels(["Message", "Following"]) === "following");
check("message alone is unknown", relationshipFromLabels(["Message"]) === "unknown");
check("conflicting follow controls are unknown", relationshipFromLabels(["Follow", "Following"]) === "unknown");
check("display name drops handle", displayNameFromTitle("Dominic Hayles (@dominicl_hayles) • Instagram", "dominicl_hayles") === "Dominic Hayles");
check("follower title attribute", countFromLabeledText(["12400 followers"], "followers") === 12400);
check("bio drops counts", cleanProfileBio(["Dominic Hayles", "12.4K followers", "Dallas drone photos"], "dominicl_hayles", "Dominic Hayles") === "Dallas drone photos");

const login = snapshot({
  url: "https://www.instagram.com/accounts/login/",
  hasPasswordField: true,
  buttons: [{ name: "Log in" }],
});
check("login screen", isLoginScreen(login) && pageSignal(login) === "login_required");

const home = snapshot({
  links: [{ href: "/direct/inbox/", text: "Messages" }],
  articles: [
    {
      text: "post",
      links: [
        { href: "/aerial.studio/", text: "aerial.studio" },
        { href: "/p/AbC123/", text: "" },
      ],
    },
  ],
});
check("authenticated home", isAuthenticatedHome(home));
const candidates = feedCandidates(home);
check("feed username", candidates[0]?.username === "aerial.studio");
check("feed post", candidates[0]?.postUrl === "https://www.instagram.com/p/AbC123/");

const missing = snapshot({
  url: "https://www.instagram.com/missing/",
  bodyText: "Sorry, this page isn't available.",
});
check("profile not found", pageSignal(missing) === "profile_not_found");

const challenge = snapshot({
  url: "https://www.instagram.com/challenge/123/",
  bodyText: "Confirm it's you",
});
check("checkpoint", pageSignal(challenge) === "instagram_checkpoint");

const blocked = snapshot({ bodyText: "Try again later. Action blocked." });
check("action blocked", pageSignal(blocked) === "action_blocked");

const profile = profileFromDom(
  snapshot({
    url: "https://www.instagram.com/aerial.studio/",
    title: "Aerial Studio (@aerial.studio) • Instagram",
    bioText: "Dallas drone photos",
    links: [
      { href: "/aerial.studio/followers/", text: "12.4K followers" },
      { href: "/aerial.studio/following/", text: "300 following" },
    ],
    buttons: [{ name: "Follow" }],
    images: [{ alt: "aerial.studio's profile picture", src: "https://example.com/pic.jpg" }],
  }),
  "aerial.studio",
);
check("profile username", profile.username === "aerial.studio");
check("profile followers", profile.followerCount === 12400);
check("profile following count", profile.followingCount === 300);
check("profile relationship", profile.relationship === "not_following");
check("profile bio", profile.bio === "Dallas drone photos");

const liveProfile = profileFromDom(
  snapshot({
    url: "https://www.instagram.com/dominicl_hayles/",
    title: "Dominic Hayles (@dominicl_hayles) • Instagram",
    headerButtons: [
      { name: "Following", text: "Following", label: "" },
      { name: "Message", text: "Message", label: "" },
    ],
    buttons: [{ name: "Follow", text: "Follow" }],
    headerLines: ["dominicl_hayles", "1,482 followers", "300 following", "Real estate media in Dallas"],
    links: [{ href: "/dominicl_hayles/followers/", text: "1,482 followers", title: "1482" }],
  }),
  "dominicl_hayles",
);
check("header following wins over page follow", liveProfile.relationship === "following");
check("live follower count", liveProfile.followerCount === 1482);
check("live display name", liveProfile.displayName === "Dominic Hayles");
check("live bio skips counts", liveProfile.bio === "Real estate media in Dallas");

function action(text: string, extras: Partial<RelationshipCandidate> = {}): RelationshipCandidate {
  return {
    tag: extras.tag ?? "div",
    role: extras.role ?? "button",
    text,
    ariaLabel: extras.ariaLabel ?? text,
    title: extras.title ?? "",
    href: extras.href ?? "",
    tabIndex: extras.tabIndex ?? "0",
    scope: extras.scope ?? "primary",
    besideOptions: extras.besideOptions ?? true,
  };
}

check("doubled following label", controlRelationship("FollowingFollowing") === "following");
check("count is not a relationship", controlRelationship("3,970 following") === null);
check("followed by is not a relationship", controlRelationship("Followed by user1 and user2") === null);
check("messages is not a relationship", controlRelationship("MessagesMessages") === null);

const followed = profileFromDom(
  snapshot({
    url: "https://www.instagram.com/studio.followed/",
    title: "FPV Team (@studio.followed) • Instagram",
    headerButtons: [{ name: "Options" }, { name: "more" }],
    buttons: [{ name: "Options" }, { name: "Messages" }],
    relationshipCandidates: [action("Following"), action("Messages", { ariaLabel: "Messages" })],
    links: [{ href: "/studio.followed/followers/", text: "3,860 followers", title: "3860" }],
  }),
  "studio.followed",
);
check("role button following", followed.relationship === "following");
check("role button strategy", followed.strategies.relationship === "primary-action-region-role-button");
check("followers survive relationship fix", followed.followerCount === 3860);
check("display name survives relationship fix", followed.displayName === "FPV Team");

const fresh = profileFromDom(
  snapshot({
    url: "https://www.instagram.com/studio.new/",
    title: "Matt Diamante (@studio.new) • Instagram",
    relationshipCandidates: [action("Follow"), action("Message", { ariaLabel: "Message" })],
    links: [{ href: "/studio.new/followers/", text: "398K followers", title: "398000" }],
  }),
  "studio.new",
);
check("role button follow", fresh.relationship === "not_following");
check("large follower count survives", fresh.followerCount === 398000);
check("display name survives", fresh.displayName === "Matt Diamante");

check(
  "native button follow",
  relationshipFromCandidates([action("Follow", { tag: "button", role: "button" })]).relationship === "not_following",
);
check(
  "native button following",
  relationshipFromCandidates([action("Following", { tag: "button", role: "button" })]).strategy === "primary-action-region-button",
);
check("role button requested", relationshipFromCandidates([action("Requested")]).relationship === "requested");
check("role button follow back", relationshipFromCandidates([action("Follow Back")]).relationship === "not_following");
check(
  "suggested follow is ignored",
  relationshipFromCandidates([
    action("Following"),
    action("Follow", { scope: "outside", besideOptions: false }),
  ]).relationship === "following",
);
check(
  "following count is ignored",
  relationshipFromCandidates([
    action("3,970 following", { tag: "a", role: "", href: "/studio.new/following/", ariaLabel: "3,970 following" }),
  ]).relationship === "unknown",
);
check(
  "followed-by text is ignored",
  relationshipFromCandidates([action("Followed by user1 and user2", { role: "", tag: "span" })]).relationship === "unknown",
);
check("message only is unknown", relationshipFromCandidates([action("Message")]).relationship === "unknown");
check("no relationship control is unknown", relationshipFromCandidates([]).relationship === "unknown");
check(
  "conflicting primary controls are unknown",
  relationshipFromCandidates([action("Follow"), action("Following")]).relationship === "unknown",
);
check("dom reader source parses", typeof new Function(`return (${READ_DOM_SOURCE})`) === "function");

const composer = snapshot({
  textboxes: [{ name: "Message", value: "Hi there" }],
  threadMessages: ["Hi there"],
});
check("composer detected", hasMessageComposer(composer));
check("composer value", composerValue(composer) === "Hi there");
check("no prior conversation when only the draft is present", hasPriorConversation(composer, "Hi there") === false);
const prior = snapshot({ threadMessages: ["Earlier hello", "Hi there"] });
check("prior conversation", hasPriorConversation(prior, "Hi there"));

try {
  throw new SelectorError("Could not determine follow relationship for @example");
} catch (error) {
  check(
    "selector error message",
    error instanceof SelectorError && error.message.includes("Could not determine follow relationship"),
  );
}

check(
  "skip contacted",
  shouldSkipKnownProspect({
    exists: true,
    status: "contacted",
    alreadyFollowing: false,
    alreadyContacted: true,
    discoveredAt: null,
    analyzed: true,
    cooldownDays: 30,
  }),
);
check(
  "keep fresh discovery",
  shouldSkipKnownProspect({
    exists: true,
    status: "discovered",
    alreadyFollowing: false,
    alreadyContacted: false,
    discoveredAt: new Date().toISOString(),
    analyzed: false,
    cooldownDays: 30,
  }) === false,
);
check(
  "unknown username is not skipped",
  shouldSkipKnownProspect({
    exists: false,
    status: null,
    alreadyFollowing: false,
    alreadyContacted: false,
    discoveredAt: null,
    analyzed: false,
    cooldownDays: 30,
  }) === false,
);

async function pendingRoundTrip() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-worker-"));
  process.env.WORKER_STATE_DIR = dir;
  const pending = await import("../worker/pending-results");
  pending.rememberPending({
    jobId: "job-1",
    workerId: "worker-1",
    kind: "complete",
    body: { result: { sent: true } },
    createdAt: new Date().toISOString(),
  });
  const stored = pending.readPending();
  check("pending result stored", stored.length === 1 && stored[0]?.jobId === "job-1");
  pending.forgetPending("job-1");
  check("pending result cleared", pending.readPending().length === 0);
  const identity = await import("../worker/identity");
  const first = identity.loadIdentity();
  const second = identity.loadIdentity();
  check("worker id persists", first.worker_id === second.worker_id && first.worker_id.length > 10);
}

async function fixturePage() {
  try {
    const { chromium } = await import("playwright");
    let browser;
    try {
      browser = await chromium.launch({ channel: "chrome", headless: true });
    } catch {
      browser = await chromium.launch({ headless: true });
    }
    const page = await browser.newPage();
    try {
      await page.setContent(`<!doctype html><html><head><title>Aerial Studio (@aerial.studio)</title></head>
        <body><article><a href="/aerial.studio/">aerial.studio</a><a href="/p/AbC123/">post</a></article></body></html>`);
      const { readDom } = await import("../worker/instagram/read-dom");
      const dom = await readDom(page);
      const found = feedCandidates({ ...dom, url: "https://www.instagram.com/" });
      check("fixture page username", found[0]?.username === "aerial.studio");
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.log(`skipped live DOM fixture: ${error instanceof Error ? error.message : "browser unavailable"}`);
  }
}

async function main() {
  await pendingRoundTrip();
  await fixturePage();
  if (failures.length > 0) {
    console.error(failures.map((name) => `failed ${name}`).join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log("instagram fixtures passed");
}

main();
