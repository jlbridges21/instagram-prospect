import { continuousOutreachStep } from "../lib/discovery/policy";
import { launchBrowser } from "./browser/launch";
import { createHeartbeatSession, mustHeartbeatBeforeClaim, safeHeartbeatError } from "./heartbeat-session";
import { CloudClient, type CloudConfig, type JobPayload } from "./cloud/client";
import { emptyEfficiency, formatEfficiency, runDiscoveryV2 } from "./discovery/v2";
import { loadIdentity } from "./identity";
import { formatComposerComparison, formatHeaderInspect, formatInitialComposer, sequenceOwnsFollow } from "../lib/outreach/dm";
import { dryRunPlan, formatDryRun } from "../lib/outreach/dry-run-plan";
import { recoverFollowDecision } from "../lib/outreach/follow-confirm";
import {
  ensureHome,
  followProfile,
  inspectComposerMessage,
  inspectDirectMessage,
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
  const discoveryV3Test = process.argv.includes("--discovery-v3-test");
  const discoveryOnly = process.argv.includes("--discovery-only") || process.argv.includes("--discovery-v2-test") || discoveryV3Test || mode === "smoke";
  const discoveryV2Test = process.argv.includes("--discovery-v2-test");
  const noWrite = process.argv.includes("--no-write") || mode === "smoke" || mode === "login";
  const dryRun = process.argv.includes("--outreach-dry-run");
  const singleOutreach = process.argv.includes("--single-outreach") || process.argv.includes("--recover-outreach");
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
  const inspectUsernameArg = inspectDmArgument();
  if (inspectUsernameArg) {
    try {
      await ensureHome(page);
      console.log("✓ Instagram authenticated");
      const inspection = await inspectDirectMessage(page, inspectUsernameArg);
      console.log(`@${inspectUsernameArg}`);
      console.log(`Message action: ${inspection.messageAction ? "found" : "not found"}`);
      console.log(`Conversation opened: ${inspection.conversationOpened ? "yes" : "no"}`);
      if ("headerCandidates" in inspection && inspection.headerCandidates) {
        const headerCandidates = inspection.headerCandidates;
        const usernameRendered = headerCandidates.some((candidate) => {
          const blob = `${candidate.text} ${candidate.ariaLabel} ${candidate.alt}`.toLowerCase();
          return blob.includes(inspectUsernameArg) || blob.includes(`@${inspectUsernameArg}`);
        });
        console.log("");
        console.log(
          formatHeaderInspect({
            paneFound: inspection.paneFound === true,
            directPath: inspection.directPath ?? null,
            candidates: headerCandidates,
            displayName: inspection.displayName ?? null,
            usernameRendered,
            provenance: {
              sourceProfileUsername: inspectUsernameArg,
              sourceProfileVerified: inspection.sourceVerified === true,
              messageActionClicked: inspection.messageAction,
              directOpenedFromProfile: inspection.conversationOpened,
            },
            composerFound: inspection.composerFound,
          }),
        );
      }
      console.log("");
      console.log(`Conversation recipient: ${"recipientConfirmed" in inspection && inspection.recipientConfirmed ? "confirmed" : "not confirmed"}`);
      console.log(`Recipient strategy: ${"recipientStrategy" in inspection && inspection.recipientStrategy ? inspection.recipientStrategy : "none"}`);
      console.log(`Conflicting recipient evidence: ${"conflicting" in inspection && inspection.conflicting ? "yes" : "no"}`);
      if ("recipientReason" in inspection && inspection.recipientReason) console.log(inspection.recipientReason);
      console.log(`Composer found: ${inspection.composerFound ? "yes" : "no"}`);
      console.log(`Composer strategy: ${inspection.composerStrategy ?? "none"}`);
      console.log(`Existing conversation: ${inspection.existingConversation ? "yes" : "no"}`);
      console.log("");
      console.log("Nothing was typed or sent.");
    } catch (error) {
      console.log(error instanceof Error ? error.message : "The DM inspection failed.");
    }
    await context.close().catch(() => undefined);
    return;
  }
  const inspectComposerArg = inspectComposerArgument();
  if (inspectComposerArg) {
    try {
      await ensureHome(page);
      console.log("✓ Instagram authenticated");
      const locked = await cloud.previewLockedMessage(inspectComposerArg);
      console.log(`@${inspectComposerArg}`);
      if (!locked.message) {
        console.log("Locked message: not found");
        console.log("Nothing was typed or sent.");
      } else {
        const inspection = await inspectComposerMessage(page, inspectComposerArg, locked.message);
        console.log(`Recipient confirmed: ${inspection.recipientConfirmed ? "yes" : "no"}`);
        console.log(`Composer found: ${inspection.composerFound ? "yes" : "no"}`);
        console.log(`Existing conversation: ${inspection.existingConversation ? "yes" : "no"}`);
        if ("candidatesText" in inspection && inspection.candidatesText) {
          console.log("");
          console.log(inspection.candidatesText);
        }
        if ("draft" in inspection && inspection.draft) {
          console.log("");
          console.log(formatInitialComposer(inspection.draft));
        }
        if ("beforeLength" in inspection) {
          console.log("");
          console.log("Before insertion:");
          console.log(`Composer semantic length: ${inspection.beforeLength ?? "not read"}`);
          console.log("");
          console.log("Focused:");
          console.log(inspection.method === "already-present" ? "not required" : inspection.focused ? "yes" : "no");
          console.log("");
          console.log("Insertion method:");
          console.log(inspection.method ?? "not inserted");
        }
        if (inspection.reason) console.log(inspection.reason);
        if (inspection.inserted || ("beforeLength" in inspection && inspection.beforeLength !== null && inspection.composerText !== undefined)) {
          console.log("");
          console.log(inspection.method === "already-present" ? "Composer readback:" : "After insertion:");
          console.log(`Composer semantic length: ${inspection.composerText.length}`);
          console.log("");
          console.log(formatComposerComparison(locked.message, inspection.composerText));
        }
        if (inspection.clearNote) {
          console.log("");
          console.log(inspection.clearNote);
        }
        console.log("");
        console.log("Nothing was sent.");
      }
    } catch (error) {
      console.log(error instanceof Error ? error.message : "The composer inspection failed.");
    }
    await context.close().catch(() => undefined);
    return;
  }
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
  const claimsOutreach = mustHeartbeatBeforeClaim({
    mode,
    dryRun,
    singleOutreach,
    discoveryOnly,
    noWrite,
  });
  const heartbeats = createHeartbeatSession(Math.max(startup.heartbeatIntervalSeconds, 15) * 1000, () =>
    beat(
      cloud,
      identity,
      live.task,
      stats,
      live.browserConnected,
      live.instagramAuthenticated,
      live.attention,
      live.username,
      live.lastEvent,
    ),
  );
  if (!claimsOutreach) heartbeats.startInterval();
  let outreachReady = false;
  let backoff = 5_000;
  let announced = false;
  let statusAnnounced = false;

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
          if (debug) console.log("Debug logging is on.");
          announced = true;
        }
        if (claimsOutreach && !outreachReady) {
          await ensureHome(page);
          live.instagramAuthenticated = true;
          console.log("✓ Instagram authenticated");
          try {
            await heartbeats.register();
          } catch (error) {
            if (isAuthFailure(error)) return;
            console.log("Worker heartbeat failed. Outreach was not started.");
            console.log(`Reason: ${safeHeartbeatError(error)}`);
            return;
          }
          console.log("✓ Worker heartbeat registered");
          outreachReady = true;
        }
        if (!statusAnnounced) {
          console.log(config.automationEnabled ? "Outreach: RUNNING" : "✓ Outreach PAUSED");
          statusAnnounced = true;
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
          const outcome = await runOneJob(cloud, page, identity, config, stats);
          if (outcome.worked) {
            if (outcome.username) console.log(`Completed outreach for @${outcome.username}.`);
            continue;
          }
          if (config.automationEnabled && outcome.reason) {
            const step = continuousOutreachStep({
              paused: outcome.reason === "outreach_paused",
              checkpoint: false,
              jobReady: false,
              nextAt: outcome.nextAt ?? null,
              outsideHours: outcome.reason === "outside_active_hours",
              now: new Date(),
            });
            if (outcome.reason === "no_queued_jobs") console.log("Outreach queue is empty.");
            else if (outcome.message) console.log(outcome.message);
            if (outcome.nextAt) console.log("Waiting...");
            if (!config.discoveryEnabled) {
              await sleep(step.waitMs);
              continue;
            }
          }
        }
        if (mode === "smoke") {
          const posts = await ensureHome(page);
          console.log(`Authenticated: yes`);
          console.log(`Home feed visible: yes`);
          console.log(`Visible candidate posts: ${posts.length}`);
          console.log("Worker API: connected");
          return;
        }
        const inspectionCap = discoveryV2Test || discoveryV3Test ? 10 : config.sessionInspectionCap;
        if (config.discoveryEnabled && !stopping && stats.seen < inspectionCap && !singleOutreach) {
          live.task = "discovering_candidates";
          live.instagramAuthenticated = true;
          if (discoveryV2Test) console.log("Discovery V2 test. Outreach stays paused. Inspecting up to 10 profiles.");
          if (discoveryV3Test) console.log("Discovery V3 test. Outreach stays paused. Inspecting up to 10 profiles. No follow and no DM.");
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
            inspectionLimit: inspectionCap,
            shouldStop: () => stopping,
            metrics: efficiency,
            gate: async (tick) => cloud.discoveryProgress(tick).catch(() => null),
            maybeOutreach: async () => {
              if (discoveryOnly || noWrite || discoveryV2Test || discoveryV3Test) return;
              const current = await cloud.config();
              if (!current.automationEnabled) return;
              outreachPage ??= await context.newPage();
              await runOneJob(cloud, outreachPage, identity, current, stats);
            },
          });
          if (discoveryV2Test || discoveryV3Test) return;
        } else {
          live.task = "idle";
          await beat(cloud, identity, live.task, stats, true, true, live.attention, live.username, live.lastEvent);
          if (stats.seen >= inspectionCap) console.log("Session profile limit reached. Waiting.");
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
    heartbeats.stop();
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
  if (!config.automationEnabled) return { worked: false, reason: "outreach_paused" as const, nextAt: null, message: null, username: null };
  const next = await cloud.nextJob(identity.worker_id);
  if (!next.job) {
    return {
      worked: false,
      reason: next.reason ?? "no_queued_jobs",
      nextAt: next.nextAt ?? null,
      message: next.message ?? null,
      username: null,
    };
  }
  const job = next.job;
  await beat(cloud, identity, `executing_${job.type}`, stats, true, true, undefined, job.instagramUsername, null);
  await cloud.startJob(job.id, identity.worker_id);
  try {
    const result = await executeJob(page, job);
    await settleExecution(cloud, identity.worker_id, job, result);
    return { worked: true, reason: null, nextAt: null, message: null, username: job.instagramUsername };
  } catch (error) {
    if (error instanceof AttentionError) {
      await reportFailure(cloud, identity.worker_id, job.id, error.code, error.message, false);
      throw error;
    }
    if (error instanceof NavigationError) {
      await reportFailure(cloud, identity.worker_id, job.id, error.code, error.message, job.type === "verify_profile");
      return { worked: true, reason: null, nextAt: null, message: null, username: job.instagramUsername };
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
    return { worked: true, reason: null, nextAt: null, message: null, username: job.instagramUsername };
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
  if (job.type === "follow_profile") {
    return followProfile(page, job.instagramUsername, {
      followClickAttempted: job.followClickAttempted,
      executionStarted: job.executionStarted,
      verifyNotFollowing: job.verifyNotFollowing,
    });
  }
  if (!job.message) throw new SelectorError("The send job did not include the locked message.");
  return sendExactMessage(page, job.instagramUsername, job.message, {
    followCreatedBySequence: job.followCreatedBySequence === true,
    sendAttempted: job.sendAttempted === true,
  });
}

async function settleExecution(
  cloud: CloudClient,
  workerId: string,
  job: JobPayload,
  result: Record<string, unknown>,
) {
  const outcome = result as {
    confirmation?: string;
    recoveredWithoutClick?: boolean;
    composerNotFound?: boolean;
    composerTextMismatch?: boolean;
    existingDraftMismatch?: boolean;
    manualReview?: boolean;
    recipientUnconfirmed?: boolean;
    ambiguousReason?: string;
  };
  if (
    job.type === "send_message" &&
    result.sent === false &&
    result.existingConversation !== true &&
    result.dmUnavailable !== true &&
    result.preexistingFollow !== true &&
    result.profileExists !== false &&
    result.composerNotFound !== true &&
    result.composerTextMismatch !== true &&
    result.existingDraftMismatch !== true &&
    result.manualReview !== true &&
    result.recipientUnconfirmed !== true &&
    result.confirmation !== "uncertain"
  ) {
    await reportFailure(
      cloud,
      workerId,
      job.id,
      "message_send_failed",
      "The composer text did not match the queued message, so it was not sent.",
      true,
    );
    console.log("The composer text did not match the queued message, so it was not sent.");
    return "stop" as const;
  }
  if (outcome.existingDraftMismatch) {
    await reportFailure(
      cloud,
      workerId,
      job.id,
      "existing_draft_mismatch",
      "Existing composer draft does not match the queued message. Manual review required.",
      false,
    );
    console.log("Existing composer draft does not match the queued message. Manual review required.");
    return "stop" as const;
  }
  if (outcome.composerTextMismatch) {
    await reportFailure(cloud, workerId, job.id, "composer_text_mismatch", "composer_text_mismatch", true);
    console.log("The composer text did not match the queued message, so it was not sent.");
    return "stop" as const;
  }
  if (outcome.composerNotFound) {
    await reportFailure(
      cloud,
      workerId,
      job.id,
      "dm_composer_not_found",
      `Could not find the message composer for @${job.instagramUsername}.`,
      true,
    );
    console.log(`Could not find the message composer for @${job.instagramUsername}.`);
    return "stop" as const;
  }
  if (outcome.recipientUnconfirmed) {
    const reason = outcome.ambiguousReason || "Conversation recipient could not be confirmed.";
    await reportFailure(cloud, workerId, job.id, "recipient_confirmation_failed", reason, true);
    console.log(reason);
    return "stop" as const;
  }
  if (outcome.manualReview) {
    const reason = outcome.ambiguousReason || "Send state from a previous attempt is uncertain.";
    await reportFailure(cloud, workerId, job.id, "send_confirmation_uncertain", reason, true);
    console.log(reason);
    return "stop" as const;
  }
  if (outcome.confirmation === "uncertain" && job.type === "send_message") {
    await reportFailure(
      cloud,
      workerId,
      job.id,
      "send_confirmation_uncertain",
      "The send could not be confirmed. No second send was made.",
      true,
    );
    console.log("Send confirmation is uncertain. No second send was made.");
    return "stop" as const;
  }
  if (outcome.confirmation === "uncertain") {
    await reportFailure(
      cloud,
      workerId,
      job.id,
      "follow_confirmation_uncertain",
      "Follow was clicked, but the result could not be confirmed.",
      true,
    );
    console.log(`Follow was clicked for @${job.instagramUsername}, but it still needs verification. No second click was made.`);
    return "stop" as const;
  }
  if (outcome.recoveredWithoutClick) {
    console.log(`Follow for @${job.instagramUsername} is already confirmed. No second click was made.`);
  }
  await reportComplete(cloud, workerId, job.id, result);
  return "done" as const;
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
  } catch (error) {
    rememberPending({ jobId, workerId, kind: "fail", body, createdAt: new Date().toISOString() });
    console.log(error instanceof Error ? error.message : "The job failure could not be recorded.");
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
  const followStep = sequence.steps.find((step) => step.type === "follow_profile" && step.status === "completed");
  const followCreatedBySequence = sequenceOwnsFollow(followStep?.result);
  const base = dryRunPlan({
    username: sequence.instagramUsername,
    profileExists: profile.profileExists,
    observedUsername: profile.profile.username,
    relationship: profile.relationship,
    message: sequence.message,
    followCreatedBySequence,
  });
  let composerFound = false;
  let existingConversation = false;
  let composerChecked = false;
  if (base.wouldOpenDm && followCreatedBySequence) {
    const inspection = await inspectDirectMessage(page, sequence.instagramUsername);
    composerFound = inspection.composerFound;
    existingConversation = inspection.existingConversation;
    composerChecked = true;
  }
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
        followCreatedBySequence,
        composerFound: composerChecked ? composerFound : undefined,
        existingConversation,
        composerChecked,
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
  const recover = process.argv.includes("--recover-outreach");
  const first = await cloud.nextJob(identity.worker_id, undefined, recover ? { recoverOnly: true } : undefined);
  if (!first.job) {
    if (recover) {
      console.log("No recoverable outreach job was found.");
      return;
    }
    console.log("No outreach job is available.");
    if (first.message) console.log(`Reason: ${first.message}`);
    else if (first.reason) console.log(`Reason: ${first.reason}`);
    return;
  }
  if (recover) {
    console.log(`Claimed stale outreach for @${first.job.instagramUsername} with a fresh lease.`);
    try {
      await cloud.startJob(first.job.id, identity.worker_id);
      const profile = await readProfile(page, first.job.instagramUsername);
      console.log(`Current Instagram relationship: ${profile.relationship}`);
      const decision = recoverFollowDecision({
        relationship: profile.relationship,
        followClickAttempted: first.job.followClickAttempted === true,
        verifyNotFollowing: first.job.verifyNotFollowing === true,
        executionStarted: first.job.executionStarted === true,
      });
      if (decision.action === "review") {
        console.log("Previous follow action is no longer confirmed. Manual review required.");
        return;
      }
      console.log("Previous follow click attempt found.");
      console.log("No second Follow click was made.");
      await reportComplete(cloud, identity.worker_id, first.job.id, {
        followed: true,
        relationshipStatus: profile.relationship,
        profileExists: profile.profileExists,
        recoveredWithoutClick: true,
      });
      console.log(`Completed follow_profile for @${first.job.instagramUsername}.`);
      console.log("Follow recovery finished.");
      console.log("Message step was not started.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "The browser action failed.";
      console.log(message);
    }
    return;
  }
  console.log(`Claimed outreach for @${first.job.instagramUsername}`);
  const prospectId = first.job.prospectId;
  let job: JobPayload | null = first.job;
  while (job) {
    live.task = `executing_${job.type}`;
    live.username = job.instagramUsername;
    const current = job;
    try {
      await cloud.startJob(current.id, identity.worker_id);
      const result = await executeJob(page, current);
      const settled = await settleExecution(cloud, identity.worker_id, current, result);
      if (settled === "stop") return;
      console.log(`Completed ${current.type} for @${current.instagramUsername}.`);
      if (process.argv.includes("--recover-outreach") && current.type === "follow_profile") {
        console.log("Follow recovery finished. The message step was not started.");
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The browser action failed.";
      await reportFailure(cloud, identity.worker_id, current.id, "browser_error", message, false);
      console.log(message);
      return;
    }
    const next = await cloud.nextJob(identity.worker_id, prospectId);
    if (!next.job || next.job.prospectId !== prospectId) {
      console.log("No outreach job is available.");
      if (next.message) console.log(`Reason: ${next.message}`);
      else if (next.reason) console.log(`Reason: ${next.reason}`);
      if (current.type === "follow_profile") console.log("Worker stopping.");
      return;
    }
    job = next.job;
  }
  console.log("Single outreach finished.");
  void stats;
}

function inspectComposerArgument() {
  const inline = process.argv.find((item) => item.startsWith("--inspect-composer="));
  const raw = inline
    ? inline.slice("--inspect-composer=".length)
    : process.argv.includes("--inspect-composer")
      ? process.argv[process.argv.indexOf("--inspect-composer") + 1]
      : "";
  const username = (raw || "").replace(/^@/, "").trim().toLowerCase();
  if (!username) return null;
  return /^[a-z0-9._]{1,30}$/.test(username) ? username : null;
}

function inspectDmArgument() {
  const inline = process.argv.find((item) => item.startsWith("--inspect-dm="));
  const raw = inline
    ? inline.slice("--inspect-dm=".length)
    : process.argv.includes("--inspect-dm")
      ? process.argv[process.argv.indexOf("--inspect-dm") + 1]
      : "";
  const username = (raw || "").replace(/^@/, "").trim().toLowerCase();
  if (!username) return null;
  return /^[a-z0-9._]{1,30}$/.test(username) ? username : null;
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
