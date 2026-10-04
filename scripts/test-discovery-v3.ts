import assert from "node:assert/strict";
import {
  DAILY_AI_CAP,
  DAILY_INSPECTION_CAP,
  PROSPECT_DELETE_TABLES,
  SESSION_INSPECTION_CAP,
  aiEvaluatedStorage,
  bulkSelection,
  continuousOutreachStep,
  deleteTouchesSharedConfig,
  discoveryProgressLabel,
  discoveryRestartAllowed,
  discoveryStopDecision,
  fillReviewDecision,
  livePollDelay,
  pageRefreshNeeded,
  preAiStorage,
  reviewTargetReached,
  singleOutreachMayContinue,
  suppressionActive,
} from "../lib/discovery/policy";

const base = {
  currentReview: 49,
  target: 50 as const,
  sessionInspections: 10,
  dailyInspections: 10,
  dailyAi: 10,
};

assert.equal(reviewTargetReached(49, 50), false);
assert.equal(discoveryStopDecision(base).pauseDiscovery, false);
assert.equal(discoveryStopDecision({ ...base, currentReview: 50 }).reason, "review_target_reached");
assert.equal(discoveryStopDecision({ ...base, currentReview: 52 }).pauseOutreach, false);
assert.equal(discoveryStopDecision({ ...base, currentReview: 52, target: "unlimited" }).pauseDiscovery, false);
assert.equal(discoveryRestartAllowed({ explicitStart: false, reviewFellBelowTarget: true }), false);
assert.equal(discoveryRestartAllowed({ explicitStart: true, reviewFellBelowTarget: true }), true);

assert.equal(fillReviewDecision(12, 50).start, true);
assert.equal(fillReviewDecision(55, 50).start, false);

assert.equal(preAiStorage({ relationship: "not_following", followers: 100, minFollowers: 500, maxFollowers: 250000 }).path, "suppression");
const followingSuppression = preAiStorage({ relationship: "following", followers: 1000, minFollowers: 500, maxFollowers: 250000 });
assert.equal(followingSuppression.path, "suppression");
if (followingSuppression.path === "suppression") assert.equal(followingSuppression.permanent, true);
assert.equal(preAiStorage({ relationship: "not_following", followers: 2000, minFollowers: 500, maxFollowers: 250000 }).path, "full_prospect");
assert.equal(aiEvaluatedStorage().path, "full_prospect");
assert.equal(suppressionActive({ permanent: false, expiresAt: "2020-01-01T00:00:00.000Z", now: new Date("2026-01-01T00:00:00.000Z") }), false);
assert.equal(suppressionActive({ permanent: true, expiresAt: null, now: new Date() }), true);

assert.equal(discoveryStopDecision({ ...base, dailyInspections: DAILY_INSPECTION_CAP }).reason, "daily_inspection_cap");
assert.equal(discoveryStopDecision({ ...base, dailyAi: DAILY_AI_CAP }).reason, "daily_ai_cap");
assert.equal(discoveryStopDecision({ ...base, sessionInspections: SESSION_INSPECTION_CAP }).reason, "inspection_session_cap");
assert.equal(discoveryStopDecision({ ...base, emptyCollectionCycles: 5 }).reason, "candidate_dry_spell");
assert.equal(discoveryStopDecision({ ...base, dailyInspections: 500 }).pauseOutreach, false);

assert.equal(pageRefreshNeeded(true), true);
assert.equal(pageRefreshNeeded(false), false);
assert.equal(livePollDelay(true), 4000);
assert.equal(livePollDelay(false), 30000);

assert.equal(bulkSelection({ pageIds: ["a"], filteredCount: 183, allFiltered: true }).count, 183);
assert.equal(deleteTouchesSharedConfig("settings"), true);
assert.equal(PROSPECT_DELETE_TABLES.includes("prospects"), true);
assert.equal(deleteTouchesSharedConfig("prospects"), false);

const now = new Date("2026-10-03T15:00:00.000Z");
assert.equal(continuousOutreachStep({ paused: false, checkpoint: false, jobReady: true, nextAt: null, now }).action, "run");
assert.equal(continuousOutreachStep({ paused: false, checkpoint: false, jobReady: true, nextAt: null, now: new Date("2026-10-03T07:00:00.000Z") }).action, "run");
assert.equal(continuousOutreachStep({ paused: false, checkpoint: false, jobReady: false, nextAt: new Date(now.getTime() + 222000).toISOString(), now }).action, "wait");
assert.equal(continuousOutreachStep({ paused: true, checkpoint: false, jobReady: true, nextAt: null, now }).action, "idle");
assert.equal(continuousOutreachStep({ paused: false, checkpoint: true, jobReady: true, nextAt: null, now }).action, "stop");
assert.equal(continuousOutreachStep({ paused: false, checkpoint: false, jobReady: false, nextAt: null, now }).reason, "no_queued_jobs");
assert.equal(singleOutreachMayContinue(0), true);
assert.equal(singleOutreachMayContinue(1), false);
assert.match(discoveryProgressLabel({ running: false, currentReview: 52, target: 50, reason: "review_target_reached" }), /paused automatically/);

console.log("discovery v3 policy tests passed");
