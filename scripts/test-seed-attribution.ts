import assert from "node:assert/strict";
import fs from "node:fs";
import { recordInspection, syncStatus, type SeedCounters } from "../lib/discovery/seed-counts";
import { inspectionSeedId, prospectAttribution, seedCollectionResult, seedStatForCandidate } from "../lib/discovery/seeds";
import { CandidateQueue, type DiscoveryCandidate } from "../worker/discovery/queue";

const empty = (): SeedCounters => ({ inspected: 0, review: 0, approved: 0, contacted: 0 });

const fromSeed = seedCollectionResult({
  seedId: "seed-a",
  seedUsername: "perspective.tx",
  usernames: ["perspective.tx", "candidatex", "@CandidateX"],
});
assert.equal(fromSeed.fallback, false);
assert.equal(fromSeed.candidates.length, 1);
assert.equal(fromSeed.candidates[0]?.source, "seed_suggestion");
assert.equal(fromSeed.candidates[0]?.sourceSeedId, "seed-a");
assert.equal(fromSeed.candidates[0]?.sourceSeedUsername, "perspective.tx");

const none = seedCollectionResult({ seedId: "seed-a", seedUsername: "perspective.tx", usernames: ["perspective.tx"] });
assert.equal(none.fallback, true);
assert.equal(none.candidates.length, 0);

const queued = candidate({
  username: "candidatex",
  source: "seed_suggestion",
  sourceSeedId: "seed-a",
  sourceSeedUsername: "perspective.tx",
});
const queue = new CandidateQueue(10);
assert.equal(queue.enqueue(queued), "queued");
const restored = new CandidateQueue(10);
const saved = JSON.parse(JSON.stringify({ pending: queue.pendingCandidates() })) as { pending: DiscoveryCandidate[] };
for (const item of saved.pending) restored.enqueue(item);
const currentSeedAtInspection = "seed-b";
const claimed = restored.claim("profile-tab-1");
assert.ok(claimed);
assert.equal(inspectionSeedId(claimed), "seed-a");
assert.notEqual(inspectionSeedId(claimed), currentSeedAtInspection);

const stored = prospectAttribution(claimed);
assert.equal(stored.source, "seed_suggestion");
assert.equal(stored.source_seed_id, "seed-a");
assert.equal(stored.source_seed_username, "perspective.tx");

const generic = candidate({ username: "homeuser", source: "suggested_accounts" });
assert.equal(inspectionSeedId(generic), null);
assert.equal(prospectAttribution(generic).source_seed_id, null);
assert.equal(seedStatForCandidate("duplicate_skipped").inspected, 0);

const inspected = recordInspection(empty(), new Set());
assert.equal(inspected.applied, true);
const disqualified = syncStatus(inspected.counters, inspected.recorded, "disqualified");
assert.equal(disqualified.counters.inspected, 1);
assert.equal(disqualified.counters.review, 0);

const reviewed = syncStatus(inspected.counters, inspected.recorded, "review");
assert.equal(reviewed.counters.review, 1);
const reviewedAgain = syncStatus(reviewed.counters, reviewed.recorded, "review");
assert.equal(reviewedAgain.counters.review, 1);

const approved = syncStatus(reviewed.counters, reviewed.recorded, "approved");
assert.equal(approved.counters.approved, 1);
assert.equal(approved.counters.review, 1);
const approvedAgain = syncStatus(approved.counters, approved.recorded, "approved");
assert.equal(approvedAgain.counters.approved, 1);

const contacted = syncStatus(approved.counters, approved.recorded, "contacted");
assert.equal(contacted.counters.contacted, 1);
const contactedAgain = syncStatus(contacted.counters, contacted.recorded, "contacted");
assert.equal(contactedAgain.counters.contacted, 1);

const config = fs.readFileSync(new URL("../app/api/worker/config/route.ts", import.meta.url), "utf8");
const panel = fs.readFileSync(new URL("../components/settings/discovery-seeds-panel.tsx", import.meta.url), "utf8");
assert.match(config, /inspected: seed\.profiles_inspected/);
assert.match(config, /review: seed\.profiles_reaching_review/);
assert.match(panel, /profiles_inspected/);
assert.match(panel, /profiles_reaching_review/);

const collector = fs.readFileSync(new URL("../worker/discovery/v2.ts", import.meta.url), "utf8");
assert.match(collector, /Falling back to Suggested Accounts/);
assert.match(collector, /inspectionSeedId\(candidate\)/);
assert.doesNotMatch(collector, /currentSeed/);

console.log("seed attribution tests passed");

function candidate(input: Pick<DiscoveryCandidate, "username" | "source"> & Partial<DiscoveryCandidate>): DiscoveryCandidate {
  return {
    username: input.username,
    profileUrl: `https://www.instagram.com/${input.username}/`,
    source: input.source,
    sourcePostUrl: null,
    sourceThumbnailUrl: null,
    discoveredAt: "2026-10-05T00:00:00.000Z",
    sourceSeedId: input.sourceSeedId ?? null,
    sourceSeedUsername: input.sourceSeedUsername ?? null,
  };
}
