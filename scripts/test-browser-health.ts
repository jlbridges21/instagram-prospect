import assert from "node:assert/strict";
import {
  browserStateFromSignals,
  discoveryAdmission,
  executionStates,
  formatBrowserHealthEvent,
  isBrowserClosedMessage,
  pagesToOpen,
  parseBrowserHealthEvent,
  recoveryDecision,
  restartBrowserAllowed,
  shouldLogBrowserFailure,
  startDiscoveryEffect,
  tabBudget,
} from "../lib/worker/browser-health";
import { formatDiscoveryStatus, formatOutreachStatus } from "../lib/status/operations";

assert.equal(startDiscoveryEffect({ loopActive: true }).startAnotherLoop, false);
assert.equal(startDiscoveryEffect({ loopActive: false }).startAnotherLoop, true);
assert.equal(startDiscoveryEffect({ loopActive: true }).clearPauseLatch, true);

assert.equal(discoveryAdmission({ loopActive: false, pauseLatched: false, browser: "connected", desiredEnabled: true, sideEffect: null }).enter, true);
assert.equal(discoveryAdmission({ loopActive: true, pauseLatched: false, browser: "connected", desiredEnabled: true, sideEffect: null }).reason, "already_running");
assert.equal(discoveryAdmission({ loopActive: false, pauseLatched: true, browser: "connected", desiredEnabled: true, sideEffect: null }).enter, false);
assert.equal(discoveryAdmission({ loopActive: false, pauseLatched: false, browser: "closed", desiredEnabled: true, sideEffect: null }).reason, "browser");
assert.equal(discoveryAdmission({ loopActive: false, pauseLatched: false, browser: "connected", desiredEnabled: true, sideEffect: "follow" }).reason, "recovery");

assert.equal(pagesToOpen(2), 0);
assert.equal(pagesToOpen(0), 2);
assert.equal(pagesToOpen(1), 1);
assert.equal(tabBudget({ home: 1, profiles: 2, extra: 0 }).steady, true);
assert.equal(tabBudget({ home: 1, profiles: 4, extra: 0 }).steady, false);

assert.equal(recoveryDecision({ state: "closed", attempts: 0, sideEffect: null }).action, "recover");
assert.match(recoveryDecision({ state: "closed", attempts: 0, sideEffect: null }).log ?? "", /1\/3/);
assert.equal(recoveryDecision({ state: "closed", attempts: 3, sideEffect: null }).action, "block");
assert.equal(recoveryDecision({ state: "closed", attempts: 0, sideEffect: "follow" }).reason, "outreach_recovery_required");
assert.equal(recoveryDecision({ state: "closed", attempts: 0, sideEffect: "send" }).action, "block");
assert.equal(recoveryDecision({ state: "connected", attempts: 0, sideEffect: null }).action, "none");

assert.equal(isBrowserClosedMessage("browserContext.newPage: Target page, context or browser has been closed"), true);
assert.equal(isBrowserClosedMessage("browserContext.newPage: Protocol error (Target.createTarget): Failed to open a new tab"), true);
assert.equal(shouldLogBrowserFailure("Browser closed.", "Browser closed."), false);
assert.equal(shouldLogBrowserFailure(null, "Browser closed."), true);

const blocked = executionStates({ browser: "closed", discoveryEnabled: true, outreachEnabled: false, sideEffect: null });
assert.equal(blocked.discoveryDesired, "running");
assert.equal(blocked.discoveryActual, "blocked");
assert.equal(blocked.outreachActual, "paused");
assert.equal(blocked.reason, "browser_closed");
assert.equal(executionStates({ browser: "closed", discoveryEnabled: true, outreachEnabled: true, sideEffect: "send" }).reason, "outreach_recovery_required");
assert.equal(executionStates({ browser: "restarting", discoveryEnabled: true, outreachEnabled: false, sideEffect: null }).discoveryActual, "waiting");

const event = formatBrowserHealthEvent({
  state: "closed",
  discoveryDesired: "running",
  discoveryActual: "blocked",
  outreachDesired: "paused",
  outreachActual: "paused",
  reason: "browser_closed",
});
assert.equal(parseBrowserHealthEvent(event)?.state, "closed");
assert.equal(parseBrowserHealthEvent(event)?.discoveryActual, "blocked");

const ui = formatDiscoveryStatus({
  online: true,
  enabled: true,
  stopReason: null,
  hourly: null,
  attention: null,
  reviewCount: 8,
  reviewTarget: 20,
  browser: "closed",
});
assert.equal(ui.desired, "RUNNING");
assert.equal(ui.actual, "BLOCKED");
assert.match(ui.reason, /browser was closed/i);

const outreach = formatOutreachStatus({
  online: true,
  enabled: false,
  queueCount: 4,
  attention: null,
  browser: "closed",
});
assert.equal(outreach.desired, "PAUSED");
assert.equal(outreach.actual, "PAUSED");

const running = formatOutreachStatus({
  online: true,
  enabled: true,
  queueCount: 4,
  attention: null,
  browser: "connected",
});
assert.equal(running.desired, "RUNNING");
assert.equal(running.actual, "RUNNING");
assert.doesNotMatch(running.label, /outside/i);
assert.doesNotMatch(running.reason, /hour/i);

const waiting = formatOutreachStatus({
  online: true,
  enabled: true,
  queueCount: 4,
  attention: null,
  browser: "connected",
  pacingWait: { reason: "Waiting for minimum spacing", nextAt: "2026-10-03T07:02:41.000Z" },
});
assert.equal(waiting.actual, "WAITING");
assert.match(waiting.reason, /minimum spacing/);

assert.equal(restartBrowserAllowed({ online: true, state: "closed", sideEffect: null }).allowed, true);
assert.equal(restartBrowserAllowed({ online: true, state: "closed", sideEffect: "follow" }).allowed, false);
assert.equal(restartBrowserAllowed({ online: true, state: "connected", sideEffect: null }).allowed, false);
assert.equal(browserStateFromSignals({ closed: true, restarting: false, failed: true }), "failed");

console.log("browser health tests passed");
