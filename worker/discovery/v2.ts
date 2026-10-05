import fs from "node:fs";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import type { CloudClient, CloudConfig } from "../cloud/client";
import { QualificationQueue } from "./qualify-queue";
import { CandidateQueue, SessionUsernameCache, chunkUsernames, unseenUsernames, type DiscoveryCandidate } from "./queue";
import { prioritizeCandidates } from "./sources";
import { AttentionError } from "../instagram/errors";
import { ensureHome, readProfile, scrollFeed } from "../instagram/actions";
import { feedCandidates, isAuthenticatedHome, pageSignal, suggestedCandidates } from "../instagram/interpret";
import { isExcludedRelationship } from "../instagram/parse";
import { readDom } from "../instagram/read-dom";
import { log } from "../logger";
import { discoveryQueuePath } from "../paths";
import {
  acquisitionDecision,
  formatHourlyWaitEvent,
  getDiscoveryHourlyState,
  queueThresholds,
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
};

const PROFILE_TABS = ["profile-tab-1", "profile-tab-2"] as const;

export function emptyEfficiency(): CloudEfficiency {
  return {
    candidatesFound: 0,
    duplicateBatches: 0,
    skippedFromCache: 0,
    profilesOpened: 0,
    prospectsCreated: 0,
    qualificationRequests: 0,
    cloudRequests: 0,
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
  gate?: (input: { inspections: number; ai: number; emptyCycles: number }) => Promise<{ pause: boolean; reason: string | null } | null>;
  profilePages?: [Page, Page];
  retainTabs?: boolean;
  shouldYield?: () => boolean | Promise<boolean>;
  browserLock?: { tryAcquire: (owner: "discovery") => boolean; release: (owner: "discovery") => void };
}) {
  const metrics = input.metrics ?? emptyEfficiency();
  const queue = new CandidateQueue(10);
  let latestConfig: CloudConfig | null = null;
  const cache = new SessionUsernameCache();
  restoreQueue(queue);
  const failures = new Map<string, number>(PROFILE_TABS.map((tab) => [tab, 0]));
  let stopError: unknown = null;
  let pauseReason: string | null = null;
  let sinceGate = 0;
  let aiSinceGate = 0;
  let emptyCycles = 0;
  let acquisitionHeld = false;
  let hourlyNoticeAt = 0;
  let exitReason: "hourly" | "yield" | "stopped" | "done" = "done";
  const qualify = new QualificationQueue(3, async (prospectId) => {
      metrics.qualificationRequests += 1;
      try {
      const result = await input.cloud.qualifyProspect(prospectId);
      if (!(result.skipped)) aiSinceGate += 1;
      if (result.ok && !result.skipped) input.stats.qualified += 1;
    } catch (error) {
      if (isAttention(error)) throw error;
      log("warn", "qualification_request_failed", { prospect_id: prospectId, message: error instanceof Error ? error.message : "failed" });
    }
  });
  const tabs = input.profilePages
    ? PROFILE_TABS.map((id, index) => ({ id, page: input.profilePages![index] }))
    : [] as Array<{ id: (typeof PROFILE_TABS)[number]; page: Page }>;
  try {
    if (!input.profilePages) {
      for (const id of PROFILE_TABS) {
        tabs.push({ id, page: await input.context.newPage() });
      }
    }
    latestConfig = await input.cloud.config();
    await Promise.all([
      collectLoop(),
      ...tabs.map((tab) => inspectLoop(tab.id, tab.page)),
    ]);
  } catch (error) {
    stopError = error;
  } finally {
    persistQueue(queue);
    await qualify.drain().catch(() => undefined);
    if (!input.retainTabs) await Promise.all(tabs.map((tab) => tab.page.close().catch(() => undefined)));
  }
  if (stopError) throw stopError;
  return exitReason;

  async function collectLoop() {
    let idleScrolls = 0;
    let announcedSource = "";
    while (!finished()) {
      const config = await input.cloud.config();
      latestConfig = config;
      if (!config.discoveryEnabled) {
        input.live.task = "idle";
        await sleep(5_000);
        continue;
      }
      queue.setTarget(config.candidateQueueTarget);
      const pace = hourPace();
      if (pace.limited) {
        announceHourly(pace);
        exitReason = "hourly";
        return;
      }
      if (await input.shouldYield?.()) {
        exitReason = "yield";
        return;
      }
      const thresholds = queueThresholds(config.candidateQueueTarget);
      const acquisition = acquisitionDecision({
        pending: queue.pendingCount(),
        highWater: thresholds.highWater,
        lowWater: thresholds.lowWater,
        holding: acquisitionHeld,
        hourlyFull: false,
      });
      acquisitionHeld = acquisition.holding;
      publish(config, null);
      if (!acquisition.acquire) {
        input.live.task = qualify.activeCount > 0 ? "qualifying_profiles" : "inspecting_profiles";
        if (!input.shouldYield) await input.maybeOutreach?.().catch(() => undefined);
        await sleep(500);
        continue;
      }
      input.live.task = "discovering_candidates";
      const dom = await readDiscoveryPage(input.homePage);
      const suggested = suggestedCandidates(dom);
      const home = feedCandidates(dom);
      const ordered = prioritizeCandidates({
        suggested,
        home,
        priority: config.discoverySourcePriority,
        homeEnabled: config.homeFeedEnabled,
        suggestedEnabled: config.suggestedAccountsEnabled,
      });
      const sourceLabel = config.suggestedAccountsEnabled && config.discoverySourcePriority !== "home_first"
        ? "Suggested Accounts"
        : "Home Feed";
      if (announcedSource !== sourceLabel) {
        announcedSource = sourceLabel;
        console.log(`Discovery source: ${sourceLabel}`);
      }
      const { fresh, skippedFromCache } = unseenUsernames(ordered.map((item) => item.username), cache, queue);
      metrics.candidatesFound += fresh.length;
      metrics.skippedFromCache += skippedFromCache;
      if (skippedFromCache > 0) log("info", "candidate_duplicate_session", { count: skippedFromCache });
      const byUsername = new Map(ordered.map((item) => [item.username, item]));
      let queued = 0;
      if (!input.noWrite) {
        let filled = false;
        for (const chunk of chunkUsernames(fresh, 15)) {
          if (filled) break;
          metrics.duplicateBatches += 1;
          const checked = await input.cloud.checkProspects(chunk);
          for (const row of checked.results) {
            const username = row.username ?? "";
            cache.remember(username, row.skip);
            if (row.skip) {
              log("info", "candidate_duplicate_cloud", { username, status: row.status });
              continue;
            }
            const candidate = byUsername.get(username);
            if (!candidate) continue;
            if (queue.pendingCount() >= queueThresholds(config.candidateQueueTarget).highWater) {
              filled = true;
              break;
            }
            if (queue.enqueue(candidate) === "queued") {
              queued += 1;
              console.log(`Queued @${candidate.username}`);
              log("info", "candidate_queued", { username: candidate.username, source: candidate.source });
            }
          }
        }
      } else {
        for (const username of fresh) {
          if (queue.pendingCount() >= queueThresholds(config.candidateQueueTarget).highWater) break;
          const candidate = byUsername.get(username);
          if (candidate && queue.enqueue(candidate) === "queued") queued += 1;
        }
      }
      publish(config, sourceLabel);
      if (queued === 0) {
        emptyCycles += 1;
        idleScrolls += 1;
        if (idleScrolls >= 4 && queue.pendingCount() === 0 && queue.inProgress().length === 0) {
          await sleep(config.discoveryScrollDelaySeconds * 1000);
        }
      } else {
        emptyCycles = 0;
        idleScrolls = 0;
      }
      if (queue.pendingCount() < queueThresholds(config.candidateQueueTarget).highWater) {
        await scrollFeed(input.homePage);
        await sleep(config.discoveryScrollDelaySeconds * 1000);
      }
      if (!input.shouldYield) await input.maybeOutreach?.().catch(() => undefined);
    }
  }

  async function inspectLoop(tabId: (typeof PROFILE_TABS)[number], page: Page) {
    while (!finished()) {
      if (await input.shouldYield?.()) {
        exitReason = "yield";
        return;
      }
      const pace = hourPace();
      if (pace.limited) {
        announceHourly(pace);
        exitReason = "hourly";
        return;
      }
      const candidate = queue.claim(tabId);
      if (!candidate) {
        await sleep(300);
        continue;
      }
      const reserved = reserveInspectionSlot({
        stamps: input.stats.hour,
        now: Date.now(),
        limit: pace.limit,
      });
      rememberHour(reserved.state.stamps);
      if (!reserved.ok) {
        queue.release(candidate.username);
        announceHourly(reserved.state);
        exitReason = "hourly";
        return;
      }
      if (finished()) {
        queue.release(candidate.username);
        rememberHour(releaseInspectionSlot(input.stats.hour, reserved.reservedAt));
        return;
      }
      input.stats.seen += 1;
      metrics.profilesOpened += 1;
      sinceGate += 1;
      if (sinceGate >= 5) await consultGate();
      input.live.task = "inspecting_profiles";
      input.live.username = candidate.username;
      console.log(`${tabId} → @${candidate.username}`);
      log("info", tabId === "profile-tab-1" ? "candidate_claimed_tab_a" : "candidate_claimed_tab_b", {
        username: candidate.username,
      });
      if (input.browserLock && !input.browserLock.tryAcquire("discovery")) {
        queue.release(candidate.username);
        rememberHour(releaseInspectionSlot(input.stats.hour, reserved.reservedAt));
        exitReason = "yield";
        return;
      }
      try {
        await inspectCandidate(page, candidate);
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
    }
  }

  async function inspectCandidate(page: Page, candidate: DiscoveryCandidate) {
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
      source: candidate.source,
      follow_relationship: profile.relationship,
    });
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
      input.live.lastEvent = formatDiscoveryStatus({
        source,
        pending: queue.pendingCount(),
        tab1: active.get("profile-tab-1") ?? null,
        tab2: active.get("profile-tab-2") ?? null,
        hour: `${pace.count}/${pace.limit}`,
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

  function announceHourly(pace: ReturnType<typeof hourPace>) {
    input.live.task = "discovery_hourly_wait";
    if (pace.nextEligibleAt == null || hourlyNoticeAt === pace.nextEligibleAt) return;
    const resumesAt = pace.nextEligibleAt;
    hourlyNoticeAt = resumesAt;
    input.live.lastEvent = formatHourlyWaitEvent({ count: pace.count, limit: pace.limit, resumesAt });
  }

  function sessionCap() {
    if (input.inspectionLimit != null) return input.inspectionLimit;
    return latestConfig?.sessionInspectionCap ?? latestConfig?.maxProfilesPerSession ?? 50;
  }

  async function consultGate() {
    if (!input.gate) return;
    const inspections = sinceGate;
    const ai = aiSinceGate;
    sinceGate = 0;
    aiSinceGate = 0;
    try {
      const result = await input.gate({ inspections, ai, emptyCycles });
      if (result?.pause) {
        pauseReason = result.reason;
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

function restoreQueue(queue: CandidateQueue) {
  try {
    const raw = fs.readFileSync(discoveryQueuePath(), "utf8");
    const parsed = JSON.parse(raw) as { pending?: DiscoveryCandidate[] };
    for (const candidate of parsed.pending ?? []) queue.enqueue(candidate);
  } catch {
    // A missing queue file is the normal first run.
  }
}

function persistQueue(queue: CandidateQueue) {
  try {
    fs.mkdirSync(path.dirname(discoveryQueuePath()), { recursive: true });
    fs.writeFileSync(
      discoveryQueuePath(),
      JSON.stringify({ pending: queue.pendingCandidates(), seen: queue.seenUsernames() }),
    );
  } catch {
    // Shutdown persistence is best-effort.
  }
}

function isAttention(error: unknown) {
  return error instanceof AttentionError;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
