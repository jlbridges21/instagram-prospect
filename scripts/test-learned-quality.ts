import assert from "node:assert/strict";
import { qualityBand, scoreCandidate } from "../lib/discovery/candidate-priority";
import { candidateRefillDecision, censusFromScores } from "../lib/discovery/pacing";
import {
  exampleFromProspect,
  historicalAdjustment,
  isLearnedApproved,
  learnQualityModel,
  preOpenTrainingText,
  trainingUsesPreOpenFields,
  type LearnedExample,
} from "../lib/discovery/learned-quality";
import { CandidateQueue, mergeCandidateEvidence, type DiscoveryCandidate } from "../worker/discovery/queue";

const keywords = { positiveKeywords: [] as string[], negativeKeywords: [] as string[] };

function row(username: string, text: string, positive: boolean): LearnedExample {
  return { username, text, positive, approved: positive, oldScore: 18 };
}

const positives = Array.from({ length: 10 }, (_, index) => row(`photog${index}`, `photography studio ${index}`, true));
const negatives = Array.from({ length: 10 }, (_, index) => row(`gym${index}`, `fitness training ${index}`, false));
const model = learnQualityModel({ examples: [...positives, ...negatives], minimum: 8, strength: 8 });
const photography = model.tokens.find((token) => token.token === "photography");
const fitness = model.tokens.find((token) => token.token === "fitness");
assert.equal(photography?.active, true);
assert.ok((photography?.positiveRate ?? 0) > (fitness?.positiveRate ?? 1));
assert.equal(fitness?.positive, 0);
assert.ok((fitness?.negative ?? 0) >= 8);

const photoScore = scoreCandidate({ source: "seed", username: "newphoto", text: "photography", learned: model, ...keywords });
const plainScore = scoreCandidate({ source: "seed", username: "johnsmith", text: "johnsmith", learned: model, ...keywords });
const fitnessScore = scoreCandidate({ source: "seed", username: "cityfitness", text: "fitness", learned: model, ...keywords });
assert.ok(photoScore.score > plainScore.score);
assert.ok(fitnessScore.score < plainScore.score);
assert.ok(photoScore.reasons.some((reason) => reason.includes("photography") && reason.includes("historically strong")));
assert.ok(fitnessScore.reasons.some((reason) => reason.includes("fitness") && reason.includes("historically weak")));

const tiny = learnQualityModel({
  examples: [
    row("luckyone", "luckyword", true),
    ...["alphaaa", "bravooo", "charliee", "deltaaa", "echoooo", "foxtrot", "golfzzz", "hotelxx", "indiaaa", "juliett", "kiloooo", "limaone"].map((name) => row(name, name, false)),
  ],
  minimum: 8,
  strength: 8,
});
assert.equal(tiny.tokens.find((token) => token.token === "luckyword")?.active, false);
const lucky = scoreCandidate({ source: "seed", username: "luckyword", text: "luckyword", learned: tiny, ...keywords });
const ordinary = scoreCandidate({ source: "seed", username: "alphaaa", text: "alphaaa", learned: tiny, ...keywords });
assert.equal(lucky.score, ordinary.score);
assert.equal(historicalAdjustment({ text: "luckyword", model: tiny, weight: 10 }).points, 0);

const oneSeed = scoreCandidate({ source: "seed", username: "johnsmith", seedSupportCount: 1, seedMature: true, seedYield: 0.4, seedApprovalYield: 0.3, ...keywords });
const threeSeeds = scoreCandidate({ source: "seed", username: "johnsmith", seedSupportCount: 3, seedMature: true, seedYield: 0.4, seedApprovalYield: 0.3, supportYields: [0.4, 0.4, 0.4], ...keywords });
assert.ok(threeSeeds.score > oneSeed.score);
assert.ok(threeSeeds.network > oneSeed.network);

const highApproval = scoreCandidate({ source: "seed", username: "johnsmith", seedMature: true, seedYield: 0.4, seedApprovalYield: 0.3, ...keywords });
const lowApproval = scoreCandidate({ source: "seed", username: "johnsmith", seedMature: true, seedYield: 0.1, seedApprovalYield: 0.05, ...keywords });
assert.ok(highApproval.score > lowApproval.score);

const immatureAuto = scoreCandidate({ source: "seed", username: "johnsmith", seedMature: false, ...keywords });
const immatureManual = scoreCandidate({ source: "seed", username: "johnsmith", seedMature: false, seedOrigin: "manual", ...keywords });
assert.equal(immatureManual.score, immatureAuto.score + 6);
assert.ok(immatureManual.reasons.some((reason) => reason.includes("approved-seed prior")));
const matureManual = scoreCandidate({ source: "seed", username: "johnsmith", seedMature: true, seedYield: 0.05, seedApprovalYield: 0.05, seedOrigin: "manual", ...keywords });
assert.equal(matureManual.reasons.some((reason) => reason.includes("approved-seed prior")), false);

assert.equal(qualityBand(18), "Fallback");
assert.equal(qualityBand(24), "Fallback");
assert.equal(qualityBand(30), "Low");
assert.equal(qualityBand(17), "Deferred");
const reserve = new CandidateQueue(10);
reserve.place(candidate("fallback18", 18, 18, "2026-01-01T00:00:00.000Z"), 18);
assert.equal(reserve.claim("profile-tab-1", { floor: 18, explore: false })?.username, "fallback18");

const ordered = new CandidateQueue(10);
ordered.place(candidate("fallback18", 18, 18, "2026-01-01T00:00:00.000Z"), 18);
ordered.place(candidate("better30", 30, 30, "2026-01-02T00:00:00.000Z"), 18);
assert.equal(ordered.claim("profile-tab-1", { floor: 18, explore: false })?.username, "better30");

const tied = new CandidateQueue(10);
tied.place(candidate("earlier", 40, 12, "2026-01-01T00:00:00.000Z"), 18);
tied.place(candidate("stronger-network", 40, 36, "2026-02-01T00:00:00.000Z"), 18);
assert.equal(tied.claim("profile-tab-1", { floor: 18, explore: false })?.username, "stronger-network");

const fallbackPool = censusFromScores([18, 22], 18, 20);
assert.equal(candidateRefillDecision({
  census: fallbackPool,
  lowWater: 10,
  explore: false,
  allowInspect: true,
  passes: 0,
  elapsedMs: 0,
  fallbackCeiling: 24,
  lookaheadBudgetMs: 40_000,
}), "refill");
assert.equal(candidateRefillDecision({
  census: fallbackPool,
  lowWater: 10,
  explore: false,
  allowInspect: true,
  passes: 0,
  elapsedMs: 40_000,
  fallbackCeiling: 24,
  lookaheadBudgetMs: 40_000,
}), "inspect_ranked");
assert.equal(candidateRefillDecision({
  census: censusFromScores([18, 45], 18, 20),
  lowWater: 10,
  explore: false,
  allowInspect: true,
  passes: 0,
  elapsedMs: 0,
  fallbackCeiling: 24,
  lookaheadBudgetMs: 40_000,
}), "inspect_ranked");

const merged = mergeCandidateEvidence(
  candidate("johnsmith", 18, 18, "2026-01-01T00:00:00.000Z", "seeda"),
  candidate("johnsmith", 18, 18, "2026-01-02T00:00:00.000Z", "seedb"),
);
assert.equal(merged.seedSupport?.length, 2);
const rescored = scoreCandidate({ source: "seed", username: merged.username, seedSupportCount: merged.seedSupport?.length ?? 1, ...keywords });
assert.ok(rescored.score > 18);

const counted = learnQualityModel({
  examples: [
    { username: "sameperson", text: "photography", positive: true, approved: true, oldScore: 30 },
    { username: "sameperson", text: "photography", positive: true, approved: true, oldScore: 30 },
    ...negatives,
  ],
  minimum: 8,
});
assert.equal(counted.positiveExamples, 1);
assert.equal(isLearnedApproved("contacted"), true);
assert.equal(exampleFromProspect({ instagram_username: "sameperson", status: "contacted" })?.positive, true);

const leaked = { username: "cafe", cardText: "coffee shop", rankingReason: "+ photo · + seed network", bio: "photographer biography that must stay out" };
const trainingText = preOpenTrainingText(leaked);
assert.equal(trainingText.includes("photographer"), false);
assert.equal(trainingText.includes("biography"), false);
assert.equal(trainingText.includes("seed network"), false);
assert.ok(trainingText.includes("cafe"));
assert.ok(trainingText.includes("photo"));
assert.equal(trainingUsesPreOpenFields().includes("bio" as never), false);
assert.equal(exampleFromProspect({
  instagram_username: "cafe",
  status: "disqualified",
  discovery_priority_reason: "+ photo",
})?.text.includes("photo"), true);

const keywordOnly = scoreCandidate({ source: "suggested_accounts", username: "fitnessdaily", text: "fitness", learned: model, positiveKeywords: ["fitness"], negativeKeywords: [] });
assert.ok(threeSeeds.score > keywordOnly.score);

console.log("learned quality tests passed");

function candidate(username: string, score: number, network: number, discoveredAt: string, seed = "seed"): DiscoveryCandidate {
  return {
    username,
    profileUrl: `https://www.instagram.com/${username}/`,
    source: "seed_network",
    sourcePostUrl: null,
    sourceThumbnailUrl: null,
    discoveredAt,
    sourceSeedUsername: seed,
    priorityScore: score,
    networkScore: network,
    seedSupport: [seed],
  };
}
