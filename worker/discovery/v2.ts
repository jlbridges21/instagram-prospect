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
}) {
  const metrics = input.metrics ?? emptyEfficiency();
  const queue = new CandidateQueue(10);
  let latestConfig: CloudConfig | null = null;
  const cache = new SessionUsernameCache();
  restoreQueue(queue);
  const failures = new Map<string, number>(PROFILE_TABS.map((tab) => [tab, 0]));
  let stopError: unknown = null;
  const qualify = new QualificationQueue(3, async (prospectId) => {
      metrics.qualificationRequests += 1;
      try {
      const result = await input.cloud.qualifyProspect(prospectId);
      if (result.ok && !result.skipped) input.stats.qualified += 1;
    } catch (error) {
      if (isAttention(error)) throw error;
      log("warn", "qualification_request_failed", { prospect_id: prospectId, message: error instanceof Error ? error.message : "failed" });
    }
  });
  const tabs = [] as Array<{ id: (typeof PROFILE_TABS)[number]; page: Page }>;
  try {
    for (const id of PROFILE_TABS) {
      tabs.push({ id, page: await input.context.newPage() });
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
    await Promise.all(tabs.map((tab) => tab.page.close().catch(() => undefined)));
  }
  if (stopError) throw stopError;

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
      publish(config, null);
      if (!queue.needsRefill()) {
        input.live.task = qualify.activeCount > 0 ? "qualifying_profiles" : "inspecting_profiles";
        await input.maybeOutreach?.().catch(() => undefined);
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
        for (const chunk of chunkUsernames(fresh, 15)) {
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
            if (queue.enqueue(candidate) === "queued") {
              queued += 1;
              console.log(`Queued @${candidate.username}`);
              log("info", "candidate_queued", { username: candidate.username, source: candidate.source });
            }
          }
        }
      } else {
        for (const username of fresh) {
          const candidate = byUsername.get(username);
          if (candidate && queue.enqueue(candidate) === "queued") queued += 1;
        }
      }
      publish(config, sourceLabel);
      if (queued === 0) {
        idleScrolls += 1;
        if (idleScrolls >= 4 && queue.pendingCount() === 0 && queue.inProgress().length === 0) {
          await sleep(config.discoveryScrollDelaySeconds * 1000);
        }
      } else {
        idleScrolls = 0;
      }
      if (queue.needsRefill()) {
        await scrollFeed(input.homePage);
        await sleep(config.discoveryScrollDelaySeconds * 1000);
      }
      await input.maybeOutreach?.().catch(() => undefined);
    }
  }

  async function inspectLoop(tabId: (typeof PROFILE_TABS)[number], page: Page) {
    while (!finished()) {
      const candidate = queue.claim(tabId);
      if (!candidate) {
        await sleep(300);
        continue;
      }
      if (finished()) {
        queue.release(candidate.username);
        return;
      }
      if (hourFull()) {
        queue.release(candidate.username);
        await sleep(15_000);
        continue;
      }
      input.stats.seen += 1;
      input.stats.hour.push(Date.now());
      metrics.profilesOpened += 1;
      input.live.task = "inspecting_profiles";
      input.live.username = candidate.username;
      console.log(`${tabId} → @${candidate.username}`);
      log("info", tabId === "profile-tab-1" ? "candidate_claimed_tab_a" : "candidate_claimed_tab_b", {
        username: candidate.username,
      });
      try {
        await inspectCandidate(page, candidate);
        queue.complete(candidate.username, "done");
        failures.set(tabId, 0);
        log("info", "candidate_completed", { username: candidate.username, tab: tabId });
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
    input.live.lastEvent = formatDiscoveryStatus({
      source,
      pending: queue.pendingCount(),
      tab1: active.get("profile-tab-1") ?? null,
      tab2: active.get("profile-tab-2") ?? null,
    });
  }

  function sessionCap() {
    const configured = latestConfig?.maxProfilesPerSession ?? 50;
    return input.inspectionLimit === null ? configured : Math.min(configured, input.inspectionLimit);
  }

  function finished() {
    if (input.shouldStop() || stopError) return true;
    return input.stats.seen >= sessionCap();
  }

  function hourFull() {
    const hourAgo = Date.now() - 60 * 60 * 1000;
    input.stats.hour = input.stats.hour.filter((stamp) => stamp >= hourAgo);
    return input.stats.hour.length >= (latestConfig?.maxProfilesPerHour ?? 30);
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
