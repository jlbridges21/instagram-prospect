import assert from "node:assert/strict";
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
assert.ok(reads > 1);

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

console.log("follow verification tests passed");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
