import assert from "node:assert/strict";
import fs from "node:fs";
import { recordInspection, syncStatus, type SeedCounters } from "../lib/discovery/seed-counts";
import {
  approvalSeedMessage,
  missingSeedFields,
  seedPromotionDecision,
  type ExistingSeedSnapshot,
  type ProspectSeedSource,
} from "../lib/discovery/promotion-rules";
import { shouldAutoPromote } from "../lib/discovery/seeds";

const automatic = {
  enabled: true,
  qualified: true,
  minScore: 75,
  promoteStrong: true,
  promotePossible: false,
  requiresApproved: false,
  approved: false,
  disqualified: false,
  alreadyFollowing: false,
};

assert.equal(shouldAutoPromote({ ...automatic, fitScore: 82, fitLabel: "strong_fit" }), true);
assert.equal(shouldAutoPromote({ ...automatic, fitScore: 68, fitLabel: "possible_fit" }), false);
assert.equal(shouldAutoPromote({ ...automatic, fitScore: 30, fitLabel: "skip" }), false);

const prospect: ProspectSeedSource = {
  id: "prospect-1",
  displayName: "Photo Sphere",
  profileUrl: "https://www.instagram.com/photosphere_media/",
  profilePictureUrl: "https://cdn.example/photo.jpg",
  category: "aerial",
};

const filled: ExistingSeedSnapshot = {
  isActive: true,
  displayName: "Kept name",
  profileUrl: "https://www.instagram.com/photosphere_media/",
  profilePictureUrl: "https://cdn.example/kept.jpg",
  prospectId: "original-prospect",
  category: "kept",
};

function decide(input: {
  mode: "automatic" | "approved";
  automatic?: boolean;
  username?: string;
  alreadyFollowing?: boolean;
  removed?: boolean;
  existing?: ExistingSeedSnapshot | null;
}) {
  return seedPromotionDecision({
    mode: input.mode,
    automatic: input.automatic ?? false,
    username: input.username ?? "photosphere_media",
    alreadyFollowing: input.alreadyFollowing ?? false,
    removed: input.removed ?? false,
    existing: input.existing === undefined ? null : input.existing,
    prospect,
  });
}

const strong = decide({ mode: "automatic", automatic: shouldAutoPromote({ ...automatic, fitScore: 82, fitLabel: "strong_fit" }) });
assert.equal(strong.outcome, "created");
if (strong.outcome === "created") {
  assert.equal(strong.row.instagram_username, "photosphere_media");
  assert.equal(strong.row.display_name, "Photo Sphere");
  assert.equal(strong.row.profile_picture_url, "https://cdn.example/photo.jpg");
  assert.equal(strong.row.auto_promoted_from_prospect_id, "prospect-1");
  assert.equal(strong.row.source_type, "auto_promoted");
  assert.equal(strong.row.is_active, true);
  assert.equal("source_seed_id" in strong.row, false);
  assert.equal("profiles_inspected" in strong.row, false);
  assert.equal("profiles_reaching_review" in strong.row, false);
  assert.equal("notes" in strong.row, false);
  assert.equal("priority" in strong.row, true);
}

assert.equal(decide({ mode: "automatic", automatic: shouldAutoPromote({ ...automatic, fitScore: 68, fitLabel: "possible_fit" }) }).outcome, "skipped");
assert.equal(decide({ mode: "approved" }).outcome, "created");
assert.equal(decide({ mode: "approved", automatic: false }).outcome, "created");

const kept = decide({ mode: "approved", existing: filled });
assert.equal(kept.outcome, "existing");
if (kept.outcome === "existing") {
  assert.deepEqual(kept.patch, {});
  assert.equal("notes" in kept.patch, false);
  assert.equal("priority" in kept.patch, false);
  assert.equal("is_active" in kept.patch, false);
  assert.equal("profiles_inspected" in kept.patch, false);
  assert.equal("profiles_reaching_review" in kept.patch, false);
  assert.equal("profiles_approved" in kept.patch, false);
  assert.equal("profiles_contacted" in kept.patch, false);
}

const blank: ExistingSeedSnapshot = {
  isActive: true,
  displayName: null,
  profileUrl: null,
  profilePictureUrl: null,
  prospectId: null,
  category: null,
};
const filledPatch = missingSeedFields(blank, prospect);
assert.equal(filledPatch.display_name, "Photo Sphere");
assert.equal(filledPatch.profile_picture_url, "https://cdn.example/photo.jpg");
assert.equal(filledPatch.auto_promoted_from_prospect_id, "prospect-1");
assert.equal("notes" in filledPatch, false);
assert.equal("profiles_inspected" in filledPatch, false);

const disabled = decide({ mode: "approved", existing: { ...filled, isActive: false } });
assert.equal(disabled.outcome, "disabled");
if (disabled.outcome === "disabled") assert.equal("is_active" in disabled.patch, false);

assert.equal(decide({ mode: "approved", removed: true }).outcome, "removed");
assert.equal(decide({ mode: "automatic", automatic: true, removed: true }).outcome, "removed");
assert.equal(decide({ mode: "approved", alreadyFollowing: true }).outcome, "ineligible");
assert.equal(decide({ mode: "approved", username: "" }).outcome, "ineligible");

const origin = { sourceSeedId: "seed-a", sourceSeedUsername: "itselijones" };
const promoted = decide({ mode: "approved" });
assert.equal(origin.sourceSeedId, "seed-a");
assert.equal(origin.sourceSeedUsername, "itselijones");
assert.equal(promoted.outcome, "created");

assert.equal(approvalSeedMessage(["created"]), "Approved · Added as Discovery Seed");
assert.equal(approvalSeedMessage(["existing"]), "Approved · Already a Discovery Seed");
assert.equal(approvalSeedMessage(["disabled"]), "Approved · Discovery Seed stays disabled");
assert.equal(approvalSeedMessage(["removed"]), "Approved · Discovery Seed stays removed");

const zero: SeedCounters = { inspected: 1, review: 0, approved: 0, contacted: 0 };
const recorded = new Set<"inspected" | "review" | "approved" | "contacted">(["inspected"]);
const firstReview = syncStatus(zero, recorded, "review");
assert.equal(firstReview.counters.inspected, 1);
assert.equal(firstReview.counters.review, 1);
const secondReview = syncStatus(firstReview.counters, firstReview.recorded, "review");
assert.equal(secondReview.counters.review, 1);
assert.equal(secondReview.counters.inspected, 1);
const inspectedAgain = recordInspection(secondReview.counters, secondReview.recorded);
assert.equal(inspectedAgain.applied, false);
assert.equal(inspectedAgain.counters.inspected, 1);

const approvedOnce = syncStatus(firstReview.counters, firstReview.recorded, "approved");
assert.equal(approvedOnce.counters.review, 1);
assert.equal(approvedOnce.counters.approved, 1);
const approvedTwice = syncStatus(approvedOnce.counters, approvedOnce.recorded, "approved");
assert.equal(approvedTwice.counters.approved, 1);
assert.equal(approvedTwice.counters.review, 1);

const migration = fs.readFileSync("supabase/migrations/20261012120000_seed_promotion.sql", "utf8");
assert.match(migration, /discovery_seed_removals/);
assert.match(migration, /returns table \(profiles_inspected integer, profiles_reaching_review integer\)/);
assert.match(migration, /unique_violation/);
assert.match(migration, /source_seed_id/);
assert.doesNotMatch(migration, /profiles_reaching_review \+ 1/);

console.log("seed promotion tests passed");
