import { launchBrowser } from "./browser/launch";
import { CloudClient, type CloudConfig, type JobPayload } from "./cloud/client";
import { emptyEfficiency, formatEfficiency, runDiscoveryV2 } from "./discovery/v2";
import { loadIdentity } from "./identity";
import { dryRunPlan, formatDryRun } from "../lib/outreach/dry-run-plan";
import {
  ensureHome,
  followProfile,
  readProfile,
  saveErrorScreenshot,
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
  const discoveryOnly = process.argv.includes("--discovery-only") || process.argv.includes("--discovery-v2-test") || mode === "smoke";
  const discoveryV2Test = process.argv.includes("--discovery-v2-test");
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
  const efficiency = emptyEfficiency();
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
        if (config.discoveryEnabled && !stopping && stats.seen < (discoveryV2Test ? 10 : config.maxProfilesPerSession) && !singleOutreach) {
          live.task = "discovering_candidates";
          live.instagramAuthenticated = true;
          if (discoveryV2Test) console.log("Discovery V2 test. Outreach stays paused. Inspecting up to 10 profiles.");
          let outreachPage: import("playwright").Page | null = null;
          await runDiscoveryV2({
            context,
            homePage: page,
            cloud,
            stats,
            live,
            workerId: identity.worker_id,
            noWrite,
            debug: debug || discoveryOnly,
            inspectionLimit: discoveryV2Test ? 10 : null,
            shouldStop: () => stopping,
            metrics: efficiency,
            maybeOutreach: async () => {
              if (discoveryOnly || noWrite || discoveryV2Test) return;
              const current = await cloud.config();
              if (!current.automationEnabled) return;
              outreachPage ??= await context.newPage();
              await runOneJob(cloud, outreachPage, identity, current, stats);
            },
          });
          if (discoveryV2Test) return;
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
    if (debug || discoveryOnly) {
      efficiency.cloudRequests = cloud.cloudRequests;
      console.log(formatEfficiency(efficiency));
    }
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

async function runDryOutreach(cloud: CloudClient, page: import("playwright").Page) {
  const preview = await cloud.previewJob();
  const sequence = preview.sequence;
  if (!sequence) {
    console.log("No outreach job is available.");
    console.log("Reason: No approved outreach jobs are currently queued.");
    return;
  }
  const profile = await readProfile(page, sequence.instagramUsername);
  console.log(
    formatDryRun({
      username: sequence.instagramUsername,
      relationship: profile.relationship,
      profileExists: profile.profileExists,
      plan: dryRunPlan({
        username: sequence.instagramUsername,
        profileExists: profile.profileExists,
        observedUsername: profile.profile.username,
        relationship: profile.relationship,
        message: sequence.message,
      }),
    }),
  );
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
    if (first.message) console.log(`Reason: ${first.message}`);
    else if (first.reason) console.log(`Reason: ${first.reason}`);
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
    const result = await readProfile(page, username, { debug: true, screenshot: true });
    console.log("Inspect finished. Nothing was saved, followed, or messaged.");
    return result;
  } finally {
    await context.close().catch(() => undefined);
  }
}

function printBanner(identity: ReturnType<typeof loadIdentity>, baseUrl: string) {
  console.log("ShootPortal Outreach Agent");
  console.log("--------------------------");
  console.log(`Worker: ${identity.machine_name}`);
  console.log(`Platform: ${identity.platform}`);
  console.log(`Dashboard: ${baseUrl}`);
  console.log(`Browser profile: ${browserProfileDir()}`);
}
