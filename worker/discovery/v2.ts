import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { CloudClient, CloudConfig } from "../cloud/client";
import { QualificationQueue } from "./qualify-queue";
import { CandidateQueue, SessionUsernameCache, chunkUsernames, evidenceIsNew, mergeCandidateEvidence, unseenUsernames, type DiscoveryCandidate } from "./queue";
import { qualityBand, scoreCandidate, shouldExploreCandidate } from "../../lib/discovery/candidate-priority";
import { buildPreOpenSnapshot, formatSelectionExplanation } from "../../lib/discovery/inspection-snapshot";
import { CANDIDATE_POOL_MAX_PASSES, CANDIDATE_POOL_TARGET, clampTuning, DEFAULT_DISCOVERY_OPTIMIZATION } from "../../lib/discovery/defaults";
import { shouldFlushDiscoveryUsage } from "../../lib/discovery/inspection-count";
import { inspectionSeedId, pickSeed, prospectAttribution, seedCollectionResult, seedStatForCandidate, shouldOpenSeedNetwork, clampSeedNetworkSample, type SeededDiscoverySource } from "../../lib/discovery/seeds";
import { applyEmptySeedCooldowns, seedTurnOutcome } from "../instagram/seed-page";
import { clearEmptySeed, readEmptySeedCooldowns, recordUnproductiveSeed } from "./seed-cooldowns";
import { pickCollectionSource } from "../../lib/discovery/source-ranking";
import { prioritizeCandidates } from "./sources";
import { AttentionError } from "../instagram/errors";
import { ensureHome, readProfile, scrollFeed } from "../instagram/actions";
import { feedCandidates, isAuthenticatedHome, pageSignal, suggestedCandidates } from "../instagram/interpret";
import { isExcludedRelationship } from "../instagram/parse";
import { readDom } from "../instagram/read-dom";
import { log } from "../logger";
import { discoveryQueuePath } from "../paths";
import { formatInspectionDelay } from "../../lib/discovery/cadence";
import {
  acquisitionDecision,
  candidateRefillDecision,
  formatRefillComplete,
  getDiscoveryHourlyState,
  poolStatusLine,
  REFILL_BUDGET_MS,
  REFILL_PASS_LIMIT,
  releaseInspectionSlot,
  reserveInspectionSlot,
} from "../../lib/discovery/pacing";
import { writeHourlyStamps } from "./hourly-history";
import { formatDiscoveryStatus } from "../../lib/worker/discovery-status";

export type DiscoveryStats = {
  seen: number;
  ingested: number;
  excluded: number;
  qualified: number;
  errors: number;
  hour: number[];
};

export type DiscoveryLive = {
  task: string;
  username: string | null;
  lastEvent: string | null;
  attention?: string;
};

export type CloudEfficiency = {
  candidatesFound: number;
  duplicateBatches: number;
  skippedFromCache: number;
  profilesOpened: number;
  prospectsCreated: number;
  qualificationRequests: number;
  cloudRequests: number;
  candidatesDeferred: number;
};

const PROFILE_TABS = ["profile-tab-1", "profile-tab-2"] as const;
let lastOrchestrationLog = "";

function logPoolOnce(line: string) {
  if (line === lastOrchestrationLog) return;
  lastOrchestrationLog = line;
  console.log(line);
}

export function emptyEfficiency(): CloudEfficiency {
  return {
    candidatesFound: 0,
    duplicateBatches: 0,
    skippedFromCache: 0,
    profilesOpened: 0,
    prospectsCreated: 0,
    qualificationRequests: 0,
    cloudRequests: 0,
    candidatesDeferred: 0,
  };
}

export function formatEfficiency(metrics: CloudEfficiency) {
  return [
    "Cloud efficiency",
    "----------------",
    `Candidates found: ${metrics.candidatesFound}`,
    `Cloud duplicate batches: ${metrics.duplicateBatches}`,
    `Candidates skipped from local cache: ${metrics.skippedFromCache}`,
    `Profiles opened: ${metrics.profilesOpened}`,
    `Prospects created: ${metrics.prospectsCreated}`,
    `Candidates below pre-score floor: ${metrics.candidatesDeferred}`,
    `Qualification requests: ${metrics.qualificationRequests}`,
    `Total worker cloud requests: ${metrics.cloudRequests}`,
  ].join("\n");
}

export async function runDiscoveryV2(input: {
  context: BrowserContext;
  homePage: Page;
  cloud: CloudClient;
  stats: DiscoveryStats;
  live: DiscoveryLive;
  workerId: string;
  noWrite: boolean;
  debug: boolean;
  inspectionLimit: number | null;
  shouldStop: () => boolean;
  maybeOutreach?: () => Promise<void>;
  metrics?: CloudEfficiency;
  gate?: (input: { inspections: number; ai: number; emptyCycles: number; collected?: number; deferred?: number }) => Promise<{ pause: boolean; reason: string | null } | null>;
  profilePages?: [Page | null, Page | null];
  preferredTab?: "profile-tab-1" | "profile-tab-2";
  retainTabs?: boolean;
  shouldYield?: () => boolean | Promise<boolean>;
  browserLock?: { tryAcquire: (owner: "discovery") => boolean; release: (owner: "discovery") => void };
  singleTurn?: boolean;
  allowInspect?: boolean;
  exploreDecision?: boolean;
  inspectionDueAt?: number;
  intervalMs?: number;
  onProgress?: () => void;
  onOutcome?: (outcome: { action: "inspected" | "waiting" }) => void;
  readSeedProfile?: (username: string) => Promise<import("../instagram/types").DomSnapshot | null>;
  readSeedNetwork?: (username: string, limit: number, isKnown?: (username: string) => boolean, limits?: { maxScrolls?: number; staleScrolls?: number }) => Promise<import("../instagram/seed-network").SeedNetworkRead>;
}) {
  const metrics = input.metrics ?? emptyEfficiency();
  const queue = new CandidateQueue(10);
  let latestConfig: CloudConfig | null = null;
  const cache = new SessionUsernameCache();
    restoreQueue(queue, cache);
  const failures = new Map<string, number>(PROFILE_TABS.map((tab) => [tab, 0]));
  const seedUses = new Map<string, number>();
  let stopError: unknown = null;
  let pauseReason: string | null = null;
  let sinceGate = 0;
  let aiSinceGate = 0;
  let emptyCycles = 0;
  let acquisitionHeld = false;
  let refillSource = "";
  let exitReason: "hourly" | "yield" | "stopped" | "done" = "done";
  const qualify = new QualificationQueue(3, async (prospectId) => {
      metrics.qualificationRequests += 1;
      try {
      const result = await input.cloud.qualifyProspect(prospectId);
      if (!(result.skipped)) aiSinceGate += 1;
      if (result.ok && !result.skipped) input.stats.qualified += 1;
      if (result.ok && !result.cached && result.status === "review" && result.username) {
        console.log(`@${result.username} → Review`);
        const credit = result.seedCredit;
        if (credit?.username) {
          const inspected = credit.inspected;
          const review = credit.review;
          const yieldPercent = inspected > 0 ? ((review / inspected) * 100).toFixed(1) : "0.0";
          if (credit.syncError) {
            console.log(`Review credit for seed @${credit.username} was not saved. ${credit.syncError}`);
          } else if (review === 0) {
            console.log(`Seed @${credit.username} Review counter is still 0 after ${inspected} inspected.`);
          } else {
            console.log(`Credited Review to seed @${credit.username}`);
            console.log(`Seed yield: ${review} Review / ${inspected} inspected = ${yieldPercent}%`);
          }
        }
      }
    } catch (error) {
      if (isAttention(error)) throw error;
      log("warn", "qualification_request_failed", { prospect_id: prospectId, message: error instanceof Error ? error.message : "failed" });
    }
  });
  const tabs = (input.profilePages
    ? PROFILE_TABS.map((id, index) => {
        const page = input.profilePages?.[index];
        return page ? { id, page } : null;
      })
    : [] as Array<{ id: (typeof PROFILE_TABS)[number]; page: Page } | null>)
    .filter((tab): tab is { id: (typeof PROFILE_TABS)[number]; page: Page } => Boolean(tab));
  try {
    if (!input.profilePages) {
      for (const id of PROFILE_TABS) {
        tabs.push({ id, page: await input.context.newPage() });
      }
    }
    latestConfig = await input.cloud.config();
    queue.applyFloor(latestConfig.minCandidatePreScore ?? DEFAULT_DISCOVERY_OPTIMIZATION.minCandidatePreScore);
    if (input.singleTurn) {
      await orchestrateTurn();
    } else {
      await Promise.all([
        collectLoop(),
        ...tabs.map((tab) => inspectLoop(tab.id, tab.page)),
      ]);
    }
  } catch (error) {
    stopError = error;
  } finally {
    persistQueue(queue, cache);
    await qualify.drain().catch(() => undefined);
    await consultGate();
    if (!input.retainTabs) await Promise.all(tabs.map((tab) => tab.page.close().catch(() => undefined)));
  }
  if (stopError) throw stopError;
  return exitReason;

  async function collectCandidates(config: CloudConfig): Promise<{ ordered: DiscoveryCandidate[]; sourceLabel: string; seedUsername?: string | null }> {
    const seeds = (config.discoverySeeds ?? []).map((seed) => ({
      id: seed.id,
      username: seed.username,
      sourceType: seed.sourceType,
      active: true,
      priority: seed.priority,
      inspected: seed.inspected,
      review: seed.review,
      consecutiveUses: seedUses.get(seed.id) ?? seed.consecutiveUses,
    }));
    const choice = pickCollectionSource({
      hasSeeds: seeds.length > 0 && Boolean(input.readSeedProfile),
      homeEnabled: config.homeFeedEnabled,
      suggestedEnabled: config.suggestedAccountsEnabled,
      homeUsage: config.homeFeedUsage ?? "low",
      strategy: config.discoveryStrategy ?? "balanced",
      random: Math.random(),
      tuning: config.tuning,
    });
    if (choice === "seed") {
      const fromSeed = await candidatesFromSeed(config, seeds);
      if (fromSeed) return fromSeed;
    }
    const dom = await readDiscoveryPage(input.homePage);
    const useHome = choice === "home_feed" || !config.suggestedAccountsEnabled;
    const ordered = prioritizeCandidates({
      suggested: useHome ? [] : suggestedCandidates(dom),
      home: useHome ? feedCandidates(dom) : [],
      priority: useHome ? "home_first" : "suggested_first",
      homeEnabled: useHome && config.homeFeedEnabled,
      suggestedEnabled: !useHome && config.suggestedAccountsEnabled,
    });
    if (ordered.length === 0 && useHome && config.suggestedAccountsEnabled) {
      return {
        ordered: prioritizeCandidates({
          suggested: suggestedCandidates(dom),
          home: [],
          priority: "suggested_first",
          homeEnabled: false,
          suggestedEnabled: true,
        }),
        sourceLabel: "Suggested Accounts",
      };
    }
    return { ordered, sourceLabel: useHome ? "Home Feed" : "Suggested Accounts" };
  }

  async function candidatesFromSeed(config: CloudConfig, seeds: Parameters<typeof pickSeed>[0]["seeds"]) {
    if (!input.readSeedProfile) return null;
    const now = new Date();
    const seed = pickSeed({
      seeds: applyEmptySeedCooldowns(seeds, readEmptySeedCooldowns(now.getTime()), now.getTime()),
      minSample: config.minSeedSample ?? 10,
      favorYield: config.favorYield !== false,
      yieldStrength: config.yieldStrength ?? "medium",
      strategy: config.discoveryStrategy ?? "balanced",
      cooldownCycles: config.seedCooldownCycles ?? 2,
      now,
      random: Math.random,
      tuning: config.tuning,
    });
    if (!seed) return null;
    for (const known of seeds) seedUses.set(known.id, known.id === seed.id ? (seedUses.get(known.id) ?? 0) + 1 : 0);
    console.log(`Discovery seed: @${seed.username}`);
    console.log("Opening seed suggestions...");
    const page = await input.readSeedProfile(seed.username);
    input.onProgress?.();
    const found = page ? suggestedCandidates(page) : [];
    const suggestions = seedCollectionResult({
      seedId: seed.id,
      seedUsername: seed.username,
      usernames: found.map((item) => item.username),
      source: "seed_suggestion",
      cardText: Object.fromEntries(found.flatMap((item) => (item.cardText ? [[item.username, item.cardText]] : []))),
    });
    const freshSuggestions = unseenUsernames(suggestions.candidates.map((item) => item.username), cache, queue);
    if (!suggestions.fallback && freshSuggestions.fresh.length > 0) {
      input.onProgress?.();
      await input.cloud.bumpSeed(seed.id, { used: true, seen: freshSuggestions.fresh.length }).catch(() => undefined);
      const fresh = new Set(freshSuggestions.fresh);
      return packSeedCandidates(config, suggestions.candidates.filter((item) => fresh.has(item.username)), new Map(found.map((item) => [item.username, item])));
    }
    if (!suggestions.fallback) console.log("Seed suggestions produced no new candidates.");
    else console.log("No usable profile suggestions.");
    const limit = clampSeedNetworkSample(config.seedNetworkSample ?? 15);
    const networkEnabled = config.seedNetworkEnabled !== false && Boolean(input.readSeedNetwork);
    let networkUsernames: string[] = [];
    let networkCardText: Record<string, string> = {};
    if (shouldOpenSeedNetwork(freshSuggestions.fresh.length, networkEnabled) && limit > 0 && page) {
      console.log(`Opening seed network for @${seed.username}...`);
      const known = (name: string) => cache.has(name) || queue.seen(name);
      const tuning = clampTuning(config.tuning);
      const networkRead = await input.readSeedNetwork!(seed.username, limit, known, { maxScrolls: tuning.seedMaxScrolls, staleScrolls: tuning.seedStaleScrolls }).catch((error: unknown) => ({
        usernames: [] as string[],
        buttonFound: false,
        dialogOpened: false,
        profileLinksFound: 0,
        normalizedUsernames: 0,
        duplicates: 0,
        reserved: 0,
        seedSelf: 0,
        alreadyKnown: 0,
        reason: error instanceof Error ? error.message : "could not open following",
      }));
      input.onProgress?.();
      const sessionNetwork = unseenUsernames(networkRead.usernames, cache, queue);
      const freshNetwork = sessionNetwork.fresh;
      const alreadyKnown = networkRead.alreadyKnown > 0 ? networkRead.alreadyKnown : networkRead.usernames.length - freshNetwork.length + sessionNetwork.skippedFromCache;
      for (const line of [
        `Following button found: ${networkRead.buttonFound ? "yes" : "no"}`,
        `Following dialog opened: ${networkRead.dialogOpened ? "yes" : "no"}`,
        `profile links found: ${networkRead.profileLinksFound}`,
        `normalized usernames: ${networkRead.normalizedUsernames}`,
        `duplicates: ${networkRead.duplicates}`,
        `reserved paths: ${networkRead.reserved}`,
        `seed self: ${networkRead.seedSelf}`,
        `already known: ${alreadyKnown}`,
        `usable: ${freshNetwork.length}`,
      ]) console.log(line);
      if (freshNetwork.length === 0 && networkRead.reason) console.log(`reason: ${networkRead.reason}`);
      networkUsernames = freshNetwork;
      networkCardText = "labels" in networkRead && networkRead.labels ? networkRead.labels : {};
    }
    const network = seedCollectionResult({
      seedId: seed.id,
      seedUsername: seed.username,
      usernames: networkUsernames,
      source: "seed_network",
      cardText: networkCardText,
    });
    const session = unseenUsernames(network.candidates.map((item) => item.username), cache, queue);
    if (!network.fallback && session.fresh.length > 0) {
      console.log(`Collected ${session.fresh.length} accounts from Following.`);
      console.log(`${session.fresh.length} new candidates after dedupe.`);
      await input.cloud.bumpSeed(seed.id, { used: true, seen: session.fresh.length }).catch(() => undefined);
      const fresh = new Set(session.fresh);
      return packSeedCandidates(config, network.candidates.filter((item) => fresh.has(item.username)), new Map());
    }
    const exhausted = Boolean(page) && !(networkEnabled && limit === 0);
    if (exhausted) {
      const pause = recordUnproductiveSeed(seed.username, Date.now(), undefined, exhaustionDurations(config));
      console.log(`Cooling down @${seed.username} for ${pause.minutes} minutes after ${pause.emptyVisits} empty visit${pause.emptyVisits === 1 ? "" : "s"}.`);
    }
    if (networkEnabled && page && limit > 0) console.log("Seed network produced no new candidates.");
    console.log("Falling back to Suggested Accounts.");
    await input.cloud.bumpSeed(seed.id, { used: true, seen: 0 }).catch(() => undefined);
    return null;
  }

  function packSeedCandidates(
    config: CloudConfig,
    candidates: Array<{ username: string; source: SeededDiscoverySource; sourceSeedId: string; sourceSeedUsername: string; cardText?: string | null }>,
    urls: Map<string, { profileUrl?: string; postUrl?: string | null }>,
  ) {
    const sourceLabel = candidates[0]?.source === "seed_network" ? "Seed network" : "Seed suggestions";
    return {
      sourceLabel,
      seedUsername: candidates[0]?.sourceSeedUsername ?? null,
      ordered: candidates.map((item) => {
        const match = urls.get(item.username);
        return applyPriority({
          username: item.username,
          profileUrl: match?.profileUrl ?? `https://www.instagram.com/${item.username}/`,
          source: item.source,
          sourcePostUrl: match?.postUrl ?? null,
          sourceThumbnailUrl: null,
          discoveredAt: new Date().toISOString(),
          sourceSeedId: item.sourceSeedId,
          sourceSeedUsername: item.sourceSeedUsername,
          cardText: item.cardText ?? null,
          sourcesSeen: [item.source],
          seedSupport: [item.sourceSeedUsername],
        }, config);
      }),
    };
  }

  async function rankAndPlace(ordered: DiscoveryCandidate[], config: CloudConfig) {
    const floor = config.minCandidatePreScore ?? DEFAULT_DISCOVERY_OPTIMIZATION.minCandidatePreScore;
    const fresh: DiscoveryCandidate[] = [];
    const merges: DiscoveryCandidate[] = [];
    let skippedFromCache = 0;
    const seen = new Set<string>();
    for (const candidate of ordered) {
      const username = candidate.username.trim().toLowerCase();
      if (!username || seen.has(username)) continue;
      seen.add(username);
      if (cache.has(username) || queue.isClosed(username)) {
        skippedFromCache += 1;
        continue;
      }
      const held = queue.hold(username);
      if (held) {
        if (evidenceIsNew(held, candidate)) merges.push(candidate);
        else skippedFromCache += 1;
      } else fresh.push(candidate);
    }
    metrics.candidatesFound += fresh.length + merges.length;
    metrics.skippedFromCache += skippedFromCache;
    if (skippedFromCache > 0) log("info", "candidate_duplicate_session", { count: skippedFromCache });
    const accepted: DiscoveryCandidate[] = [];
    if (!input.noWrite) {
      for (const chunk of chunkUsernames(fresh.map((candidate) => candidate.username), 15)) {
        metrics.duplicateBatches += 1;
        const checked = await input.cloud.checkProspects(chunk);
        for (const row of checked.results) {
          const username = (row.username ?? "").toLowerCase();
          const candidate = fresh.find((item) => item.username.toLowerCase() === username);
          if (row.skip) {
            cache.remember(username, true);
            log("info", "candidate_duplicate_cloud", { username, status: row.status });
            if (candidate && inspectionSeedId(candidate)) await input.cloud.bumpSeed(candidate.sourceSeedId ?? "", seedStatForCandidate("duplicate_skipped")).catch(() => undefined);
            continue;
          }
          if (candidate) accepted.push(candidate);
        }
      }
    } else {
      accepted.push(...fresh);
    }
    const scored = [...merges, ...accepted]
      .map((candidate) => {
        const held = queue.hold(candidate.username);
        return applyPriority(held ? mergeCandidateEvidence(held, candidate) : candidate, config);
      })
      .sort((left, right) => (right.priorityScore ?? 0) - (left.priorityScore ?? 0) || left.discoveredAt.localeCompare(right.discoveredAt));
    let queued = 0;
    let deferred = 0;
    for (const candidate of scored) {
      const result = queue.place(candidate, floor);
      if (result === "queued") {
        queued += 1;
        console.log(`Queued @${candidate.username} (pre-score ${candidate.priorityScore ?? 0})`);
        console.log(`Source: ${candidate.source}`);
        if ((candidate.source === "seed_suggestion" || candidate.source === "seed_network") && candidate.sourceSeedUsername) console.log(`Seed: @${candidate.sourceSeedUsername}`);
        log("info", "candidate_queued", { username: candidate.username, source: candidate.source, seed: candidate.sourceSeedUsername ?? null, preScore: candidate.priorityScore ?? 0 });
        if (inspectionSeedId(candidate)) await input.cloud.bumpSeed(candidate.sourceSeedId ?? "", seedStatForCandidate("queued")).catch(() => undefined);
      } else if (result === "merged") {
        console.log(`Updated @${candidate.username} (pre-score ${candidate.priorityScore ?? 0}, seeds ${candidate.seedSupport?.length ?? 0})`);
      } else if (result === "deferred") {
        deferred += 1;
      }
    }
    metrics.candidatesDeferred += deferred;
    if (scored.length > 0) console.log(`Ranked ${scored.length} candidates. Queued ${queued}. Below pre-score ${floor}: ${deferred}.`);
    if ((fresh.length + merges.length > 0 || deferred > 0) && input.gate) {
      await input.gate({ inspections: 0, ai: 0, emptyCycles: 0, collected: fresh.length + merges.length, deferred }).catch(() => undefined);
    }
    input.onProgress?.();
    return { queued, deferred, considered: fresh.length + merges.length, survived: accepted.length };
  }

  let inspectionDelayLog = "";
  function noteInspectionDelay(reason: string) {
    if (input.inspectionDueAt == null || input.intervalMs == null) return;
    const line = formatInspectionDelay({
      now: Date.now(),
      dueAt: input.inspectionDueAt,
      intervalMs: input.intervalMs,
      reason,
    });
    if (!line || line === inspectionDelayLog) return;
    inspectionDelayLog = line;
    console.log(line);
  }

  async function orchestrateTurn() {
    const config = latestConfig ?? await input.cloud.config();
    latestConfig = config;
    const limits = poolLimits(config);
    queue.setTarget(limits.highWater);
    const allowInspect = input.allowInspect !== false;
    const explore = input.exploreDecision === true;
    const refillStarted = Date.now();
    let passes = 0;
    let emptyPasses = 0;
    let refillLogged = false;
    while (!finished()) {
      if (await input.shouldYield?.()) {
        exitReason = "yield";
        return;
      }
      const floor = latestConfig?.minCandidatePreScore ?? DEFAULT_DISCOVERY_OPTIMIZATION.minCandidatePreScore;
      const tuning = clampTuning(latestConfig?.tuning);
      const explorationFloor = tuning.explorationFloor;
      queue.applyFloor(floor);
      const census = queue.census(floor, explorationFloor);
      const slotDue = input.inspectionDueAt != null && Date.now() >= input.inspectionDueAt;
      const action = candidateRefillDecision({
        census,
        lowWater: limits.lowWater,
        explore,
        allowInspect,
        passes,
        maxPasses: REFILL_PASS_LIMIT,
        consecutiveEmptyPasses: emptyPasses,
        elapsedMs: Date.now() - refillStarted,
        budgetMs: REFILL_BUDGET_MS,
        slotDue,
        fallbackCeiling: tuning.fallbackCeiling,
        lookaheadBudgetMs: tuning.fallbackLookaheadSeconds * 1000,
      });
      if (action === "yield_for_slot") {
        noteInspectionDelay("Refilling candidate pool");
        console.log("Inspection slot is due. Stopping candidate refill.");
        return;
      }
      if (action === "inspect_ranked" || action === "inspect_starvation") {
        if (action === "inspect_starvation") {
          console.log(formatRefillComplete({ census, floor, selection: "starvation fallback" }));
        }
        const tab = tabs.find((item) => item.id === input.preferredTab) ?? tabs[0];
        if (!tab) return;
        const seenBefore = input.stats.seen;
        await inspectLoop(tab.id, tab.page, { once: true, explore: false, bestEligible: action === "inspect_starvation" });
        input.onOutcome?.({ action: input.stats.seen > seenBefore ? "inspected" : "waiting" });
        return;
      }
      if (action === "refill") {
        noteInspectionDelay("Refilling candidate pool");
        if (!refillLogged) {
          const lookingAhead = allowInspect && census.ranked > 0 && (census.highest ?? 0) <= clampTuning(latestConfig?.tuning).fallbackCeiling;
          if (lookingAhead) {
            console.log(`Best candidate is fallback score ${census.highest}. Looking for a stronger candidate before inspecting it.`);
          } else {
            console.log("No ranked candidate available.");
          }
          console.log(`Pool: ${poolStatusLine(census)}`);
          console.log("Refilling candidate pool...");
          refillLogged = true;
        }
        const added = await acquirePass();
        passes += 1;
        emptyPasses = added > 0 ? 0 : emptyPasses + 1;
        continue;
      }
      noteInspectionDelay("Waiting for eligible candidate");
      const waitingLine = census.ranked === 0 && passes > 0
        ? formatRefillComplete({ census, floor, selection: "wait" })
        : `No ranked candidate available.\nPool: ${poolStatusLine(census)}`;
      logPoolOnce(waitingLine);
      input.onProgress?.();
      input.onOutcome?.({ action: "waiting" });
      return;
    }
  }

  async function acquirePass() {
    const config = await input.cloud.config();
    latestConfig = config;
    if (!config.discoveryEnabled) return 0;
    queue.setTarget(poolLimits(config).highWater);
    input.live.task = "discovering_candidates";
    input.onProgress?.();
    const collected = await collectCandidates(config);
    if (refillSource !== collected.sourceLabel) {
      refillSource = collected.sourceLabel;
      console.log(`Discovery source: ${collected.sourceLabel}`);
    }
    const ranked = collected.ordered.length > 0
      ? await rankAndPlace(collected.ordered, config)
      : { queued: 0, deferred: 0, considered: 0, survived: 0 };
    if (collected.seedUsername) {
      const added = ranked.queued + ranked.deferred;
      const outcome = seedTurnOutcome({ newAfterDedupe: added, queuedAboveFloor: ranked.queued });
      if (added > 0) clearEmptySeed(collected.seedUsername);
      else if (outcome === "empty" && collected.ordered.length > 0) {
        const pause = recordUnproductiveSeed(collected.seedUsername, Date.now(), undefined, exhaustionDurations(config));
        console.log("Seed network produced no new candidates.");
        console.log(`Cooling down @${collected.seedUsername} for ${pause.minutes} minutes after ${pause.emptyVisits} empty visit${pause.emptyVisits === 1 ? "" : "s"}.`);
      }
    }
    publish(config, collected.sourceLabel);
    if (queue.pendingCount() + queue.deferredCount() < poolLimits(config).highWater) {
      await scrollFeed(input.homePage);
      await sleep(1_000);
    }
    return ranked.considered;
  }

  async function collectLoop() {
    let idleScrolls = 0;
    let announcedSource = "";
    let passes = 0;
    while (!finished()) {
      const config = await input.cloud.config();
      latestConfig = config;
      if (!config.discoveryEnabled) {
        input.live.task = "idle";
        await sleep(5_000);
        continue;
      }
      const limits = poolLimits(config);
      queue.setTarget(limits.highWater);
      hourPace();
      if (await input.shouldYield?.()) {
        exitReason = "yield";
        return;
      }
      const poolSize = queue.pendingCount() + queue.deferredCount();
      const acquisition = poolSize >= limits.highWater
        ? { acquire: false, holding: true }
        : acquisitionDecision({
          pending: Math.min(poolSize, limits.lowWater),
          highWater: limits.highWater,
          lowWater: limits.lowWater,
          holding: false,
          hourlyFull: false,
        });
      acquisitionHeld = acquisition.holding;
      publish(config, null);
      if (!acquisition.acquire) {
        if (input.singleTurn) return;
        input.live.task = qualify.activeCount > 0 ? "qualifying_profiles" : "inspecting_profiles";
        if (!input.shouldYield) await input.maybeOutreach?.().catch(() => undefined);
        await sleep(500);
        continue;
      }
      input.live.task = "discovering_candidates";
      input.onProgress?.();
      const collected = await collectCandidates(config);
      const ordered = collected.ordered;
      const sourceLabel = collected.sourceLabel;
      if (announcedSource !== sourceLabel) {
        announcedSource = sourceLabel;
        console.log(`Discovery source: ${sourceLabel}`);
      }
      const ranked = ordered.length > 0
        ? await rankAndPlace(ordered, config)
        : { queued: 0, deferred: 0, considered: 0, survived: 0 };
      if (collected.seedUsername) {
        const added = ranked.queued + ranked.deferred;
        const outcome = seedTurnOutcome({ newAfterDedupe: added, queuedAboveFloor: ranked.queued });
        if (added > 0) clearEmptySeed(collected.seedUsername);
        else if (outcome === "empty" && ordered.length > 0) {
          const pause = recordUnproductiveSeed(collected.seedUsername, Date.now(), undefined, exhaustionDurations(config));
          console.log("Seed network produced no new candidates.");
          console.log(`Cooling down @${collected.seedUsername} for ${pause.minutes} minutes after ${pause.emptyVisits} empty visit${pause.emptyVisits === 1 ? "" : "s"}.`);
        }
      }
      publish(config, sourceLabel);
      if (ranked.considered === 0) {
        emptyCycles += 1;
        idleScrolls += 1;
        if (idleScrolls >= 4 && queue.pendingCount() === 0 && queue.inProgress().length === 0) {
          await sleep(config.discoveryScrollDelaySeconds * 1000);
        }
      } else {
        emptyCycles = 0;
        idleScrolls = 0;
      }
      if (queue.pendingCount() + queue.deferredCount() < poolLimits(config).highWater) {
        await scrollFeed(input.homePage);
        await sleep(input.singleTurn ? 1_000 : config.discoveryScrollDelaySeconds * 1000);
      }
      if (!input.shouldYield) await input.maybeOutreach?.().catch(() => undefined);
      if (input.singleTurn) {
        passes += 1;
        const limits = poolLimits(config);
        const pool = queue.pendingCount() + queue.deferredCount();
        if (pool >= limits.target || pool >= limits.highWater || passes >= CANDIDATE_POOL_MAX_PASSES) return;
      }
    }
  }

  async function inspectLoop(tabId: (typeof PROFILE_TABS)[number], page: Page, options?: { once?: boolean; explore?: boolean; bestEligible?: boolean }) {
    while (!finished()) {
      if (await input.shouldYield?.()) {
        exitReason = "yield";
        return;
      }
      const pace = hourPace();
      const floor = latestConfig?.minCandidatePreScore ?? DEFAULT_DISCOVERY_OPTIMIZATION.minCandidatePreScore;
      const explorationFloor = clampTuning(latestConfig?.tuning).explorationFloor;
      const exploreRoll = Math.random();
      const explore = typeof options?.explore === "boolean"
        ? options.explore
        : shouldExploreCandidate(latestConfig?.discoveryStrategy ?? "balanced", exploreRoll, latestConfig?.tuning);
      const candidate = queue.claim(tabId, { floor, explore: options?.bestEligible ? false : explore, bestEligible: options?.bestEligible, explorationFloor, random: exploreRoll });
      const runnerUp = candidate ? queue.peekNext() : null;
      if (!candidate) {
        if (options?.once || input.singleTurn) return;
        await sleep(300);
        continue;
      }
      const reservedAt = Date.now();
      if (input.singleTurn) {
        rememberHour([...input.stats.hour.filter((stamp) => reservedAt - stamp < 60 * 60 * 1000), reservedAt]);
      } else {
        const reserved = reserveInspectionSlot({
          stamps: input.stats.hour,
          now: reservedAt,
          limit: pace.limit,
        });
        rememberHour(reserved.state.stamps);
        if (!reserved.ok) {
          queue.release(candidate.username);
          continue;
        }
      }
      if (finished()) {
        queue.release(candidate.username);
        rememberHour(releaseInspectionSlot(input.stats.hour, reservedAt));
        return;
      }
      input.stats.seen += 1;
      metrics.profilesOpened += 1;
      sinceGate += 1;
      if (sinceGate >= 5) await consultGate();
      input.live.task = "inspecting_profiles";
      input.live.username = candidate.username;
      input.onProgress?.();
      const selection = candidate.inspectionSelection ?? "ranked";
      const strategy = latestConfig?.discoveryStrategy ?? "balanced";
      console.log(`Inspecting @${candidate.username}`);
      console.log(`Candidate pre-score: ${candidate.priorityScore ?? 0}`);
      console.log(`Minimum pre-score: ${floor}`);
      console.log(`Selection: ${selection === "starvation" ? "starvation fallback" : selection}`);
      if (selection === "exploration") {
        const label = strategy === "conservative" ? "Conservative" : strategy === "exploratory" ? "Exploratory" : "Balanced";
        console.log(`Exploration floor: ${explorationFloor}`);
        console.log(`Strategy: ${label}`);
      }
      console.log(`Source: ${candidate.source}`);
      if ((candidate.source === "seed_suggestion" || candidate.source === "seed_network") && candidate.sourceSeedUsername) console.log(`Seed: @${candidate.sourceSeedUsername}`);
      console.log(formatSelectionExplanation({
        username: candidate.username,
        preScore: candidate.priorityScore ?? null,
        priorityBand: typeof candidate.priorityScore === "number" ? qualityBand(candidate.priorityScore) : null,
        reasons: candidate.priorityReasons,
        runnerUpUsername: runnerUp?.username ?? null,
        runnerUpPreScore: runnerUp?.priorityScore ?? null,
      }));
      log("info", tabId === "profile-tab-1" ? "candidate_claimed_tab_a" : "candidate_claimed_tab_b", {
        username: candidate.username,
      });
      if (input.browserLock && !input.browserLock.tryAcquire("discovery")) {
        queue.release(candidate.username);
        rememberHour(releaseInspectionSlot(input.stats.hour, reservedAt));
        exitReason = "yield";
        return;
      }
      try {
        await inspectCandidate(page, candidate, runnerUp);
        input.onProgress?.();
        queue.complete(candidate.username, "done");
        failures.set(tabId, 0);
        log("info", "candidate_completed", { username: candidate.username, tab: tabId });
        if (await input.shouldYield?.()) {
          exitReason = "yield";
          return;
        }
      } catch (error) {
        if (isAttention(error)) {
          queue.fail(candidate.username);
          throw error;
        }
        queue.fail(candidate.username);
        failures.set(tabId, (failures.get(tabId) ?? 0) + 1);
        input.stats.errors += 1;
        const message = error instanceof Error ? error.message : "Profile inspection failed.";
        log("error", "profile_discovery_error", { username: candidate.username, tab: tabId, message });
        console.log(`${tabId} failed @${candidate.username}: ${message}`);
        if ([...failures.values()].every((count) => count >= 3)) {
          input.live.attention = "Both profile inspection tabs are failing. Discovery is still running.";
        }
      } finally {
        input.browserLock?.release("discovery");
      }
      if (options?.once || input.singleTurn) return;
    }
  }

  async function inspectCandidate(page: Page, candidate: DiscoveryCandidate, runnerUp: DiscoveryCandidate | null) {
    const preOpenSnapshot = buildPreOpenSnapshot({
      username: candidate.username,
      cardText: candidate.cardText,
      source: candidate.source,
      sourceSeedId: candidate.sourceSeedId,
      sourceSeedUsername: candidate.sourceSeedUsername,
      seedSupport: candidate.seedSupport,
      preScore: candidate.priorityScore,
      nicheComponent: candidate.nicheComponent,
      commercialComponent: candidate.commercialComponent,
      networkComponent: candidate.networkScore,
      sourceReviewYield: candidate.sourceReviewYield,
      sourceApprovalYield: candidate.sourceApprovalYield,
      sourcePriorPoints: candidate.sourcePriorPoints,
      seedReviewYield: candidate.seedReviewYield,
      seedApprovalYield: candidate.seedApprovalYield,
      seedMature: candidate.seedMature,
      strategy: latestConfig?.discoveryStrategy ?? null,
      priorityLabel: candidate.priorityLabel,
      priorityReasons: candidate.priorityReasons,
      runnerUpUsername: runnerUp?.username ?? null,
      runnerUpPreScore: runnerUp?.priorityScore ?? null,
    });
    const profile = await readProfile(page, candidate.username);
    if (!profile.profileExists) return;
    const excluded = isExcludedRelationship(profile.relationship);
    console.log(`@${candidate.username} relationship: ${profile.relationship}`);
    if (input.noWrite) return;
    const ingested = await input.cloud.ingestProspect({
      instagram_username: candidate.username,
      display_name: profile.profile.displayName,
      profile_url: candidate.profileUrl,
      profile_picture_url: profile.profile.profilePictureUrl,
      bio: profile.profile.bio,
      follower_count: profile.profile.followerCount,
      following_count: profile.profile.followingCount,
      location_text: profile.profile.locationText,
      already_following: excluded,
      instagram_post_url: candidate.sourcePostUrl,
      ...prospectAttribution(candidate),
      follow_relationship: profile.relationship,
      preopen_snapshot: preOpenSnapshot,
    });
    const creditedSeed = inspectionSeedId(candidate);
    if (creditedSeed && ingested.prospectId) {
      await input.cloud.recordSeedInspection(creditedSeed, ingested.prospectId).catch(() => undefined);
    }
    console.log(`@${candidate.username} cloud: ${ingested.created ? "created" : ingested.reason ?? "updated"}`);
    if (ingested.created) {
      input.stats.ingested += 1;
      metrics.prospectsCreated += 1;
      log("info", "candidate_ingested", { username: candidate.username, source: candidate.source });
    }
    cache.remember(candidate.username, true);
    if (excluded) {
      input.stats.excluded += 1;
      log("info", "candidate_excluded_following", { username: candidate.username, relationship: profile.relationship });
      return;
    }
    if (profile.relationship !== "not_following" || !ingested.prospectId || ingested.shouldQualify === false) return;
    input.live.task = "qualifying_profiles";
    qualify.enqueue(ingested.prospectId);
    console.log(`@${candidate.username} qualification: queued`);
    log("info", "profile_qualification_requested", { username: candidate.username, prospect_id: ingested.prospectId });
  }

  function publish(config: CloudConfig, sourceLabel: string | null) {
    const active = new Map(queue.inProgress().map((item) => [item.tab, item.username]));
    const source = sourceLabel ?? (config.discoverySourcePriority === "home_first" ? "Home Feed" : "Suggested Accounts");
    const pace = hourPace();
    if (!pace.limited) {
      const floor = config.minCandidatePreScore ?? DEFAULT_DISCOVERY_OPTIMIZATION.minCandidatePreScore;
      const census = queue.census(floor, clampTuning(config.tuning).explorationFloor);
      input.live.lastEvent = formatDiscoveryStatus({
        source,
        pending: queue.pendingCount(),
        tab1: active.get("profile-tab-1") ?? null,
        tab2: active.get("profile-tab-2") ?? null,
        hour: `${pace.count}/${pace.limit}`,
        pool: census,
      });
    }
  }

  function rememberHour(stamps: number[]) {
    const previous = input.stats.hour;
    const changed = stamps.length !== previous.length || stamps.some((stamp, index) => stamp !== previous[index]);
    input.stats.hour = stamps;
    if (changed) writeHourlyStamps(stamps);
  }

  function hourPace() {
    const pace = getDiscoveryHourlyState({
      stamps: input.stats.hour,
      now: Date.now(),
      limit: latestConfig?.maxProfilesPerHour ?? 30,
    });
    rememberHour(pace.stamps);
    return pace;
  }

  function sessionCap() {
    if (input.inspectionLimit != null) return input.inspectionLimit;
    return latestConfig?.sessionInspectionCap ?? latestConfig?.maxProfilesPerSession ?? 50;
  }

  async function consultGate() {
    if (!input.gate || !shouldFlushDiscoveryUsage({ profileOpens: sinceGate, aiQualifications: aiSinceGate })) return;
    const inspections = sinceGate;
    const ai = aiSinceGate;
    sinceGate = 0;
    aiSinceGate = 0;
    try {
      const result = await input.gate({ inspections, ai, emptyCycles });
      if (result?.pause) {
        pauseReason = result.reason;
        input.live.lastEvent = result.reason;
        console.log(`Discovery paused. Reason: ${result.reason ?? "stopped"}.`);
      }
    } catch {
      // A missing Discovery V3 migration must not stop the current discovery loop.
    }
  }

  function finished() {
    if (input.shouldStop() || stopError || pauseReason) return true;
    return input.stats.seen >= sessionCap();
  }

}

async function readDiscoveryPage(page: Page) {
  try {
    const dom = await readDom(page);
    const signal = pageSignal(dom);
    if (signal === "login_required" || signal === "instagram_checkpoint" || signal === "action_blocked" || signal === "rate_limited") {
      throw new AttentionError(signal, "Instagram needs attention before discovery can continue.");
    }
    if (isAuthenticatedHome(dom)) return dom;
  } catch (error) {
    if (error instanceof AttentionError) throw error;
  }
  await ensureHome(page);
  return readDom(page);
}

function restoreQueue(queue: CandidateQueue, cache: SessionUsernameCache) {
  try {
    const raw = fs.readFileSync(discoveryQueuePath(), "utf8");
    const parsed = JSON.parse(raw) as { pending?: DiscoveryCandidate[]; deferred?: DiscoveryCandidate[]; seen?: string[] };
    cache.load(parsed.seen ?? []);
    for (const candidate of parsed.pending ?? []) {
      queue.enqueue(candidate);
      cache.forget(candidate.username);
    }
    for (const candidate of parsed.deferred ?? []) {
      queue.place(candidate, Number.MAX_SAFE_INTEGER);
      cache.forget(candidate.username);
    }
  } catch {
    // A missing queue file is the normal first run.
  }
}

function persistQueue(queue: CandidateQueue, cache: SessionUsernameCache) {
  try {
    fs.mkdirSync(path.dirname(discoveryQueuePath()), { recursive: true });
    const held = new Set([...queue.pendingCandidates(), ...queue.deferredCandidates()].map((candidate) => candidate.username));
    const seen = cache.usernames().filter((username) => !held.has(username));
    fs.writeFileSync(
      discoveryQueuePath(),
      JSON.stringify({ pending: queue.pendingCandidates(), deferred: queue.deferredCandidates(), seen }),
    );
  } catch {
    // Shutdown persistence is best-effort.
  }
}

function isAttention(error: unknown) {
  return error instanceof AttentionError;
}

function applyPriority(candidate: DiscoveryCandidate, config: CloudConfig): DiscoveryCandidate {
  const support = [...new Set([...(candidate.seedSupport ?? []), candidate.sourceSeedUsername ?? ""].map((value) => value.trim().toLowerCase()).filter(Boolean))];
  const seeds = config.discoverySeeds ?? [];
  const minSample = config.minSeedSample ?? 10;
  let bestYield = 0;
  let bestApproval: number | null = null;
  let bestMature = false;
  let bestName = candidate.sourceSeedUsername ?? null;
  let bestPriority: "low" | "normal" | "high" | undefined;
  if (config.favorYield !== false) {
    for (const name of support) {
      const seed = seeds.find((item) => item.username.toLowerCase() === name);
      if (!seed || seed.inspected < minSample || seed.inspected <= 0) continue;
      const yieldRate = seed.review / seed.inspected;
      const approvalRate = typeof seed.approved === "number" ? seed.approved / seed.inspected : null;
      const quality = (approvalRate ?? 0) * 3 + yieldRate;
      const bestQuality = (bestApproval ?? 0) * 3 + bestYield;
      if (!bestMature || quality >= bestQuality) {
        bestYield = yieldRate;
        bestApproval = approvalRate;
        bestMature = true;
        bestName = seed.username;
        bestPriority = seed.priority;
      }
    }
  }
  if (!bestPriority && bestName) bestPriority = seeds.find((item) => item.username.toLowerCase() === bestName.toLowerCase())?.priority;
  const manualNeighbor = !bestMature && support.some((name) => seeds.find((item) => item.username.toLowerCase() === name)?.sourceType === "manual");
  const supportYields = support.flatMap((name) => {
    const seed = seeds.find((item) => item.username.toLowerCase() === name);
    if (!seed || seed.inspected < minSample || seed.inspected <= 0) return [];
    return [seed.review / seed.inspected];
  });
  const seeded = candidate.source === "seed_suggestion" || candidate.source === "seed_network";
  const priority = scoreCandidate({
    source: seeded ? "seed" : candidate.source === "home_feed" ? "home_feed" : "suggested_accounts",
    sourceDetail: candidate.source,
    seedUsername: bestName,
    seedYield: bestYield,
    seedMature: bestMature,
    seedApprovalYield: bestApproval,
    seedOrigin: manualNeighbor ? "manual" : null,
    seedPriority: bestPriority,
    seedSupportCount: support.length,
    username: candidate.username,
    text: candidate.displayName,
    cardText: candidate.cardText,
    positiveKeywords: config.positiveKeywords ?? [],
    negativeKeywords: config.negativeKeywords ?? [],
    tuning: config.tuning,
    learned: config.learnedQuality ?? null,
    sourceReviewYield: config.sourceYields?.[candidate.source] ?? null,
    sourceApprovalYield: config.sourceApprovalYields?.[candidate.source] ?? null,
    supportYields,
  });
  return {
    ...candidate,
    seedSupport: support,
    sourcesSeen: candidate.sourcesSeen ?? [candidate.source],
    priorityScore: priority.score,
    priorityLabel: priority.label,
    priorityReasons: priority.reasons,
    networkScore: priority.network,
    nicheComponent: priority.niche,
    commercialComponent: priority.commercial,
    seedReviewYield: bestMature ? bestYield : null,
    seedApprovalYield: bestMature ? bestApproval : null,
    seedMature: bestMature,
    sourceReviewYield: config.sourceYields?.[candidate.source] ?? null,
    sourceApprovalYield: config.sourceApprovalYields?.[candidate.source] ?? null,
    sourcePriorPoints: priority.sourcePriorPoints,
  };
}

function poolLimits(config: CloudConfig | null) {
  const tuning = clampTuning(config?.tuning);
  const target = tuning.poolTarget || CANDIDATE_POOL_TARGET;
  return {
    target,
    lowWater: Math.min(target, Math.max(1, tuning.poolLowWater)),
    highWater: Math.max(target, tuning.poolHighWater),
  };
}

function exhaustionDurations(config: CloudConfig) {
  const tuning = clampTuning(config.tuning);
  return {
    first: tuning.seedCooldownFirstMinutes,
    second: tuning.seedCooldownSecondMinutes,
    third: tuning.seedCooldownThirdMinutes,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
