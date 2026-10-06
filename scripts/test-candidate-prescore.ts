import assert from "node:assert/strict";
import { inspectionIntervalMs } from "../lib/discovery/cadence";
import { scoreCandidate, shouldExploreCandidate } from "../lib/discovery/candidate-priority";
import {
  DEFAULT_NEGATIVE_KEYWORDS,
  DEFAULT_POSITIVE_KEYWORDS,
  LEGACY_POSITIVE_KEYWORDS,
  candidateExplorationPercent,
  effectiveKeywordList,
} from "../lib/discovery/defaults";
import { summarizeFunnel, summarizePreScoreBands, summarizeSourceYield } from "../lib/discovery/quality";
import {
  CandidateQueue,
  evidenceIsNew,
  mergeCandidateEvidence,
  type DiscoveryCandidate,
} from "../worker/discovery/queue";

const keywords = {
  positiveKeywords: [...DEFAULT_POSITIVE_KEYWORDS],
  negativeKeywords: [...DEFAULT_NEGATIVE_KEYWORDS],
};

const professional = scoreCandidate({
  source: "seed",
  sourceDetail: "seed_network",
  seedUsername: "coastal",
  username: "coastaldrone_media",
  cardText: "Aerial photography",
  seedSupportCount: 1,
  ...keywords,
});
const brand = scoreCandidate({
  source: "suggested_accounts",
  username: "nasaadmin",
  cardText: "NASA",
  ...keywords,
});
const ads = scoreCandidate({
  source: "suggested_accounts",
  username: "ads",
  ...keywords,
});
const hobby = scoreCandidate({
  source: "seed",
  seedUsername: "hobby",
  username: "fpvhobby",
  cardText: "FPV freestyle racing hobby",
  seedSupportCount: 1,
  ...keywords,
});
const commercial = scoreCandidate({
  source: "seed",
  seedUsername: "films",
  username: "coastalfpv",
  cardText: "Commercial FPV cinematography for real estate production",
  seedSupportCount: 1,
  ...keywords,
});

assert.ok(professional.score >= 40, `professional score ${professional.score}`);
assert.equal(professional.label, "Medium");
assert.equal(brand.label, "Low");
assert.equal(ads.label, "Low");
assert.ok(professional.reasons.some((reason) => reason.includes("+ seed network")));
assert.ok(brand.score <= 15, `brand score ${brand.score}`);
assert.ok(ads.score <= 15, `ads score ${ads.score}`);
assert.ok(professional.score > brand.score);
assert.ok(hobby.score < commercial.score, `hobby ${hobby.score} commercial ${commercial.score}`);
assert.ok(commercial.reasons.some((reason) => reason.startsWith("+ ")));
assert.ok(hobby.reasons.some((reason) => reason.startsWith("- ")));

const oneSeed = scoreCandidate({
  source: "seed",
  seedUsername: "a",
  username: "drone_media",
  seedSupportCount: 1,
  seedMature: true,
  seedYield: 0.1,
  ...keywords,
});
const threeSeeds = scoreCandidate({
  source: "seed",
  seedUsername: "a",
  username: "drone_media",
  seedSupportCount: 3,
  seedMature: true,
  seedYield: 0.1,
  ...keywords,
});
assert.equal(threeSeeds.score - oneSeed.score, 24);
assert.ok(threeSeeds.reasons.some((reason) => reason.includes("3 seed matches")));

const immature = scoreCandidate({
  source: "seed",
  seedUsername: "newseed",
  username: "drone_media",
  seedMature: false,
  seedYield: 1,
  seedSupportCount: 1,
  ...keywords,
});
const poor = scoreCandidate({
  source: "seed",
  seedUsername: "poorseed",
  username: "drone_media",
  seedMature: true,
  seedYield: 0.05,
  seedSupportCount: 1,
  ...keywords,
});
const rich = scoreCandidate({
  source: "seed",
  seedUsername: "richseed",
  username: "drone_media",
  seedMature: true,
  seedYield: 0.35,
  seedSupportCount: 1,
  ...keywords,
});
assert.equal(immature.score, poor.score);
assert.equal(rich.score - poor.score, 16);
assert.ok(rich.reasons.some((reason) => reason.includes("@richseed")));

const home = base("example", "home_feed", 12);
const seeded = base("example", "seed_network", 40, { sourceSeedId: "seed-a", sourceSeedUsername: "seeda", cardText: "drone media company" });
const merged = mergeCandidateEvidence(home, seeded);
assert.equal(merged.source, "seed_network");
assert.deepEqual(merged.sourcesSeen, ["home_feed", "seed_network"]);
assert.deepEqual(merged.seedSupport, ["seeda"]);
assert.equal(evidenceIsNew(home, seeded), true);
assert.equal(evidenceIsNew(merged, seeded), false);
const second = mergeCandidateEvidence(merged, base("example", "seed_suggestion", 40, { sourceSeedId: "seed-b", sourceSeedUsername: "seedb" }));
assert.equal(second.source, "seed_network");
assert.deepEqual(second.seedSupport, ["seeda", "seedb"]);
assert.equal(second.sourceSeedUsername, "seeda");

const queue = new CandidateQueue(10);
assert.equal(queue.place({ ...home, priorityScore: 12 }, 35), "deferred");
assert.equal(queue.place({ ...base("realestatevisuals", "seed_network", 91, { sourceSeedUsername: "seeda" }), priorityScore: 91 }, 35), "queued");
assert.equal(queue.pendingCount(), 1);
assert.equal(queue.claim("profile-tab-1", { floor: 35, explore: false })?.username, "realestatevisuals");

const later = new CandidateQueue(10);
later.place(base("randomperson", "home_feed", 18), 0);
later.place(base("realestatevisuals", "seed_network", 91), 0);
assert.equal(later.claim("profile-tab-1")?.username, "realestatevisuals");

const closed = new CandidateQueue(10);
closed.place(base("weak", "home_feed", 12), 35);
assert.equal(closed.claim("profile-tab-1", { floor: 35, explore: false }), null);
assert.equal(closed.deferredCount(), 1);
assert.equal(closed.claim("profile-tab-1", { floor: 35, explore: true })?.username, "weak");

const mixed = new CandidateQueue(10);
mixed.place(base("weak", "home_feed", 12), 35);
mixed.place(base("strong", "seed_network", 80), 35);
assert.equal(mixed.claim("profile-tab-1", { floor: 35, explore: true })?.username, "weak");

assert.equal(candidateExplorationPercent("conservative"), 10);
assert.equal(candidateExplorationPercent("balanced"), 20);
assert.equal(candidateExplorationPercent("exploratory"), 35);
assert.equal(shouldExploreCandidate("balanced", 0.19), true);
assert.equal(shouldExploreCandidate("balanced", 0.2), false);
assert.equal(shouldExploreCandidate("conservative", 0.09), true);
assert.equal(shouldExploreCandidate("exploratory", 0.34), true);

const funnel = summarizeFunnel({ collected: 320, deferred: 224, opened: 96, review: 14 });
assert.equal(funnel.reviewPerOpened, 14 / 96);
assert.equal(funnel.reviewPerCollected, 14 / 320);
const bands = summarizePreScoreBands([
  { score: 10, review: false },
  { score: 12, review: true },
  { score: 40, review: false },
  { score: 90, review: true },
  { score: 95, review: true },
]);
assert.equal(bands[0]?.inspected, 2);
assert.equal(bands[0]?.review, 1);
assert.equal(bands[0]?.reviewYield, 0.5);
assert.equal(bands[1]?.inspected, 1);
assert.equal(bands[1]?.review, 0);
assert.equal(bands[4]?.inspected, 2);
assert.equal(bands[4]?.review, 2);
assert.equal(bands[4]?.reviewYield, 1);
const sources = summarizeSourceYield(
  [
    { source: "seed_network", review: true },
    { source: "seed_network", review: true },
    { source: "seed_network", review: false },
    { source: "suggested_accounts", review: false },
    { source: "home_feed", review: true },
  ],
  [
    { source: "seed_network", label: "Seed network" },
    { source: "suggested_accounts", label: "Suggested Accounts" },
    { source: "home_feed", label: "Home Feed" },
  ],
);
assert.equal(sources[0]?.inspected, 3);
assert.equal(sources[0]?.review, 2);
assert.equal(sources[0]?.reviewYield, 2 / 3);
assert.equal(sources[1]?.inspected, 1);
assert.equal(sources[1]?.review, 0);
assert.equal(sources[2]?.reviewYield, 1);

assert.equal(inspectionIntervalMs(30), 120_000);
assert.equal(inspectionIntervalMs(40), 90_000);
assert.equal(inspectionIntervalMs(45), 80_000);

assert.deepEqual(effectiveKeywordList([], DEFAULT_NEGATIVE_KEYWORDS), [...DEFAULT_NEGATIVE_KEYWORDS]);
assert.deepEqual(effectiveKeywordList([...LEGACY_POSITIVE_KEYWORDS], DEFAULT_POSITIVE_KEYWORDS, LEGACY_POSITIVE_KEYWORDS), [...DEFAULT_POSITIVE_KEYWORDS]);
assert.deepEqual(effectiveKeywordList(["custom drone"], DEFAULT_POSITIVE_KEYWORDS, LEGACY_POSITIVE_KEYWORDS), ["custom drone"]);

function base(username: string, source: DiscoveryCandidate["source"], score: number, extra: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return {
    username,
    profileUrl: `https://www.instagram.com/${username}/`,
    source,
    sourcePostUrl: null,
    sourceThumbnailUrl: null,
    discoveredAt: score === 18 ? "2026-10-05T18:00:00.000Z" : "2026-10-05T19:00:00.000Z",
    priorityScore: score,
    ...extra,
  };
}

console.log("candidate pre-score tests passed");
