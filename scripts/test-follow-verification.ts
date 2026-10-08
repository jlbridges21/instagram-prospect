import assert from "node:assert/strict";
import { chromium } from "playwright";
import { currentDiscoveryDegraded, missedInspectionOpportunities, rollingMissedOpportunities } from "../lib/discovery/throughput";
import {
  advanceAfterFollow,
  confirmFollowAfterClick,
  FOLLOW_VERIFY_DELAYS_MS,
  followAttemptPlan,
  followVerificationFacts,
} from "../lib/outreach/follow-confirm";
import { claimPaceDecision, type PaceJob } from "../lib/outreach/pace";
import { profileFromDom } from "../worker/instagram/interpret";
import { READ_DOM_SOURCE } from "../worker/instagram/read-dom";
import { evidenceIsNew, mergeCandidateEvidence, type DiscoveryCandidate } from "../worker/discovery/queue";
import { seedEvidenceUsefulness, seedVisitAction } from "../worker/instagram/seed-page";
import { controlRelationship, relationshipFromLabels, selectPrimaryRelationship } from "../worker/instagram/parse";
import type { DomSnapshot, ExactRelationshipHit } from "../worker/instagram/types";

const now = new Date("2026-10-08T20:00:00.000Z");
const nameBox = { x: 420, y: 150, width: 180, height: 32 };

function placed(label: string, y: number, extras: Partial<ExactRelationshipHit> = {}): ExactRelationshipHit {
  return {
    label,
    tag: extras.tag ?? "span",
    role: extras.role ?? "",
    text: extras.text ?? label,
    ariaLabel: extras.ariaLabel ?? "",
    title: extras.title ?? "",
    href: extras.href ?? "",
    tabIndex: extras.tabIndex ?? "",
    box: extras.box ?? { x: 680, y, width: 80, height: 32 },
    inSuggestion: extras.inSuggestion ?? false,
    inDialog: extras.inDialog ?? false,
    otherUsername: extras.otherUsername ?? null,
    ancestor: extras.ancestor === undefined
      ? { tag: "div", role: "button", text: label, ariaLabel: "", href: "", box: { x: 670, y: y - 2, width: 100, height: 36 } }
      : extras.ancestor,
  };
}

function snapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    url: "https://www.instagram.com/greg.fabre/",
    title: "Greg (@greg.fabre)",
    bodyText: "",
    links: [],
    buttons: [],
    images: [],
    textboxes: [],
    articles: [],
    hasPasswordField: false,
    threadMessages: [],
    bioText: null,
    usernameBox: nameBox,
    ...overrides,
  };
}

function job(id: string, prospectId: string, status: string, extra: Partial<PaceJob> = {}): PaceJob {
  return {
    id,
    prospectId,
    username: prospectId,
    jobType: extra.jobType ?? "follow_profile",
    status,
    scheduledFor: now.toISOString(),
    availableAt: now.toISOString(),
    ...extra,
  };
}

const pace = {
  now,
  timeZone: "America/Chicago",
  minimumSpacingSeconds: 0,
  hourlyMaximum: 20,
  dailyMaximum: 150,
  completedSendTimes: [] as Date[],
};

async function main() {
async function poll(samples: string[]) {
  let clock = 0;
  let index = 0;
  let clicks = 0;
  const result = await confirmFollowAfterClick({
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    readRelationship: async () => samples[Math.min(index++, samples.length - 1)] ?? "unknown",
    refresh: async () => undefined,
    delaysMs: FOLLOW_VERIFY_DELAYS_MS,
    windowMs: 20_000,
  });
  return { result, clicks, clock };
}

const following = await poll(["not_following", "following"]);
assert.equal(following.result.confirmed, true);
assert.equal(following.result.relationship, "following");
assert.equal(following.clicks, 0);

const requested = await poll(["requested"]);
assert.equal(requested.result.confirmed, true);
assert.equal(requested.result.relationship, "requested");
assert.equal(requested.clicks, 0);

const unchanged = await poll(["not_following", "not_following", "not_following", "not_following", "not_following", "not_following"]);
assert.equal(unchanged.result.confirmed, false);
assert.equal(unchanged.result.relationship, "not_following");
assert.equal(unchanged.clicks, 0);
assert.equal(followAttemptPlan({ followClickAttempted: true, relationship: "not_following" }).click, false);

const delayed = await poll(["not_following", "not_following", "not_following", "following"]);
assert.equal(delayed.result.confirmed, true);
assert.equal(delayed.result.relationship, "following");
assert.ok(delayed.clock >= 4_000);
assert.ok(delayed.clock <= 7_000);

const headerCounts = selectPrimaryRelationship([
  placed("Following", 160, {
    ancestor: {
      tag: "div",
      role: "button",
      text: "greg.fabre 398K followers 3,200 following Following Message",
      ariaLabel: "",
      href: "",
      box: { x: 670, y: 148, width: 120, height: 36 },
    },
  }),
], nameBox);
assert.equal(headerCounts.relationship, "following");

const sharedAncestor = selectPrimaryRelationship([
  placed("Following", 160, {
    text: "Following",
    ancestor: {
      tag: "div",
      role: "button",
      text: "Following 398K followers",
      ariaLabel: "",
      href: "",
      box: { x: 670, y: 148, width: 220, height: 36 },
    },
  }),
], nameBox);
assert.equal(sharedAncestor.relationship, "following");
assert.equal(sharedAncestor.decisions[0]?.reason, "near profile header");

const countControl = selectPrimaryRelationship([
  placed("Following", 160, { text: "3,200 following", ariaLabel: "" }),
], nameBox);
assert.equal(countControl.relationship, "unknown");

assert.equal(controlRelationship("Followed by alice"), null);
assert.equal(relationshipFromLabels(["Followed by alice", "398K followers", "3,200 following"]), "unknown");

const fallback = profileFromDom(snapshot({
  exactRelationshipHits: [placed("Follow", 900, { inSuggestion: true })],
  headerButtons: [{ name: "Following", text: "Following" }],
}), "greg.fabre");
assert.equal(fallback.relationship, "following");
assert.equal(fallback.strategies.relationship, "exact header relationship button");

assert.deepEqual(followAttemptPlan({ followClickAttempted: true, relationship: "following" }), {
  click: false,
  action: "complete",
});
assert.deepEqual(followAttemptPlan({ followClickAttempted: true, relationship: "requested" }), {
  click: false,
  action: "complete",
});
assert.equal(followAttemptPlan({ followClickAttempted: false, relationship: "following" }).click, false);

const future = new Date(now.getTime() + 30 * 60_000).toISOString();
const waiting = job("greg", "greg", "retry_wait", {
  availableAt: future,
  result: { followClickAttempted: true, confirmation: "uncertain", nextVerificationAt: future },
});
const fresh = job("fresh", "fresh", "pending", { jobType: "follow_profile", result: {} });
assert.equal(claimPaceDecision({ ...pace, jobs: [waiting, fresh] }).prospectId, "fresh");
assert.notEqual(claimPaceDecision({ ...pace, jobs: [waiting, fresh] }).kind, "follow_verification");
assert.equal(claimPaceDecision({ ...pace, jobs: [waiting] }).action, "wait");
assert.equal(claimPaceDecision({ ...pace, jobs: [waiting] }).at?.toISOString(), future);

const failedEarly = job("early", "early", "failed", {
  availableAt: now.toISOString(),
  result: { followClickAttempted: true, confirmation: "uncertain", nextVerificationAt: future, startupVerified: false },
});
assert.equal(claimPaceDecision({ ...pace, jobs: [failedEarly] }).action, "wait");

const dueRetry = job("retry", "retry", "retry_wait", { jobType: "verify_profile" });
const dueFollow = job("due-follow", "due-follow", "retry_wait", {
  result: { followClickAttempted: true, confirmation: "uncertain" },
});
assert.equal(claimPaceDecision({ ...pace, jobs: [dueRetry, dueFollow] }).prospectId, "retry");
assert.equal(claimPaceDecision({ ...pace, jobs: [dueFollow] }).kind, "follow_verification");
assert.equal(claimPaceDecision({ ...pace, jobs: [dueFollow], deferFollowVerification: true }).action, "wait");
const reviewedFollow = job("reviewed", "reviewed", "failed", {
  result: { followClickAttempted: true, confirmation: "uncertain", startupVerified: true, verificationAttempts: 3 },
});
const freshApproved = job("fresh-approved", "fresh-approved", "pending", { jobType: "follow_profile" });
assert.equal(claimPaceDecision({ ...pace, jobs: [reviewedFollow, freshApproved] }).prospectId, "fresh-approved");
const unreadFollow = job("greg-follow", "greg.fabre", "failed", {
  jobType: "follow_profile",
  result: { followClickAttempted: true, confirmation: "uncertain", startupVerified: true, verificationAttempts: 3 },
});
const readyFollowJob = job("fresh-follow", "fresh.account", "pending", { jobType: "follow_profile", result: {} });
assert.equal(claimPaceDecision({ ...pace, jobs: [unreadFollow, readyFollowJob] }).prospectId, "fresh.account");
assert.notEqual(claimPaceDecision({ ...pace, jobs: [unreadFollow, readyFollowJob] }).kind, "follow_verification");
assert.equal(claimPaceDecision({ ...pace, jobs: [unreadFollow] }).kind, "follow_verification");
assert.equal(claimPaceDecision({ ...pace, jobs: [unreadFollow] }).prospectId, "greg.fabre");
assert.equal(followAttemptPlan({ followClickAttempted: true, relationship: "not_following" }).click, false);
const reconciled = job("greg-read", "greg.fabre", "failed", {
  jobType: "follow_profile",
  result: { followClickAttempted: true, startupVerified: true, reconciliationReadAt: now.toISOString() },
});
assert.notEqual(claimPaceDecision({ ...pace, jobs: [reconciled] }).kind, "follow_verification");
assert.notEqual(claimPaceDecision({ ...pace, jobs: [unreadFollow], deferFollowVerification: true }).kind, "follow_verification");
assert.notEqual(claimPaceDecision({ ...pace, jobs: [reviewedFollow, freshApproved] }).kind, "follow_verification");
assert.notEqual(claimPaceDecision({ ...pace, jobs: [fresh, dueFollow], deferFollowVerification: true }).kind, "follow_verification");

assert.equal(advanceAfterFollow({ followed: true, relationshipStatus: "following" }), "send");
assert.equal(advanceAfterFollow({ followed: true, relationshipStatus: "requested" }), "send");
assert.equal(advanceAfterFollow({ followed: false, confirmation: "uncertain", relationshipStatus: "not_following" }), "wait");

const facts = followVerificationFacts({
  status: "retry_wait",
  job_type: "follow_profile",
  result: {
    followClickAttempted: true,
    confirmation: "uncertain",
    evidence: { relationship: "unknown" },
    verificationAttempts: 1,
    nextVerificationAt: future,
  },
});
assert.equal(facts?.state, "Follow verification");
assert.equal(facts?.clickRecorded, true);
assert.equal(facts?.relationship, "unknown");
assert.equal(facts?.attempt, 1);

const started = now.getTime();
const staleNext = started - 191 * 72_000;
assert.equal(missedInspectionOpportunities(started, staleNext, 72_000), 191);
assert.equal(rollingMissedOpportunities({
  now: started,
  nextInspectionAt: staleNext,
  intervalMs: 72_000,
  sessionStartedAt: started,
}), 0);
assert.equal(currentDiscoveryDegraded({
  now: started,
  sessionStartedAt: started,
  nextInspectionAt: staleNext,
  intervalMs: 72_000,
  inspectionsSinceProgress: 0,
  running: true,
}), false);

const chromeHeader = profileFromDom(snapshot({
  url: "https://www.instagram.com/doneganphotography/",
  headerButtons: [{ name: "Home" }, { name: "Search" }],
  profileButtons: [{ name: "Following", text: "Following" }, { name: "Message", text: "Message" }],
  exactRelationshipHits: [],
  usernameBox: null,
}), "doneganphotography");
assert.equal(chromeHeader.relationship, "following");
assert.equal(chromeHeader.strategies.relationship, "exact header relationship button");

const requestedHeader = profileFromDom(snapshot({
  url: "https://www.instagram.com/pm_postproduction/",
  headerButtons: [{ name: "Home" }],
  profileButtons: [{ name: "Requested", text: "Requested" }, { name: "Message", text: "Message" }],
  exactRelationshipHits: [],
}), "pm_postproduction");
assert.equal(requestedHeader.relationship, "requested");
assert.equal(controlRelationship("Following ▾"), "following");
assert.equal(controlRelationship("3,200 following"), null);
assert.equal(controlRelationship("Followed by alice"), null);

let phase = "not_following";
let reads = 0;
const reloaded = await confirmFollowAfterClick({
  now: () => 0,
  sleep: async () => undefined,
  readRelationship: async () => {
    reads += 1;
    return phase;
  },
  refresh: async () => {
    phase = "following";
  },
  delaysMs: FOLLOW_VERIFY_DELAYS_MS,
  windowMs: 20_000,
});
assert.equal(reloaded.confirmed, true);
assert.equal(reloaded.relationship, "following");
assert.equal(reads, 5);

const existing: DiscoveryCandidate = {
  username: "studio.north",
  profileUrl: "https://www.instagram.com/studio.north/",
  source: "home_feed",
  sourcePostUrl: null,
  sourceThumbnailUrl: null,
  discoveredAt: "2026-10-08T00:00:00.000Z",
  sourceSeedUsername: "seed.one",
  seedSupport: ["seed.one"],
  priorityScore: 16,
};
const incoming: DiscoveryCandidate = {
  ...existing,
  source: "seed_network",
  sourceSeedUsername: "seed.two",
  seedSupport: ["seed.two"],
  priorityScore: 30,
};
assert.equal(evidenceIsNew(existing, incoming), true);
const mergedCandidate = mergeCandidateEvidence(existing, incoming);
assert.ok(mergedCandidate.seedSupport?.includes("seed.two"));
assert.equal(seedEvidenceUsefulness({
  beforeScore: 16,
  afterScore: 30,
  floor: 18,
  ceiling: 24,
  gainedSeed: true,
}), true);
assert.equal(seedVisitAction({ rankedAdded: 0, fallbackAdded: 0, usefulMerges: 1 }), "reset");
assert.equal(seedVisitAction({ rankedAdded: 0, fallbackAdded: 0, usefulMerges: 0 }), "cooldown");

const headerHtml = `<!doctype html><html><body>
<header><button>Home</button><button>Search</button></header>
<main style="position:relative;width:900px;height:900px">
  <h2 style="position:absolute;left:40px;top:40px;width:180px;height:28px;margin:0">greg.fabre</h2>
  <div role="button" style="position:absolute;left:40px;top:100px;width:420px;height:36px">398K followers <span style="display:inline-block;width:90px;height:28px">Following</span></div>
  <span id="rel">Following</span>
  <button aria-labelledby="rel" style="position:absolute;left:240px;top:100px;width:96px;height:32px"></button>
  <div style="position:absolute;left:40px;top:460px"><span style="display:block;height:20px">Suggested for you</span><button style="width:80px;height:32px">Follow</button></div>
</main>
</body></html>`;
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  const page = await browser.newPage();
  await page.route("https://www.instagram.com/greg.fabre/", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: headerHtml,
  }));
  await page.goto("https://www.instagram.com/greg.fabre/", { waitUntil: "domcontentloaded" });
  const read = new Function(`return (${READ_DOM_SOURCE})();`) as () => DomSnapshot;
  const first = await page.evaluate(read);
  await page.evaluate(() => {
    document.querySelectorAll("span").forEach((node) => {
      if ((node.textContent || "").trim() === "Following") node.textContent = "Requested";
    });
    const button = document.querySelector("button[aria-labelledby='rel']");
    if (button) button.textContent = "Requested";
  });
  const second = await page.evaluate(read);
  const profile = profileFromDom(first, "greg.fabre");
  assert.equal(profile.relationship, "following");
  assert.equal(profileFromDom(second, "greg.fabre").relationship, "requested");
  assert.notEqual(first, second);
  const suggested = (first.exactRelationshipHits ?? []).filter((hit) => hit.label === "Follow");
  assert.ok(suggested.length > 0, JSON.stringify(first.exactRelationshipHits));
  assert.ok(suggested.every((hit) => hit.inSuggestion), JSON.stringify(suggested));
  assert.ok((first.exactRelationshipHits ?? []).some((hit) => hit.labelledBy === "Following" || hit.ariaLabel === "Following"));
} finally {
  await browser.close();
}

console.log("follow verification tests passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
