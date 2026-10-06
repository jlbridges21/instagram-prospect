import fs from "node:fs";
import { continuousOutreachStep } from "../lib/discovery/policy";
import { rememberExplorationDecision } from "../lib/discovery/candidate-priority";
import { clampTuning, DEFAULT_DISCOVERY_OPTIMIZATION } from "../lib/discovery/defaults";
import { discoveryDue, discoveryStallDecision, formatInspectionDelay, inspectionIntervalMs, scheduleNextInspection, startDiscoveryCadence } from "../lib/discovery/cadence";
import { outreachStallDecision } from "../lib/outreach/pace";
import { formatCountdown } from "../lib/ui/countdown";
import { censusFromScores, checkpointHoldDecision, discoveryConfigUpdates, formatDiscoveryConfig, formatHourlyWaitEvent, formatWorkerModes, rollingHourInspectionCount, type DiscoveryRuntimeConfig } from "../lib/discovery/pacing";
import { readHourlyStamps } from "./discovery/hourly-history";
import { readDiscoveryCadence, writeDiscoveryCadence } from "./discovery/cadence-file";
import { startOfNextLocalDay } from "../lib/outreach/time";
import { BrowserActionLock, nextOrchestratorStep } from "../lib/worker/orchestrator";
import { discoveryRunShouldStop } from "../lib/worker/commands";
import {
  browserStateFromSignals,
  contextUsable,
  discoveryAdmission,
  executionStates,
  formatBrowserHealthEvent,
  isBrowserClosedMessage,
  recoveryDecision,
  restartBrowserAllowed,
  shouldLogBrowserFailure,
  startDiscoveryEffect,
  type BrowserState,
  type SideEffect,
} from "../lib/worker/browser-health";
import { BLANK_TAB_LIMIT_MS, browserRestartRequired, profileTabHealth, selectInspectionTab, type ProfileTabId } from "../lib/worker/profile-tabs";
import { prospectCompletionLine } from "../lib/outreach/completion-log";
import { JobQuarantine, persistFailure } from "../lib/outreach/failure-sync";
import { launchBrowser } from "./browser/launch";
import { createHeartbeatSession, mustHeartbeatBeforeClaim, safeHeartbeatError } from "./heartbeat-session";
import { CloudClient, type CloudConfig, type JobPayload } from "./cloud/client";
import { emptyEfficiency, formatEfficiency, runDiscoveryV2 } from "./discovery/v2";
import { loadIdentity } from "./identity";
import { formatComposerComparison, formatHeaderInspect, formatIdentityDecision, formatInitialComposer, formatRecipientDiagnostic, sequenceOwnsFollow } from "../lib/outreach/dm";
import { dryRunPlan, formatDryRun } from "../lib/outreach/dry-run-plan";
import { recoverFollowDecision } from "../lib/outreach/follow-confirm";
import {
  ensureHome,
  followProfile,
  pageNeedsAttention,
  inspectComposerMessage,
  inspectDirectMessage,
  readProfile,
  saveErrorScreenshot,
  sendExactMessage,
} from "./instagram/actions";
import { openSeedFollowing } from "./instagram/open-following";
import { emptySeedNetworkRead } from "./instagram/seed-network";
import { openSeedSuggestions } from "./instagram/open-seed";
import { readDom } from "./instagram/read-dom";
import { AttentionError, NavigationError, SelectorError } from "./instagram/errors";
import { isExcludedRelationship } from "./instagram/parse";
import { log } from "./logger";
import { forgetPending, readPending, rememberPending } from "./pending-results";
import { browserProfileDir, discoveryQueuePath } from "./paths";
import { AUTH_FAILURE_MESSAGE, VERSION_MISMATCH_MESSAGE, WORKER_VERSION } from "./version";

export type RunMode = "agent" | "smoke" | "login";

let stopRequested = false;
let openedSession = false;
let activeSideEffect: SideEffect = null;
const browserLock = new BrowserActionLock();
const quarantine = new JobQuarantine();
let outreachSyncBlocked: { jobId: string; username: string } | null = null;

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
  let loggedDiscoveryConfig = runtimeDiscoveryConfig(startup);
  console.log(formatDiscoveryConfig(loggedDiscoveryConfig));
  let { context, page } = await launchBrowser();
  const session = {
    closed: false,
    restarting: false,
    failed: false,
    attempts: 0,
    discoveryActive: false,
    profiles: [null, null] as Array<import("playwright").Page | null>,
    blankSince: [null, null] as Array<number | null>,
    lastProfileTab: null as ProfileTabId | null,
    outreachPage: null as import("playwright").Page | null,
    lastHealthLog: null as string | null,
    generation: 0,
  };
  context.once("close", () => {
    if (session.generation === 0) session.closed = true;
  });
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
      if ("headerCandidates" in inspection) {
        console.log(formatRecipientDiagnostic({
          username: inspectUsernameArg,
          displayName: inspection.displayName ?? null,
          pageUrl: inspection.directPath || null,
          candidates: inspection.headerCandidates ?? [],
          composerFound: inspection.composerFound,
          provenance: {
            sourceProfileUsername: inspectUsernameArg,
            sourceProfileVerified: inspection.sourceVerified === true,
            messageActionClicked: inspection.messageAction,
            directOpenedFromProfile: inspection.conversationOpened,
          },
        }));
        console.log(formatIdentityDecision({
          username: inspectUsernameArg,
          pageUrl: inspection.directPath || null,
          candidates: inspection.headerCandidates ?? [],
          composerFound: inspection.composerFound,
          confirmed: inspection.recipientConfirmed === true,
          strategy: inspection.recipientStrategy ?? null,
          reason: inspection.recipientReason ?? null,
        }));
      }
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
  const stats = { seen: 0, ingested: 0, excluded: 0, qualified: 0, errors: 0, hour: readHourlyStamps() };
  const savedCadence = readDiscoveryCadence();
  let discoveryNextAt = savedCadence.nextInspectionAt;
  let lastDiscoveryProgressAt = savedCadence.lastInspectionAt ?? 0;
  let lastOutreachProgressAt = Date.now();
  let discoveryStallLogged = false;
  let discoveryOverdueSince = 0;
  let discoveryRetryAt = 0;
  let discoveryCollectAt = 0;
  let discoveryWaitUntil = 0;
  let explorationChoice: { slot: number; explore: boolean } | null = null;
  let discoverySlotLogged = false;
  let discoveryDelayLog = "";
  let outreachStallLogged = false;
  function reportInspectionDelay(reason: string, interval: number) {
    const line = formatInspectionDelay({ now: Date.now(), dueAt: discoveryNextAt, intervalMs: interval, reason });
    if (!line || line === discoveryDelayLog) return;
    discoveryDelayLog = line;
    console.log(line);
  }
  let dailyBlockedUntil = 0;
  let outreachDueAt = 0;
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
  const control: {
    pauseDiscovery: boolean;
    browserConnected: () => boolean;
    restartBrowser: () => Promise<boolean>;
  } = {
    pauseDiscovery: false,
    browserConnected: () => !session.closed,
    restartBrowser: async () => false,
  };
  let offered: { commandId: string; type: string; payload: unknown } | null = null;
  const heartbeats = createHeartbeatSession(Math.max(startup.heartbeatIntervalSeconds, 15) * 1000, async () => {
    const command = await beat(
      cloud,
      identity,
      live.task,
      stats,
      live.browserConnected,
      live.instagramAuthenticated,
      live.attention,
      live.username,
      live.lastEvent,
    );
    if (!command || offered) return;
    if (command.type === "pause_discovery" || command.type === "stop_discovery" || command.type === "pause_outreach") {
      await acceptSettingsCommand(cloud, identity.worker_id, command, control, stats);
      return;
    }
    if (command.type === "start_discovery" && session.discoveryActive && !control.pauseDiscovery) {
      const effect = startDiscoveryEffect({ loopActive: true });
      if (!effect.startAnotherLoop) {
        await acknowledgeStart(cloud, identity.worker_id, command.commandId, true);
      }
      return;
    }
    offered = command;
  });
  if (!claimsOutreach) heartbeats.startInterval();
  let outreachReady = false;
  let backoff = 5_000;
  let announced = false;
  let modeLine = "";
  let attentionHold: AttentionError | null = null;
  let attentionLogged = false;
  let standbyPrinted = false;

  function pagesReadable() {
    try {
      context.pages();
      return true;
    } catch {
      return false;
    }
  }

  function currentState(): BrowserState {
    if (!contextUsable({ exists: true, closed: session.closed, pagesReadable: pagesReadable() })) session.closed = true;
    return browserStateFromSignals({ closed: session.closed, restarting: session.restarting, failed: session.failed });
  }

  function logOnce(message: string | null) {
    if (!message || !shouldLogBrowserFailure(session.lastHealthLog, message)) return;
    session.lastHealthLog = message;
    console.log(message);
  }

  async function relaunchBrowser() {
    const allowed = restartBrowserAllowed({
      online: true,
      state: session.failed ? "failed" : "closed",
      sideEffect: activeSideEffect,
    });
    if (!allowed.allowed) {
      logOnce(allowed.reason);
      return false;
    }
    session.restarting = true;
    session.failed = false;
    session.generation += 1;
    const generation = session.generation;
    await context.close().catch(() => undefined);
    session.closed = true;
    session.profiles = [null, null];
    session.blankSince = [null, null];
    session.lastProfileTab = null;
    session.outreachPage = null;
    try {
      const next = await launchBrowser();
      context = next.context;
      page = next.page;
      session.closed = false;
      session.restarting = false;
      session.attempts = 0;
      session.lastHealthLog = null;
      context.once("close", () => {
        if (session.generation === generation) session.closed = true;
      });
      await ensureHome(page);
      live.instagramAuthenticated = true;
      console.log("Browser connected.");
      return true;
    } catch (error) {
      session.restarting = false;
      session.closed = true;
      const message = error instanceof Error ? error.message : "Browser recovery failed.";
      if (/already open|already in use/i.test(message)) session.failed = true;
      logOnce(message);
      return false;
    }
  }

  async function observeProfileTab(page: import("playwright").Page | null, blankSince: number | null) {
    const now = Date.now();
    if (!page) return { closed: true, url: null, crashed: false, navigationFailed: false, blankSince, now };
    try {
      if (page.isClosed()) return { closed: true, url: null, crashed: false, navigationFailed: false, blankSince, now };
      return { closed: false, url: page.url(), crashed: false, navigationFailed: false, blankSince, now };
    } catch {
      return { closed: false, url: null, crashed: false, navigationFailed: false, blankSince, now };
    }
  }

  async function ensureProfileTabs() {
    if (!contextUsable({ exists: true, closed: session.closed, pagesReadable: pagesReadable() })) {
      session.closed = true;
      return null;
    }
    const ids: ProfileTabId[] = ["profile-tab-1", "profile-tab-2"];
    const pages: [import("playwright").Page | null, import("playwright").Page | null] = [null, null];
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      const existing = session.profiles[index] ?? null;
      const observed = await observeProfileTab(existing, session.blankSince[index]);
      const blankSince = observed.url === "about:blank" || observed.url === ""
        ? observed.now - BLANK_TAB_LIMIT_MS
        : null;
      const health = profileTabHealth({ ...observed, blankSince });
      if (existing && health.healthy) {
        pages[index] = existing;
        continue;
      }
      const replacing = Boolean(existing);
      if (existing) {
        console.log(`${id} unhealthy: ${health.reason}`);
        console.log(`Recreating ${id}...`);
        await existing.close().catch(() => undefined);
      }
      try {
        const created = await context.newPage();
        session.blankSince[index] = Date.now();
        const loaded = await created
          .goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 20_000 })
          .then(() => true)
          .catch(() => false);
        const restored = profileTabHealth({
          ...(await observeProfileTab(created, null)),
          navigationFailed: !loaded,
          blankSince: null,
        });
        if (!restored.healthy) {
          console.log(`${id} could not be restored. Discovery will continue with the other profile tab.`);
          await created.close().catch(() => undefined);
          session.profiles[index] = null;
          continue;
        }
        session.profiles[index] = created;
        session.blankSince[index] = null;
        pages[index] = created;
        if (replacing) console.log(`${id} restored.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (isBrowserClosedMessage(message) || !pagesReadable()) {
          session.closed = true;
          return null;
        }
        console.log(`${id} could not be restored. Discovery will continue with the other profile tab.`);
        session.profiles[index] = null;
      }
    }
    return pages;
  }

  async function holdForBrowser(config: CloudConfig) {
    if (currentState() === "connected") return false;
    if (claimsOutreach && !outreachReady) {
      try {
        await heartbeats.register();
        outreachReady = true;
      } catch (error) {
        if (isAuthFailure(error)) throw error;
      }
    }
    const decision = recoveryDecision({ state: currentState(), attempts: session.attempts, sideEffect: activeSideEffect });
    if (decision.action === "recover") {
      session.attempts += 1;
      logOnce(decision.log);
      const ok = await relaunchBrowser();
      if (!ok && session.attempts >= 3) {
        session.failed = true;
        logOnce("Browser recovery failed. Worker is blocked.");
      }
    } else {
      logOnce(decision.log);
    }
    if (currentState() === "connected") return false;
    const reported = currentState();
    const states = executionStates({
      browser: reported,
      discoveryEnabled: config.discoveryEnabled,
      outreachEnabled: config.automationEnabled,
      sideEffect: activeSideEffect,
    });
    const line = formatBrowserHealthEvent({
      state: reported,
      discoveryDesired: states.discoveryDesired,
      discoveryActual: states.discoveryActual,
      outreachDesired: states.outreachDesired,
      outreachActual: states.outreachActual,
      reason: states.reason,
    });
    if (line !== modeLine) {
      console.log(`Discovery desired: ${states.discoveryDesired.toUpperCase()}`);
      console.log(`Discovery actual: ${states.discoveryActual.toUpperCase()}`);
      console.log(`Outreach desired: ${states.outreachDesired.toUpperCase()}`);
      console.log(`Outreach actual: ${states.outreachActual.toUpperCase()}`);
      if (states.reason) console.log(`Reason: ${states.reason}`);
      modeLine = line;
    }
    reportInspectionDelay("Browser recovery", inspectionIntervalMs(config.maxProfilesPerHour));
    live.browserConnected = false;
    live.task = reported === "restarting" ? "browser_restarting" : "browser_closed";
    live.lastEvent = line;
    live.attention = states.reason ?? undefined;
    await beat(cloud, identity, live.task, stats, false, false, live.attention, live.username, line).catch(() => undefined);
    await sleep(Math.max(config.heartbeatIntervalSeconds, 15) * 1000);
    return true;
  }

  control.browserConnected = () => currentState() === "connected";
  control.restartBrowser = relaunchBrowser;

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
          console.log("Automation configuration loaded");
          if (debug) console.log("Debug logging is on.");
          announced = true;
        }
        if (await holdForBrowser(config)) continue;
        live.browserConnected = true;
        if (attentionHold) {
          const still = await pageNeedsAttention(page).catch(() => attentionHold?.code ?? "instagram_checkpoint");
          if (still) {
            if (!attentionLogged) {
              console.log(attentionHold.message);
              console.log(checkpointHoldDecision().log);
              attentionLogged = true;
            }
            live.task = "attention_required";
            live.attention = attentionHold.message;
            await beat(cloud, identity, live.task, stats, true, false, live.attention, live.username, live.lastEvent);
            await sleep(30_000);
            continue;
          }
          attentionHold = null;
          attentionLogged = false;
          live.attention = undefined;
          console.log("Checkpoint cleared. Browser automation can continue.");
          modeLine = "";
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
          console.log("Worker heartbeat registered");
          outreachReady = true;
          if (!standbyPrinted) {
            standbyPrinted = true;
            console.log("");
            console.log("ShootPortal Outreach Worker");
            console.log("");
            console.log("Worker:");
            console.log(identity.machine_name);
            console.log("");
            console.log("Cloud:");
            console.log("Connected");
            console.log("");
            console.log("Browser:");
            console.log("Connected");
            console.log("");
            console.log("Instagram:");
            console.log(live.instagramAuthenticated ? "Authenticated" : "Not authenticated");
            console.log("");
            console.log("Control:");
            console.log("Dashboard connected");
            console.log("");
            console.log("Status:");
            console.log(config.discoveryEnabled || config.automationEnabled ? "RUNNING" : "STANDBY");
            console.log("");
            console.log(formatWorkerModes({
              discovery: config.discoveryEnabled ? "RUNNING" : "PAUSED",
              outreach: config.automationEnabled ? "RUNNING" : "PAUSED",
            }));
            console.log("");
            console.log("Worker connected.");
            console.log("Dashboard control ready.");
            console.log("Waiting for dashboard commands...");
          }
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
        if (offered && !discoveryOnly) {
          const command: { commandId: string; type: string; payload: unknown } = offered;
          offered = null;
          await runDashboardCommand(cloud, page, identity, stats, live, command, control).catch((error) => {
            console.log(error instanceof Error ? error.message : "The dashboard command failed.");
          });
          cloud.invalidateConfig();
          if (command.type === "start_discovery" && control.browserConnected()) {
            const started = startDiscoveryCadence({ now: Date.now(), nextInspectionAt: discoveryNextAt });
            discoveryNextAt = started.nextInspectionAt;
            discoveryOverdueSince = 0;
            discoveryStallLogged = false;
            discoveryRetryAt = 0;
            discoverySlotLogged = false;
            writeDiscoveryCadence({ nextInspectionAt: discoveryNextAt, lastInspectionAt: lastDiscoveryProgressAt || null });
            if (!started.prompt) console.log(`Next inspection: ${formatCountdown(discoveryNextAt, Date.now())}`);
          }
          continue;
        }
        const freshConfig = await cloud.config();
        const runStop = discoveryRunShouldStop({
          mode: freshConfig.discoveryRunMode,
          startedAt: freshConfig.discoveryRunStartedAt,
          durationMinutes: freshConfig.discoveryRunMinutes,
          inspectionLimit: freshConfig.discoveryRunInspectionLimit,
          inspections: stats.seen,
          now: new Date(),
        });
        if (freshConfig.discoveryEnabled && runStop.stop) {
          await cloud.finishDiscoveryRun().catch(() => undefined);
          cloud.invalidateConfig();
          console.log(`Discovery stopped. Reason: ${runStop.reason}.`);
          continue;
        }
        backoff = 5_000;
        const nextDiscoveryConfig = runtimeDiscoveryConfig(freshConfig);
        const configUpdate = discoveryConfigUpdates(loggedDiscoveryConfig, nextDiscoveryConfig);
        if (configUpdate) {
          console.log(configUpdate);
          loggedDiscoveryConfig = nextDiscoveryConfig;
        }
        const outreachDueNow = config.automationEnabled && (activeSideEffect != null || Date.now() >= outreachDueAt);
        const intervalMs = inspectionIntervalMs(config.maxProfilesPerHour);
        if (Date.now() >= dailyBlockedUntil) dailyBlockedUntil = 0;
        const discoveryBlocked = !config.discoveryEnabled || control.pauseDiscovery || dailyBlockedUntil > Date.now() || currentState() !== "connected" || activeSideEffect != null;
        const stall = discoveryStallDecision({
          now: Date.now(),
          nextInspectionAt: discoveryNextAt,
          intervalMs,
          blocked: discoveryBlocked,
          overdueSince: discoveryOverdueSince,
          lastProgressAt: lastDiscoveryProgressAt,
          sourcing: discoveryWaitUntil > Date.now(),
        });
        discoveryOverdueSince = stall.overdueSince;
        if (stall.stalled && !discoveryStallLogged) {
          discoveryStallLogged = true;
          console.log("Discovery stalled. Reconciling the inspection schedule.");
          if (discoveryWaitUntil <= Date.now()) {
            discoveryNextAt = Date.now();
            discoveryOverdueSince = 0;
            writeDiscoveryCadence({ nextInspectionAt: discoveryNextAt, lastInspectionAt: lastDiscoveryProgressAt || null });
          }
        }
        const discoveryIsDue = config.discoveryEnabled && !control.pauseDiscovery && dailyBlockedUntil === 0 && discoveryDue(Date.now(), discoveryNextAt) && Date.now() >= discoveryRetryAt;
        const outreachStall = outreachStallDecision({
          now: Date.now(),
          nextEligibleAt: outreachDueAt,
          lastProgressAt: lastOutreachProgressAt,
          blocked: !config.automationEnabled || currentState() !== "connected" || activeSideEffect != null || session.discoveryActive,
        });
        if (outreachStall.stalled && !outreachStallLogged) {
          outreachStallLogged = true;
          console.log("Outreach stalled. Reconciling the next prospect.");
          outreachDueAt = Date.now();
        }
        if (outreachDueNow) outreachStallLogged = false;
        const step = nextOrchestratorStep({
          now: Date.now(),
          attention: false,
          heartbeatDueAt: Date.now() + Math.max(config.heartbeatIntervalSeconds, 15) * 1000,
          outreach: {
            desired: config.automationEnabled,
            critical: activeSideEffect != null,
            eligibleNow: outreachDueNow,
            nextEligibleAt: outreachDueAt > Date.now() ? outreachDueAt : null,
          },
          discovery: {
            desired: config.discoveryEnabled,
            eligibleNow: discoveryIsDue,
            nextEligibleAt: discoveryNextAt,
            inspectionInProgress: false,
          },
        });
        if (mode !== "smoke" && !discoveryOnly && !noWrite && (step.action === "outreach" || activeSideEffect)) {
          const outcome = await runOneJob(cloud, page, identity, config, stats);
          if (outcome.reason === "state_sync_failed") {
            live.attention = outcome.message ?? "Could not synchronize Outreach job state.";
            live.task = "outreach_state_sync";
            live.username = outcome.username;
            outreachDueAt = Date.now() + 60_000;
          } else if (outcome.worked) {
            lastOutreachProgressAt = Date.now();
            outreachDueAt = 0;
            const line = prospectCompletionLine({
              username: outcome.username,
              jobType: outcome.jobType,
              sequenceComplete: outcome.sequenceComplete,
            });
            if (line) console.log(line);
            continue;
          }
          outreachDueAt = outcome.nextAt ? new Date(outcome.nextAt).getTime() : Date.now() + 60_000;
          lastOutreachProgressAt = Date.now();
          if (config.automationEnabled && outcome.reason) {
            const wait = continuousOutreachStep({
              paused: outcome.reason === "outreach_paused",
              checkpoint: false,
              jobReady: false,
              nextAt: outcome.nextAt ?? null,
              now: new Date(),
            });
            if (outcome.reason === "no_queued_jobs") console.log("Outreach queue is empty.");
            else if (outcome.message && outcome.reason !== "state_sync_failed") console.log(outcome.message);
            if (!config.discoveryEnabled || !discoveryIsDue) {
              if (outcome.reason !== "state_sync_failed") live.task = outcome.nextAt ? "outreach_spacing_wait" : "idle";
              await beat(cloud, identity, live.task, stats, true, true, live.attention, live.username, live.lastEvent);
              await sleep(Math.min(wait.waitMs, 15_000));
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
        const admission = discoveryAdmission({
          loopActive: session.discoveryActive,
          pauseLatched: control.pauseDiscovery,
          browser: currentState(),
          desiredEnabled: config.discoveryEnabled && !stopping && stats.seen < inspectionCap && !singleOutreach,
          sideEffect: activeSideEffect,
        });
        const outreachStillDue = config.automationEnabled && (activeSideEffect != null || Date.now() >= outreachDueAt);
        const poolTuning = clampTuning(config.tuning);
        const storedSupply = persistedCandidateSupply(config.minCandidatePreScore ?? DEFAULT_DISCOVERY_OPTIMIZATION.minCandidatePreScore, poolTuning.explorationFloor);
        const collectionDue = config.discoveryEnabled && !control.pauseDiscovery && storedSupply.ranked < poolTuning.poolLowWater && Date.now() >= discoveryCollectAt && Date.now() >= discoveryWaitUntil;
        if (discoveryIsDue) {
          explorationChoice = rememberExplorationDecision({
            previous: explorationChoice,
            slot: discoveryNextAt,
            strategy: config.discoveryStrategy ?? "balanced",
            random: Math.random(),
            tuning: config.tuning,
          });
        }
        if (admission.enter && (discoveryIsDue || collectionDue) && !outreachStillDue) {
          const tabs = await ensureProfileTabs();
          if (!tabs) {
            if (browserRestartRequired({ contextConnected: false })) session.closed = true;
            continue;
          }
          const choice = selectInspectionTab({
            tabs: [
              { id: "profile-tab-1", healthy: Boolean(tabs[0] && !tabs[0].isClosed()) },
              { id: "profile-tab-2", healthy: Boolean(tabs[1] && !tabs[1].isClosed()) },
            ],
            lastUsed: session.lastProfileTab,
          });
          if (!choice.assign) {
            console.log("Both profile tabs are unavailable. Discovery will retry without closing Chrome.");
            await sleep(5_000);
            continue;
          }
          session.lastProfileTab = choice.assign;
          live.task = "discovering_candidates";
          live.instagramAuthenticated = true;
          if (discoveryV2Test) console.log("Discovery V2 test. Outreach stays paused. Inspecting up to 10 profiles.");
          if (discoveryV3Test) console.log("Discovery V3 test. Outreach stays paused. Inspecting up to 10 profiles. No follow and no DM.");
          session.discoveryActive = true;
          const seenBefore = stats.seen;
          if (discoveryIsDue && !discoverySlotLogged) {
            discoverySlotLogged = true;
            console.log("Discovery inspection slot due.");
          }
          try {
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
              profilePages: tabs,
              preferredTab: choice.assign,
              retainTabs: true,
              shouldStop: () => stopping || control.pauseDiscovery || session.closed,
              shouldYield: () => config.automationEnabled && (activeSideEffect != null || Date.now() >= outreachDueAt),
              browserLock,
              singleTurn: true,
              allowInspect: discoveryIsDue,
              exploreDecision: discoveryIsDue ? explorationChoice?.explore === true : false,
              inspectionDueAt: discoveryNextAt,
              intervalMs,
              onProgress: () => {
                lastDiscoveryProgressAt = Date.now();
                discoveryStallLogged = false;
              },
              onOutcome: (outcome) => {
                discoveryWaitUntil = outcome.action === "waiting" ? Date.now() + 60_000 : 0;
              },
              readSeedProfile: async (username) => {
                const tab = tabs.find((item) => item && !item.isClosed()) ?? null;
                if (!tab) return null;
                try {
                  const opened = await openSeedSuggestions(tab, username);
                  return opened.snapshot;
                } catch (error) {
                  log("warn", "seed_profile_unavailable", { username, message: error instanceof Error ? error.message : "unavailable" });
                  return null;
                }
              },
              readSeedNetwork: async (username, limit, isKnown, limits) => {
                const tab = tabs.find((item) => item && !item.isClosed()) ?? null;
                if (!tab) return emptySeedNetworkRead("no profile tab");
                try {
                  return await openSeedFollowing(tab, username, limit, isKnown, limits);
                } catch (error) {
                  const message = error instanceof Error ? error.message : "unavailable";
                  log("warn", "seed_network_unavailable", { username, message });
                  return emptySeedNetworkRead(message);
                }
              },
              metrics: efficiency,
              gate: async (tick) => cloud.discoveryProgress(tick).catch(() => null),
              maybeOutreach: async () => {
                if (discoveryOnly || noWrite || discoveryV2Test || discoveryV3Test || activeSideEffect || session.closed) return;
                const current = await cloud.config();
                if (!current.automationEnabled) return;
                if (!session.outreachPage || session.outreachPage.isClosed()) session.outreachPage = await context.newPage();
                await runOneJob(cloud, session.outreachPage, identity, current, stats);
              },
            });
          } finally {
            session.discoveryActive = false;
            if (discoveryWaitUntil > Date.now()) {
              discoveryRetryAt = discoveryWaitUntil;
              discoveryCollectAt = discoveryWaitUntil;
            } else {
              discoveryCollectAt = Date.now() + 20_000;
            }
            if (stats.seen > seenBefore) {
              const completedAt = Date.now();
              discoveryRetryAt = 0;
              discoverySlotLogged = false;
              discoveryNextAt = scheduleNextInspection({
                now: completedAt,
                intervalMs,
                previousNextAt: discoveryNextAt,
                completedAt,
              });
              lastDiscoveryProgressAt = completedAt;
              writeDiscoveryCadence({ nextInspectionAt: discoveryNextAt, lastInspectionAt: completedAt });
              live.lastEvent = formatHourlyWaitEvent({
                count: rollingHourInspectionCount(stats.hour, completedAt),
                limit: config.maxProfilesPerHour,
                resumesAt: discoveryNextAt,
              });
              discoveryDelayLog = "";
              console.log(`Discovery inspection completed: @${live.username ?? "profile"}`);
              console.log(`Next inspection: ${formatCountdown(discoveryNextAt, completedAt)}`);
            } else if (typeof live.lastEvent === "string" && live.lastEvent.includes("daily")) {
              dailyBlockedUntil = startOfNextLocalDay(new Date(), config.timezone).getTime();
              discoveryNextAt = dailyBlockedUntil;
              writeDiscoveryCadence({ nextInspectionAt: discoveryNextAt, lastInspectionAt: lastDiscoveryProgressAt || null });
            } else if (discoveryIsDue && discoveryWaitUntil <= Date.now()) {
              discoveryRetryAt = Date.now() + Math.min(intervalMs, 15_000);
            }
          }
          if (discoveryV2Test || discoveryV3Test) return;
          continue;
        } else {
          live.task = config.automationEnabled && outreachDueAt > Date.now() ? "outreach_spacing_wait" : "idle";
          if (config.discoveryEnabled && Date.now() > discoveryNextAt) {
            const waitingReason = control.pauseDiscovery
              ? "Paused"
              : discoveryWaitUntil > Date.now() || Date.now() < discoveryRetryAt
                ? "Waiting for eligible candidate"
                : "Waiting for inspection slot";
            reportInspectionDelay(waitingReason, intervalMs);
          }
          await beat(cloud, identity, live.task, stats, true, true, live.attention, live.username, live.lastEvent);
          if (stats.seen >= inspectionCap) console.log("Session profile limit reached. Waiting.");
          const wakeAt = Math.min(
            outreachDueAt > Date.now() ? outreachDueAt : Date.now() + 15_000,
            discoveryNextAt,
          );
          await sleep(Math.max(1_000, Math.min(15_000, wakeAt - Date.now())));
        }
      } catch (error) {
        if (isAuthFailure(error)) return;
        if (error instanceof AttentionError) {
          attentionHold = error;
          attentionLogged = false;
          console.log(error.message);
          console.log(checkpointHoldDecision().log);
          attentionLogged = true;
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
        if (isBrowserClosedMessage(message)) {
          session.closed = true;
          logOnce("Browser closed.");
          continue;
        }
        const offline = /fetch|network|ECONN|ENOTFOUND|timed out/i.test(message);
        console.log(offline ? "Cloud connection unavailable. Browser stays open. Retrying..." : message);
        log("error", "worker_loop", { message });
        if (!offline) await saveErrorScreenshot(page, "loop").catch(() => undefined);
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
  if (outreachSyncBlocked) {
    return {
      worked: false,
      reason: "state_sync_failed" as const,
      nextAt: null,
      message: `Could not save retry state for @${outreachSyncBlocked.username}. No DM was sent.`,
      username: outreachSyncBlocked.username,
      jobType: "send_message",
      sequenceComplete: false,
    };
  }
  if (!config.automationEnabled) {
    return { worked: false, reason: "outreach_paused" as const, nextAt: null, message: null, username: null, jobType: "", sequenceComplete: false };
  }
  const next = await cloud.nextJob(identity.worker_id);
  if (!next.job) {
    return {
      worked: false,
      reason: next.reason ?? "no_queued_jobs",
      nextAt: next.nextAt ?? null,
      message: next.message ?? null,
      username: null,
      jobType: "",
      sequenceComplete: false,
    };
  }
  const job = next.job;
  if (!quarantine.allowsBrowser(job.id)) {
    return {
      worked: false,
      reason: "state_sync_failed" as const,
      nextAt: null,
      message: `Could not save retry state for @${job.instagramUsername}. No DM was sent.`,
      username: job.instagramUsername,
      jobType: job.type,
      sequenceComplete: false,
    };
  }
  await beat(cloud, identity, `executing_${job.type}`, stats, true, true, undefined, job.instagramUsername, null);
  await cloud.startJob(job.id, identity.worker_id);
  try {
    const result = await executeJob(page, job);
    const settlement = await settleExecution(cloud, identity.worker_id, job, result);
    if (outreachSyncBlocked) {
      return {
        worked: false,
        reason: "state_sync_failed" as const,
        nextAt: null,
        message: `Could not save retry state for @${job.instagramUsername}. No DM was sent.`,
        username: job.instagramUsername,
        jobType: job.type,
        sequenceComplete: false,
      };
    }
    return {
      worked: true,
      reason: null,
      nextAt: null,
      message: null,
      username: job.instagramUsername,
      jobType: job.type,
      sequenceComplete: settlement === "done" && job.type === "send_message" && "sent" in result && result.sent === true,
    };
  } catch (error) {
    if (error instanceof AttentionError) {
      await reportFailure(cloud, identity.worker_id, job.id, error.code, error.message, false);
      throw error;
    }
    if (error instanceof NavigationError) {
      await reportFailure(cloud, identity.worker_id, job.id, error.code, error.message, job.type === "verify_profile");
      return { worked: true, reason: null, nextAt: null, message: null, username: job.instagramUsername, jobType: job.type, sequenceComplete: false };
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
    return { worked: true, reason: null, nextAt: null, message: null, username: job.instagramUsername, jobType: job.type, sequenceComplete: false };
  }
}

async function executeJob(page: import("playwright").Page, job: JobPayload) {
  const effect: SideEffect = job.type === "follow_profile" ? "follow" : job.type === "send_message" ? "send" : null;
  const critical = effect != null;
  browserLock.tryAcquire("outreach", critical);
  if (effect) activeSideEffect = effect;
  try {
    const result = await executeJobBody(page, job);
    if (effect && result && typeof result === "object" && "confirmation" in result && result.confirmation === "uncertain") {
      activeSideEffect = effect;
    } else if (effect) {
      activeSideEffect = null;
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!(effect && isBrowserClosedMessage(message))) activeSideEffect = effect ? null : activeSideEffect;
    throw error;
  } finally {
    if (!activeSideEffect) browserLock.release("outreach");
  }
}

async function executeJobBody(page: import("playwright").Page, job: JobPayload) {
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
    composerUnavailable?: boolean;
    messageUnavailable?: boolean;
    dmUnavailable?: boolean;
    composerTextMismatch?: boolean;
    existingDraftMismatch?: boolean;
    manualReview?: boolean;
    recipientUnconfirmed?: boolean;
    ambiguousReason?: string;
    failureCode?: string;
    retryable?: boolean;
  };
  if (
    job.type === "send_message" &&
    result.sent === false &&
    result.existingConversation !== true &&
    result.dmUnavailable !== true &&
    result.preexistingFollow !== true &&
    result.profileExists !== false &&
    result.composerNotFound !== true &&
    result.composerUnavailable !== true &&
    result.messageUnavailable !== true &&
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
  if (outcome.messageUnavailable || outcome.dmUnavailable) {
    await reportFailure(
      cloud,
      workerId,
      job.id,
      "message_unavailable",
      `Instagram did not offer messaging for @${job.instagramUsername}. No DM was sent.`,
      false,
      job.instagramUsername,
    );
    console.log(`Messaging unavailable for @${job.instagramUsername}.`);
    console.log("No DM sent.");
    return "stop" as const;
  }
  if (outcome.composerUnavailable || outcome.composerNotFound) {
    await reportFailure(
      cloud,
      workerId,
      job.id,
      "composer_unavailable",
      `The message thread for @${job.instagramUsername} opened without a usable composer. No DM was sent.`,
      true,
      job.instagramUsername,
    );
    console.log(`Composer unavailable for @${job.instagramUsername}.`);
    console.log("No DM sent.");
    return "stop" as const;
  }
  if (outcome.recipientUnconfirmed) {
    const reason = outcome.ambiguousReason || "Conversation recipient could not be confirmed.";
    const code = outcome.failureCode || "recipient_confirmation_failed";
    const retryable = outcome.retryable !== false;
    console.log(reason);
    console.log("No DM sent.");
    if (retryable) console.log("Scheduling retry. This prospect will not be opened again until that retry is saved.");
    await reportFailure(cloud, workerId, job.id, code, reason, retryable, job.instagramUsername);
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
  username?: string,
) {
  const body = { error_code: errorCode, error_message: errorMessage.slice(0, 500), retryable };
  quarantine.noteBrowserRun(jobId, username ?? jobId);
  const saved = await persistFailure({
    write: async () => {
      await cloud.failJob(jobId, workerId, body);
    },
    sleep,
    log: (message) => console.log(message),
  });
  if (saved.ok) {
    forgetPending(jobId);
    quarantine.clear(jobId);
    if (outreachSyncBlocked?.jobId === jobId) outreachSyncBlocked = null;
    return;
  }
  rememberPending({ jobId, workerId, kind: "fail", body, createdAt: new Date().toISOString() });
  quarantine.markBlocked(jobId);
  outreachSyncBlocked = { jobId, username: username ?? "unknown" };
  console.log("State sync failed.");
  console.log(`@${outreachSyncBlocked.username} quarantined.`);
  console.log("Outreach blocked pending reconciliation.");
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
      quarantine.clear(pending.jobId);
      if (outreachSyncBlocked?.jobId === pending.jobId) outreachSyncBlocked = null;
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
  const response = await cloud.heartbeat({
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
    version: WORKER_VERSION,
  });
  openedSession = true;
  return response.next_command?.commandId ? response.next_command : null;
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

async function acceptSettingsCommand(
  cloud: CloudClient,
  workerId: string,
  command: { commandId: string; type: string },
  control: { pauseDiscovery: boolean },
  stats: { seen: number },
) {
  try {
    const claimed = await cloud.claimCommand(workerId, command.commandId);
    cloud.invalidateConfig();
    if (command.type === "pause_discovery" || command.type === "stop_discovery") control.pauseDiscovery = true;
    if (command.type === "start_discovery") {
      control.pauseDiscovery = false;
      stats.seen = 0;
    }
    if (claimed.applied) await cloud.finishCommand(workerId, command.commandId, true, { acknowledged: true });
  } catch (error) {
    const status = error instanceof Error && "statusCode" in error ? Number(error.statusCode) : 0;
    if (status !== 409) console.log(error instanceof Error ? error.message : "The dashboard command could not be claimed.");
  }
}

async function acknowledgeStart(cloud: CloudClient, workerId: string, commandId: string, browserOk: boolean) {
  try {
    const claimed = await cloud.claimCommand(workerId, commandId);
    cloud.invalidateConfig();
    console.log("Dashboard command received: Start Discovery");
    console.log("Command claimed.");
    console.log("Discovery desired state: RUNNING");
    if (!browserOk) {
      await cloud.finishCommand(workerId, commandId, false, {}, "browser_unavailable");
      console.log("Command failed: browser_unavailable");
      console.log("Discovery actual: BLOCKED");
      return;
    }
    console.log("Discovery controller: Already running.");
    if (claimed.applied) await cloud.finishCommand(workerId, commandId, true, { acknowledged: true });
    console.log("Command completed.");
  } catch (error) {
    const status = error instanceof Error && "statusCode" in error ? Number(error.statusCode) : 0;
    if (status !== 409) console.log(error instanceof Error ? error.message : "The dashboard command could not be claimed.");
  }
}

async function runDashboardCommand(
  cloud: CloudClient,
  page: import("playwright").Page,
  identity: ReturnType<typeof loadIdentity>,
  stats: { seen: number; ingested: number; excluded: number; qualified: number; errors: number; hour: number[] },
  live: { task: string; username: string | null; lastEvent: string | null; attention?: string },
  command: { commandId: string; type: string; payload: unknown },
  control: { pauseDiscovery: boolean; browserConnected: () => boolean; restartBrowser: () => Promise<boolean> },
) {
  let claimed = false;
  try {
    const result = await cloud.claimCommand(identity.worker_id, command.commandId);
    claimed = true;
    cloud.invalidateConfig();
    if (result.applied && command.type === "start_discovery") {
      const effect = startDiscoveryEffect({ loopActive: false });
      control.pauseDiscovery = !effect.clearPauseLatch ? control.pauseDiscovery : false;
      stats.seen = 0;
      console.log("Dashboard command received: Start Discovery");
      console.log("Command claimed.");
      console.log("Discovery desired state: RUNNING");
      if (!control.browserConnected()) {
        await cloud.finishCommand(identity.worker_id, command.commandId, false, {}, "browser_unavailable");
        console.log("Command failed: browser_unavailable");
        console.log("Discovery actual: BLOCKED");
        return;
      }
      console.log("Discovery controller: Starting...");
      await cloud.finishCommand(identity.worker_id, command.commandId, true, { acknowledged: true });
      console.log("Command completed.");
      return;
    }
    if (result.applied) {
      await cloud.finishCommand(identity.worker_id, command.commandId, true, { acknowledged: true });
      console.log(`${command.type.replaceAll("_", " ")} acknowledged.`);
      return;
    }
    if (command.type === "restart_browser_session_if_safe") {
      const allowed = restartBrowserAllowed({
        online: true,
        state: control.browserConnected() ? "connected" : activeSideEffect ? "closed" : "closed",
        sideEffect: activeSideEffect,
      });
      if (!allowed.allowed || control.browserConnected()) {
        await cloud.finishCommand(identity.worker_id, command.commandId, false, {}, allowed.reason ?? "The automation browser is already connected.");
        return;
      }
      const ok = await control.restartBrowser();
      await cloud.finishCommand(identity.worker_id, command.commandId, ok, { restarted: ok }, ok ? undefined : "browser_unavailable");
      console.log(ok ? "Browser connected." : "Browser recovery failed. Worker is blocked.");
      return;
    }
    live.task = "command_running";
    if (command.type === "run_discovery_test") {
      await runDiscoveryV2({
        context: page.context(),
        homePage: page,
        cloud,
        stats,
        live,
        workerId: identity.worker_id,
        noWrite: false,
        debug: false,
        inspectionLimit: 10,
        shouldStop: () => control.pauseDiscovery,
        maybeOutreach: async () => undefined,
      });
      await cloud.finishCommand(identity.worker_id, command.commandId, true, { inspected: stats.seen, followed: false, sent: false });
      console.log("Test Discovery finished. No Follow or DM was performed.");
      return;
    }
    if (command.type === "run_outreach_preview") {
      await runDryOutreach(cloud, page);
      await cloud.finishCommand(identity.worker_id, command.commandId, true, { followed: false, sent: false });
      return;
    }
    if (command.type === "run_one_outreach" || command.type === "recover_outreach") {
      await runSingleOutreach(cloud, page, identity, stats, live, { recover: command.type === "recover_outreach" });
      await cloud.finishCommand(identity.worker_id, command.commandId, true, { single: true });
      return;
    }
    if (command.type === "inspect_dm" || command.type === "inspect_composer") {
      const username = typeof command.payload === "object" && command.payload && "username" in command.payload ? String(command.payload.username) : "";
      if (command.type === "inspect_dm") {
        const inspection = await inspectDirectMessage(page, username);
        console.log(`DM detection for @${username}. Nothing was typed or sent.`);
        await cloud.finishCommand(identity.worker_id, command.commandId, true, {
          composerFound: inspection.composerFound,
          existingConversation: inspection.existingConversation,
          sent: false,
        });
      } else {
        const locked = await cloud.previewLockedMessage(username);
        if (!locked.message) {
          await cloud.finishCommand(identity.worker_id, command.commandId, false, {}, "Locked message was not found. Nothing was sent.");
          return;
        }
        const inspection = await inspectComposerMessage(page, username, locked.message);
        console.log(inspection.clearNote ?? "Composer check finished. Nothing was sent.");
        await cloud.finishCommand(identity.worker_id, command.commandId, true, { sent: false, clearNote: inspection.clearNote ?? null });
      }
      return;
    }
    if (command.type === "refresh_instagram_auth_check" || command.type === "clear_worker_attention") {
      const signal = await pageNeedsAttention(page);
      if (signal && command.type === "clear_worker_attention") {
        await cloud.finishCommand(identity.worker_id, command.commandId, false, {}, "Instagram still needs attention in the browser.");
        return;
      }
      await cloud.finishCommand(identity.worker_id, command.commandId, true, { attention: signal });
      return;
    }
    await cloud.finishCommand(identity.worker_id, command.commandId, false, {}, "This command is not available.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "The dashboard command failed.";
    if (claimed) await cloud.finishCommand(identity.worker_id, command.commandId, false, {}, message).catch(() => undefined);
    else if (!(error instanceof Error) || !("statusCode" in error) || Number(error.statusCode) !== 409) console.log(message);
  }
}

async function runSingleOutreach(
  cloud: CloudClient,
  page: import("playwright").Page,
  identity: ReturnType<typeof loadIdentity>,
  stats: { seen: number; ingested: number; excluded: number; qualified: number; errors: number },
  live: { task: string; username: string | null },
  options?: { recover?: boolean },
) {
  const recover = options?.recover ?? process.argv.includes("--recover-outreach");
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

function runtimeDiscoveryConfig(config: CloudConfig): DiscoveryRuntimeConfig {
  const tuning = clampTuning(config.tuning);
  return {
    profilesPerHour: config.maxProfilesPerHour,
    minimumPreScore: config.minCandidatePreScore ?? DEFAULT_DISCOVERY_OPTIMIZATION.minCandidatePreScore,
    explorationFloor: tuning.explorationFloor,
    strategy: config.discoveryStrategy ?? "balanced",
    poolTarget: tuning.poolTarget,
    lowWater: tuning.poolLowWater,
  };
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

function persistedCandidateSupply(floor: number, explorationFloor: number) {
  try {
    const parsed = JSON.parse(fs.readFileSync(discoveryQueuePath(), "utf8")) as {
      pending?: Array<{ priorityScore?: number }>;
      deferred?: Array<{ priorityScore?: number }>;
    };
    const scores = [...(parsed.pending ?? []), ...(parsed.deferred ?? [])].map((item) => item.priorityScore ?? 0);
    return censusFromScores(scores, floor, explorationFloor);
  } catch {
    return censusFromScores([], floor, explorationFloor);
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
