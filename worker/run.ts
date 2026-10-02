import { launchBrowser } from "./browser/launch";
import { CloudClient, type CloudConfig, type JobPayload } from "./cloud/client";
import { loadIdentity } from "./identity";
import {
  ensureHome,
  followProfile,
  readProfile,
  saveErrorScreenshot,
  scrollFeed,
  sendExactMessage,
} from "./instagram/actions";
import { AttentionError, NavigationError, SelectorError } from "./instagram/errors";
import { isExcludedRelationship } from "./instagram/parse";
import { log } from "./logger";
import { forgetPending, readPending, rememberPending } from "./pending-results";
import { browserProfileDir } from "./paths";

export type RunMode = "agent" | "smoke" | "login";

let stopRequested = false;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (stopRequested || Date.now() - started >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, 250);
  });

export async function runWorker(mode: RunMode) {
  const discoveryOnly = process.argv.includes("--discovery-only") || mode === "smoke";
  const noWrite = process.argv.includes("--no-write") || mode === "smoke" || mode === "login";
  const baseUrl = process.env.OUTREACH_APP_URL?.trim().replace(/\/$/, "");
  const secret = process.env.WORKER_API_SECRET?.trim();
  if (!baseUrl || !secret) {
    console.error("Set OUTREACH_APP_URL and WORKER_API_SECRET in .env.local.");
    process.exitCode = 1;
    return;
  }

  const identity = loadIdentity();
  const cloud = new CloudClient(baseUrl, secret);
  let stopping = false;
  const stop = () => {
    stopping = true;
    stopRequested = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  printBanner(identity, baseUrl);
  const { context, page } = await launchBrowser();
  console.log("✓ Browser launched");
  const stats = { seen: 0, ingested: 0, excluded: 0, qualified: 0, hour: [] as number[] };
  let backoff = 5_000;
  let announced = false;

  try {
    await flushPending(cloud, identity.worker_id);
    if (mode === "login") {
      await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "domcontentloaded" });
      console.log("Sign in to Instagram in the browser window. The session stays in this browser profile.");
      while (!stopping) await sleep(1000);
      return;
    }

    while (!stopping) {
      try {
        await flushPending(cloud, identity.worker_id);
        const config = await cloud.config();
        backoff = 5_000;
        if (!announced) {
          console.log("✓ Worker API authenticated");
          console.log("✓ Automation configuration loaded");
          console.log(config.discoveryEnabled ? "Discovery: ON" : "Discovery: OFF");
          console.log(config.automationEnabled ? "Outreach: RUNNING" : "Outreach: PAUSED");
          announced = true;
        }
        if (!config.workerEnabled && mode !== "smoke") {
          await beat(cloud, identity, "paused", stats, false, true);
          console.log("Worker is disabled in Settings. Waiting.");
          await sleep(config.heartbeatIntervalSeconds * 1000);
          continue;
        }
        if (mode !== "smoke" && !discoveryOnly && !noWrite) {
          const worked = await runOneJob(cloud, page, identity, config, stats);
          if (worked) continue;
        }
        if (mode === "smoke") {
          const posts = await ensureHome(page);
          console.log(`Authenticated: yes`);
          console.log(`Home feed visible: yes`);
          console.log(`Visible candidate posts: ${posts.length}`);
          console.log("Worker API: connected");
          return;
        }
        if (config.discoveryEnabled && !stopping && stats.seen < config.maxProfilesPerSession) {
          await beat(cloud, identity, "discovering_home_feed", stats, true, true);
          await discoverBatch(cloud, page, identity.worker_id, config, stats, noWrite);
          await sleep(Math.max(config.heartbeatIntervalSeconds, 20) * 1000);
        } else {
          await beat(cloud, identity, "idle", stats, true, true);
          if (stats.seen >= config.maxProfilesPerSession) console.log("Session profile limit reached. Waiting.");
          await sleep(Math.max(config.heartbeatIntervalSeconds, 20) * 1000);
        }
      } catch (error) {
        if (error instanceof AttentionError) {
          console.log(error.message);
          await beat(cloud, identity, error.code === "login_required" ? "auth_required" : "attention_required", stats, true, false, error.message).catch(() => undefined);
          if (mode === "smoke") {
            console.log("Authenticated: no");
            return;
          }
          await sleep(15_000);
          continue;
        }
        const message = error instanceof Error ? error.message : "Cloud connection unavailable. Retrying...";
        const offline = /fetch|network|ECONN|ENOTFOUND|timed out/i.test(message);
        console.log(offline ? "Cloud connection unavailable. Retrying..." : message);
        log("error", "worker_loop", { message });
        await saveErrorScreenshot(page, "loop").catch(() => undefined);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  } finally {
    await beat(cloud, identity, "offline", stats, false, false).catch(() => undefined);
    await context.close().catch(() => undefined);
  }
}

async function runOneJob(
  cloud: CloudClient,
  page: import("playwright").Page,
  identity: ReturnType<typeof loadIdentity>,
  config: CloudConfig,
  stats: { seen: number; ingested: number; excluded: number; qualified: number },
) {
  if (!config.automationEnabled) return false;
  const next = await cloud.nextJob(identity.worker_id);
  if (!next.job) return false;
  const job = next.job;
  await beat(cloud, identity, `executing_${job.type}`, stats, true, true);
  await cloud.startJob(job.id, identity.worker_id);
  try {
    const result = await executeJob(page, job);
    await reportComplete(cloud, identity.worker_id, job.id, result);
    return true;
  } catch (error) {
    if (error instanceof AttentionError) {
      await reportFailure(cloud, identity.worker_id, job.id, error.code, error.message, false);
      throw error;
    }
    if (error instanceof NavigationError) {
      await reportFailure(cloud, identity.worker_id, job.id, error.code, error.message, job.type === "verify_profile");
      return true;
    }
    const message = error instanceof Error ? error.message : "The browser action failed.";
    await saveErrorScreenshot(page, job.type).catch(() => undefined);
    const retryable = job.type === "verify_profile" && error instanceof SelectorError;
    await reportFailure(
      cloud,
      identity.worker_id,
      job.id,
      error instanceof SelectorError ? "browser_error" : "unknown",
      message,
      retryable,
    );
    return true;
  }
}

async function executeJob(page: import("playwright").Page, job: JobPayload) {
  if (job.type === "verify_profile") {
    const profile = await readProfile(page, job.instagramUsername);
    return {
      profileExists: profile.profileExists,
      alreadyFollowing: isExcludedRelationship(profile.relationship),
      relationshipStatus: profile.relationship,
      observedUsername: profile.profile.username,
    };
  }
  if (job.type === "follow_profile") return followProfile(page, job.instagramUsername);
  if (!job.message) throw new SelectorError("The send job did not include the locked message.");
  return sendExactMessage(page, job.instagramUsername, job.message);
}

async function discoverBatch(
  cloud: CloudClient,
  page: import("playwright").Page,
  workerId: string,
  config: CloudConfig,
  stats: { seen: number; ingested: number; excluded: number; qualified: number; hour: number[] },
  noWrite: boolean,
) {
  let idleScrolls = 0;
  const seen = new Set<string>();
  while (stats.seen < config.maxProfilesPerSession && idleScrolls < 3) {
    const posts = await ensureHome(page);
    const fresh = posts.filter((post) => !seen.has(post.username));
    if (fresh.length === 0) {
      idleScrolls += 1;
      await scrollFeed(page);
      await sleep(config.discoveryScrollDelaySeconds * 1000);
      continue;
    }
    idleScrolls = 0;
    for (const post of fresh) {
      if (stats.seen >= config.maxProfilesPerSession) break;
      pruneHour(stats.hour);
      if (stats.hour.length >= config.maxProfilesPerHour) return;
      seen.add(post.username);
      stats.seen += 1;
      stats.hour.push(Date.now());
      log("info", "profile_seen", { worker_id: workerId, username: post.username, mode: "discovery" });
      if (noWrite) continue;
      try {
        const known = await cloud.checkProspect(post.username);
        if (known.skip) {
          log("info", "profile_duplicate", { worker_id: workerId, username: post.username });
          continue;
        }
        const profile = await readProfile(page, post.username);
        if (!profile.profileExists) continue;
        const excluded = isExcludedRelationship(profile.relationship);
        const ingested = await cloud.ingestProspect({
          instagram_username: post.username,
          display_name: profile.profile.displayName,
          profile_url: post.profileUrl,
          profile_picture_url: profile.profile.profilePictureUrl,
          bio: profile.profile.bio,
          follower_count: profile.profile.followerCount,
          following_count: profile.profile.followingCount,
          already_following: excluded,
          instagram_post_url: post.postUrl,
          source: "home_feed",
        });
        if (excluded) {
          stats.excluded += 1;
          log("info", "profile_excluded_existing_follow", { worker_id: workerId, username: post.username });
          continue;
        }
        if (profile.relationship === "unknown" || !ingested.prospectId) continue;
        stats.ingested += 1;
        log("info", "profile_ingested", { worker_id: workerId, username: post.username });
        const qualified = await cloud.qualifyProspect(ingested.prospectId);
        if (qualified.ok && !qualified.skipped) stats.qualified += 1;
        log("info", "profile_qualification_requested", { worker_id: workerId, username: post.username });
        await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" }).catch(() => undefined);
      } catch (error) {
        if (error instanceof AttentionError) throw error;
        const message = error instanceof Error ? error.message : "Profile discovery failed.";
        log("error", "profile_discovery_error", {
          worker_id: workerId,
          username: post.username,
          mode: "discovery",
          message,
          error_category: error instanceof NavigationError ? error.code : "discovery",
        });
        await saveErrorScreenshot(page, "discovery").catch(() => undefined);
      }
    }
    await scrollFeed(page);
    await sleep(config.discoveryScrollDelaySeconds * 1000);
  }
}

async function reportComplete(cloud: CloudClient, workerId: string, jobId: string, result: Record<string, unknown>) {
  try {
    await cloud.completeJob(jobId, workerId, result);
    forgetPending(jobId);
  } catch {
    rememberPending({ jobId, workerId, kind: "complete", body: { result }, createdAt: new Date().toISOString() });
    log("warn", "pending_result_stored", { job_id: jobId });
  }
}

async function reportFailure(
  cloud: CloudClient,
  workerId: string,
  jobId: string,
  errorCode: string,
  errorMessage: string,
  retryable: boolean,
) {
  const body = { error_code: errorCode, error_message: errorMessage.slice(0, 500), retryable };
  try {
    await cloud.failJob(jobId, workerId, body);
    forgetPending(jobId);
  } catch {
    rememberPending({ jobId, workerId, kind: "fail", body, createdAt: new Date().toISOString() });
  }
}

async function flushPending(cloud: CloudClient, workerId: string) {
  for (const pending of readPending()) {
    try {
      if (pending.kind === "complete") {
        await cloud.completeJob(pending.jobId, workerId, (pending.body.result as Record<string, unknown>) ?? {});
      } else {
        await cloud.failJob(pending.jobId, workerId, pending.body);
      }
      forgetPending(pending.jobId);
    } catch (error) {
      const status = error instanceof Error && "statusCode" in error ? Number(error.statusCode) : 0;
      if (status === 409 || status === 404) forgetPending(pending.jobId);
    }
  }
}

async function beat(
  cloud: CloudClient,
  identity: ReturnType<typeof loadIdentity>,
  task: string,
  stats: { seen: number; ingested: number; excluded: number; qualified: number },
  browserConnected: boolean,
  instagramAuthenticated: boolean,
  attention?: string,
) {
  const status = task === "offline" ? "offline" : task === "attention_required" || task === "auth_required" ? "attention_required" : "online";
  await cloud.heartbeat({
    worker_id: identity.worker_id,
    machine_name: identity.machine_name,
    platform: identity.platform === "win32" || identity.platform === "linux" ? identity.platform : "darwin",
    hostname: identity.hostname,
    status,
    current_task: task,
    browser_connected: browserConnected,
    instagram_authenticated: instagramAuthenticated,
    attention_reason: attention ?? null,
    profiles_seen: stats.seen,
    profiles_ingested: stats.ingested,
    profiles_excluded_following: stats.excluded,
    profiles_qualified: stats.qualified,
  });
}

function pruneHour(hour: number[]) {
  const cutoff = Date.now() - 60 * 60 * 1000;
  while (hour.length > 0 && hour[0] < cutoff) hour.shift();
}

function printBanner(identity: ReturnType<typeof loadIdentity>, baseUrl: string) {
  console.log("ShootPortal Outreach Agent");
  console.log("--------------------------");
  console.log(`Worker: ${identity.machine_name}`);
  console.log(`Platform: ${identity.platform}`);
  console.log(`Dashboard: ${baseUrl}`);
  console.log(`Browser profile: ${browserProfileDir()}`);
}
