import { launchBrowser } from "./browser/launch";
import { CloudClient, type CloudConfig, type JobPayload } from "./cloud/client";
import { loadIdentity } from "./identity";
import {
  ensureHome,
  followProfile,
  previewOutreach,
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
import { AUTH_FAILURE_MESSAGE, VERSION_MISMATCH_MESSAGE, WORKER_VERSION } from "./version";

export type RunMode = "agent" | "smoke" | "login";

let stopRequested = false;
let openedSession = false;

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
  const dryRun = process.argv.includes("--outreach-dry-run");
  const singleOutreach = process.argv.includes("--single-outreach");
  const debug = process.argv.includes("--debug");
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

  openedSession = false;
  printBanner(identity, baseUrl);
  let startup: CloudConfig;
  try {
    startup = await cloud.config();
  } catch (error) {
    if (isAuthFailure(error)) return;
    console.error(error instanceof Error ? error.message : "Cloud connection unavailable.");
    process.exitCode = 1;
    return;
  }
  console.log("✓ Cloud connected");
  console.log("✓ Worker authenticated");
  if (startup.minSupportedWorkerVersion && startup.minSupportedWorkerVersion !== WORKER_VERSION) {
    console.error(VERSION_MISMATCH_MESSAGE);
    process.exitCode = 1;
    return;
  }
  console.log("✓ Version compatible");
  const { context, page } = await launchBrowser();
  console.log("✓ Chrome available");
  console.log("✓ Browser launched");
  const stats = { seen: 0, ingested: 0, excluded: 0, qualified: 0, errors: 0, hour: [] as number[] };
  const live = {
    task: "idle",
    username: null as string | null,
    lastEvent: null as string | null,
    browserConnected: true,
    instagramAuthenticated: false,
    attention: undefined as string | undefined,
  };
  const timer = setInterval(() => {
    beat(cloud, identity, live.task, stats, live.browserConnected, live.instagramAuthenticated, live.attention, live.username, live.lastEvent).catch(() => undefined);
  }, Math.max(startup.heartbeatIntervalSeconds, 15) * 1000);
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
          console.log("✓ Automation configuration loaded");
          console.log(config.discoveryEnabled ? "✓ Discovery ON" : "Discovery: OFF");
          console.log(config.automationEnabled ? "Outreach: RUNNING" : "✓ Outreach PAUSED");
          if (debug) console.log("Debug logging is on.");
          announced = true;
        }
        if (dryRun) {
          await runDryOutreach(cloud, page);
          return;
        }
        if (singleOutreach) {
          await runSingleOutreach(cloud, page, identity, stats, live);
          return;
        }
        if (!config.workerEnabled && mode !== "smoke") {
          live.task = "paused";
          await beat(cloud, identity, live.task, stats, false, live.instagramAuthenticated, live.attention, live.username, live.lastEvent);
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
        if (config.discoveryEnabled && !stopping && stats.seen < config.maxProfilesPerSession && !singleOutreach) {
          live.task = "discovering_home_feed";
          live.instagramAuthenticated = true;
          await beat(cloud, identity, live.task, stats, true, true, live.attention, live.username, live.lastEvent);
          await discoverBatch(cloud, page, identity.worker_id, config, stats, noWrite, live);
          await sleep(Math.max(config.heartbeatIntervalSeconds, 20) * 1000);
        } else {
          live.task = "idle";
          await beat(cloud, identity, live.task, stats, true, true, live.attention, live.username, live.lastEvent);
          if (stats.seen >= config.maxProfilesPerSession) console.log("Session profile limit reached. Waiting.");
          await sleep(Math.max(config.heartbeatIntervalSeconds, 20) * 1000);
        }
      } catch (error) {
        if (isAuthFailure(error)) return;
        if (error instanceof AttentionError) {
          console.log(error.message);
          live.task = error.code === "login_required" ? "auth_required" : "attention_required";
          live.attention = error.message;
          live.instagramAuthenticated = false;
          await beat(cloud, identity, live.task, stats, true, false, error.message, live.username, live.lastEvent).catch(() => undefined);
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
    clearInterval(timer);
    live.task = "offline";
    live.browserConnected = false;
    live.username = null;
    await beat(cloud, identity, "offline", stats, false, false, live.attention, null, "Worker stopped.").catch(() => undefined);
    await context.close().catch(() => undefined);
  }
}

async function runOneJob(
  cloud: CloudClient,
  page: import("playwright").Page,
  identity: ReturnType<typeof loadIdentity>,
  config: CloudConfig,
  stats: { seen: number; ingested: number; excluded: number; qualified: number; errors: number },
) {
  if (!config.automationEnabled) return false;
  const next = await cloud.nextJob(identity.worker_id);
  if (!next.job) return false;
  const job = next.job;
  await beat(cloud, identity, `executing_${job.type}`, stats, true, true, undefined, job.instagramUsername, null);
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
  stats: { seen: number; ingested: number; excluded: number; qualified: number; errors: number; hour: number[] },
  noWrite: boolean,
  live: { username: string | null; lastEvent: string | null },
) {
  let idleScrolls = 0;
  const seen = new Set<string>();
  while (stats.seen < config.maxProfilesPerSession && idleScrolls < 3) {
    const posts = await ensureHome(page);
    const fresh = posts.filter((post) => !seen.has(post.username.toLowerCase()));
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
      seen.add(post.username.toLowerCase());
      stats.seen += 1;
      stats.hour.push(Date.now());
      live.username = post.username;
      live.lastEvent = `Opened @${post.username}`;
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
          location_text: profile.profile.locationText,
          already_following: excluded,
          instagram_post_url: post.postUrl,
          source: "home_feed",
          follow_relationship: profile.relationship,
        });
        console.log(`@${post.username}`);
        console.log(`relationship: ${profile.relationship}`);
        console.log(`followers: ${profile.profile.followerCount ?? "unknown"}`);
        console.log(`display_name: ${profile.profile.displayName ?? "unknown"}`);
        console.log(`bio_length: ${profile.profile.bio?.length ?? 0}`);
        if (ingested.created) stats.ingested += 1;
        if (excluded) {
          stats.excluded += 1;
          live.lastEvent = `Skipped @${post.username} because you already follow this account.`;
          log("info", "profile_excluded_existing_follow", { worker_id: workerId, username: post.username });
          continue;
        }
        if (profile.relationship === "unknown" || !ingested.prospectId) {
          live.lastEvent = `Follow status unknown for @${post.username}.`;
          continue;
        }
        log("info", "profile_ingested", { worker_id: workerId, username: post.username });
        const qualified = await qualifyWithRetry(cloud, ingested.prospectId);
        if (qualified.ok && !qualified.skipped) {
          stats.qualified += 1;
          live.lastEvent = `AI scored @${post.username} ${qualified.fitScore ?? ""} ${qualified.fitLabel ?? ""}`.trim();
        }
        console.log(`cloud: ${ingested.created ? "created" : ingested.reason ?? "updated"}`);
        console.log(`AI: ${qualified.fitLabel ?? qualified.status ?? "skipped"} ${qualified.fitScore ?? ""}`.trim());
        log("info", "profile_qualification_requested", { worker_id: workerId, username: post.username });
        await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" }).catch(() => undefined);
      } catch (error) {
        if (error instanceof AttentionError) throw error;
        const status = error instanceof Error && "statusCode" in error ? Number(error.statusCode) : 0;
        if (status === 401) throw error;
        const message = error instanceof Error ? error.message : "Profile discovery failed.";
        stats.errors += 1;
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
  stats: { seen: number; ingested: number; excluded: number; qualified: number; errors: number },
  browserConnected: boolean,
  instagramAuthenticated: boolean,
  attention?: string,
  username?: string | null,
  lastEvent?: string | null,
) {
  const status = task === "offline" ? "offline" : task === "attention_required" || task === "auth_required" ? "attention_required" : "online";
  const first = !openedSession;
  await cloud.heartbeat({
    new_session: first,
    worker_id: identity.worker_id,
    machine_name: identity.machine_name,
    platform: identity.platform === "win32" || identity.platform === "linux" ? identity.platform : "darwin",
    hostname: identity.hostname,
    status,
    current_task: task === "offline" ? "offline" : task,
    browser_connected: browserConnected,
    instagram_authenticated: instagramAuthenticated,
    attention_reason: attention ?? null,
    profiles_seen: stats.seen,
    profiles_ingested: stats.ingested,
    profiles_excluded_following: stats.excluded,
    profiles_qualified: stats.qualified,
    session_errors: stats.errors,
    current_username: username ?? null,
    last_event: lastEvent ?? null,
  });
  openedSession = true;
}

function isAuthFailure(error: unknown) {
  const status = error instanceof Error && "statusCode" in error ? Number(error.statusCode) : 0;
  if (status !== 401) return false;
  console.error(AUTH_FAILURE_MESSAGE);
  process.exitCode = 1;
  return true;
}

async function qualifyWithRetry(cloud: CloudClient, prospectId: string) {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await cloud.qualifyProspect(prospectId);
    } catch (error) {
      if (isAuthFailure(error)) throw error;
      const status = error instanceof Error && "statusCode" in error ? Number(error.statusCode) : 0;
      last = error;
      if (status && status < 500 && status !== 429) throw error;
      await sleep(2_000);
    }
  }
  throw last instanceof Error ? last : new Error("Qualification failed.");
}

async function runDryOutreach(cloud: CloudClient, page: import("playwright").Page) {
  const preview = await cloud.previewJob();
  if (!preview.job) {
    console.log(preview.outreachPaused ? "Outreach is paused. No queued job was available to preview." : "No outreach job is waiting.");
    return;
  }
  console.log(`Preview @${preview.job.instagramUsername} (${preview.job.type})`);
  const result = await previewOutreach(page, preview.job.instagramUsername, preview.job.message ?? null);
  console.log(`Would follow: ${result.wouldFollow ? "yes" : "no"}`);
  console.log(`Would send: ${result.wouldSend ? "yes" : "no"}`);
  console.log(`Relationship: ${result.relationship}`);
  if (result.existingConversation) console.log("Existing Instagram conversation. A cold message would not be sent.");
  if (preview.job.message) {
    console.log("Message:");
    console.log(preview.job.message);
  }
  console.log("Dry run finished. Nothing was followed or sent, and no job was completed.");
}

async function runSingleOutreach(
  cloud: CloudClient,
  page: import("playwright").Page,
  identity: ReturnType<typeof loadIdentity>,
  stats: { seen: number; ingested: number; excluded: number; qualified: number; errors: number },
  live: { task: string; username: string | null },
) {
  const first = await cloud.nextJob(identity.worker_id);
  if (!first.job) {
    console.log("No outreach job is available.");
    return;
  }
  const prospectId = first.job.prospectId;
  let job: JobPayload | null = first.job;
  while (job) {
    live.task = `executing_${job.type}`;
    live.username = job.instagramUsername;
    await cloud.startJob(job.id, identity.worker_id);
    const result = await executeJob(page, job);
    await reportComplete(cloud, identity.worker_id, job.id, result);
    console.log(`Completed ${job.type} for @${job.instagramUsername}.`);
    const next = await cloud.nextJob(identity.worker_id, prospectId);
    job = next.job && next.job.prospectId === prospectId ? next.job : null;
  }
  console.log("Single outreach finished.");
  void stats;
}

export async function inspectUsername(rawUsername: string) {
  const username = rawUsername.replace(/^@/, "").trim().toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(username)) {
    console.error("Provide one Instagram username, for example fpv_teams.");
    process.exitCode = 1;
    return null;
  }
  const baseUrl = process.env.OUTREACH_APP_URL?.trim().replace(/\/$/, "");
  const secret = process.env.WORKER_API_SECRET?.trim();
  if (!baseUrl || !secret) {
    console.error("Set OUTREACH_APP_URL and WORKER_API_SECRET in .env.local.");
    process.exitCode = 1;
    return null;
  }
  const cloud = new CloudClient(baseUrl, secret);
  try {
    const startup = await cloud.config();
    if (startup.minSupportedWorkerVersion && startup.minSupportedWorkerVersion !== WORKER_VERSION) {
      console.error(VERSION_MISMATCH_MESSAGE);
      process.exitCode = 1;
      return null;
    }
  } catch (error) {
    if (isAuthFailure(error)) return null;
    console.error(error instanceof Error ? error.message : "Cloud connection unavailable.");
    process.exitCode = 1;
    return null;
  }
  const { context, page } = await launchBrowser();
  try {
    const result = await readProfile(page, username, { debug: true });
    console.log("Inspect finished. Nothing was saved, followed, or messaged.");
    return result;
  } finally {
    await context.close().catch(() => undefined);
  }
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
